-- NotaFlow 2.0 - instalação NOVA no Supabase.
-- Este script NÃO contém DROP/TRUNCATE, não remove os dados de projetos anteriores.
-- Execute em um PROJETO SUPABASE NOVO para garantir uma base realmente vazia.
-- Após criar usuários em Authentication, execute PROMOVER_ADMIN.sql.
begin;
create extension if not exists pgcrypto;

create table if not exists public.nf_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'viewer' check(role in ('admin','viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.nf_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.nf_profiles(user_id,email,role) values(new.id,coalesce(new.email,''),'viewer')
  on conflict(user_id) do update set email=excluded.email;
  return new;
end; $$;
drop trigger if exists nf_profile_signup on auth.users;
create trigger nf_profile_signup after insert on auth.users for each row execute function public.nf_create_profile();
insert into public.nf_profiles(user_id,email,role)
  select id,coalesce(email,''),'viewer' from auth.users on conflict(user_id) do nothing;

create or replace function public.nf_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.nf_profiles where user_id=(select auth.uid()) and role='admin');
$$;
revoke all on function public.nf_is_admin() from public;
grant execute on function public.nf_is_admin() to authenticated;

create table if not exists public.nf_sites (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check(length(trim(name))>0),
 center_code text not null default '',
 region text not null default '',
 carrier_info text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.nf_blocks (
 id uuid primary key default gen_random_uuid(),
 name text not null default 'Novo bloco',
 position int not null default 0,
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create table if not exists public.nf_materials (
 id uuid primary key default gen_random_uuid(),
 site_id uuid references public.nf_sites(id) on delete restrict,
 requested_on date not null default current_date,
 sap_code text not null default '',
 forms_code text not null default '',
 description text not null default '',
 process text not null default 'indefinido' check(process in ('3d','cnc','outro','indefinido')),
 quantity numeric(12,3) not null default 1 check(quantity>0),
 unit_price numeric(14,2) not null default 0 check(unit_price>=0),
 status text not null default 'rascunho' check(status in ('rascunho','solicitado','nota_recebida','concluido','cancelado')),
 block_id uuid references public.nf_blocks(id) on delete set null,
 position int not null default 0,
 notes text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 constraint nf_material_requires_identifier check(length(trim(sap_code))>0 or length(trim(forms_code))>0)
);
create table if not exists public.nf_invoices (
 id uuid primary key default gen_random_uuid(),
 number text not null check(length(trim(number))>0),
 access_key text not null default '' check(access_key='' or access_key ~ '^[0-9]{44}$'),
 issued_on date not null default current_date,
 notes text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create table if not exists public.nf_invoice_materials (
 invoice_id uuid not null references public.nf_invoices(id) on delete cascade,
 material_id uuid not null unique references public.nf_materials(id) on delete restrict,
 prior_status text not null default 'solicitado',
 added_at timestamptz not null default now(),
 primary key(invoice_id,material_id)
);
create table if not exists public.nf_activity (
 id bigint generated always as identity primary key,
 entity text not null,
 entity_id uuid,
 action text not null,
 summary text not null default '',
 author_id uuid,
 happened_at timestamptz not null default now()
);

create index if not exists nf_materials_date_idx on public.nf_materials(requested_on desc);
create index if not exists nf_materials_sap_idx on public.nf_materials(sap_code);
create index if not exists nf_materials_forms_idx on public.nf_materials(forms_code);
create index if not exists nf_materials_site_idx on public.nf_materials(site_id);
create index if not exists nf_materials_block_idx on public.nf_materials(block_id,position);
create index if not exists nf_activity_time_idx on public.nf_activity(happened_at desc);

create or replace function public.nf_stamp() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=now();return new;end;$$;
drop trigger if exists nf_material_stamp on public.nf_materials;
create trigger nf_material_stamp before update on public.nf_materials for each row execute function public.nf_stamp();
drop trigger if exists nf_invoice_stamp on public.nf_invoices;
create trigger nf_invoice_stamp before update on public.nf_invoices for each row execute function public.nf_stamp();

-- Regras: um material só pertence a uma NF. Máximo 4 por NF, com lock para concorrência.
create or replace function public.nf_before_invoice_link() returns trigger language plpgsql set search_path = '' as $$
declare v_status text;v_count integer;
begin
  perform 1 from public.nf_invoices where id=new.invoice_id for update;
  if not found then raise exception 'Nota fiscal não encontrada';end if;
  select status into v_status from public.nf_materials where id=new.material_id for update;
  if not found then raise exception 'Material não encontrado';end if;
  if v_status='cancelado' then raise exception 'Material cancelado não pode ser faturado';end if;
  select count(*) into v_count from public.nf_invoice_materials where invoice_id=new.invoice_id;
  if v_count >= 4 then raise exception 'Uma nota fiscal pode conter no máximo 4 materiais';end if;
  new.prior_status:=v_status;
  return new;
end;$$;
drop trigger if exists nf_link_validate on public.nf_invoice_materials;
create trigger nf_link_validate before insert on public.nf_invoice_materials for each row execute function public.nf_before_invoice_link();

create or replace function public.nf_after_invoice_link() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op='INSERT' then
   update public.nf_materials set status='nota_recebida' where id=new.material_id;
   return new;
 elsif tg_op='DELETE' then
   update public.nf_materials set status=old.prior_status where id=old.material_id;
   return old;
 end if;
 return null;
end;$$;
drop trigger if exists nf_link_status_insert on public.nf_invoice_materials;
create trigger nf_link_status_insert after insert on public.nf_invoice_materials for each row execute function public.nf_after_invoice_link();
drop trigger if exists nf_link_status_delete on public.nf_invoice_materials;
create trigger nf_link_status_delete after delete on public.nf_invoice_materials for each row execute function public.nf_after_invoice_link();

create or replace function public.nf_guard_linked_status() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if exists(select 1 from public.nf_invoice_materials where material_id=new.id) and
       (new.sap_code,new.forms_code,new.description,new.quantity,new.unit_price,new.site_id,new.requested_on) is distinct from
       (old.sap_code,old.forms_code,old.description,old.quantity,old.unit_price,old.site_id,old.requested_on) then
      raise exception 'Material vinculado a nota: desvincule a NF antes de alterar seus dados fiscais';
    end if;
    if new.status is distinct from old.status
       and exists(select 1 from public.nf_invoice_materials where material_id=new.id)
       and new.status not in ('nota_recebida','concluido') then
      raise exception 'Material com nota vinculada: remova a nota antes de voltar o status';
    end if;
  end if;
  if new.status='nota_recebida' and not exists(select 1 from public.nf_invoice_materials where material_id=new.id) then
    raise exception 'Nota recebida só pode ser definida pelo vínculo com uma nota fiscal';
  end if;
  return new;
end;$$;
drop trigger if exists nf_guard_material_status on public.nf_materials;
create trigger nf_guard_material_status before insert or update of status on public.nf_materials
  for each row execute function public.nf_guard_linked_status();

-- Registro de alterações no servidor, inclusive quando os clientes não enviam logs.
create or replace function public.nf_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;v_title text;
begin
 v_id:=case when tg_op='DELETE' then old.id else new.id end;
 v_title:=case when tg_table_name='nf_materials' then coalesce((case when tg_op='DELETE' then old.sap_code else new.sap_code end),'')
               when tg_table_name='nf_invoices' then (case when tg_op='DELETE' then old.number else new.number end)
               else (case when tg_op='DELETE' then old.name else new.name end) end;
 insert into public.nf_activity(entity,entity_id,action,summary,author_id)
 values(tg_table_name,v_id,lower(tg_op),coalesce(v_title,''),auth.uid());
 return case when tg_op='DELETE' then old else new end;
end;$$;
-- Audit only the business entities, never profile/links.
drop trigger if exists nf_audit_materials on public.nf_materials;
create trigger nf_audit_materials after insert or update or delete on public.nf_materials for each row execute function public.nf_audit();
drop trigger if exists nf_audit_invoices on public.nf_invoices;
create trigger nf_audit_invoices after insert or update or delete on public.nf_invoices for each row execute function public.nf_audit();
drop trigger if exists nf_audit_blocks on public.nf_blocks;
create trigger nf_audit_blocks after insert or update or delete on public.nf_blocks for each row execute function public.nf_audit();

-- RLS: viewer lê, admin escreve. Papel nunca é editável pelo usuário via API.
alter table public.nf_profiles enable row level security;
alter table public.nf_sites enable row level security;
alter table public.nf_blocks enable row level security;
alter table public.nf_materials enable row level security;
alter table public.nf_invoices enable row level security;
alter table public.nf_invoice_materials enable row level security;
alter table public.nf_activity enable row level security;

drop policy if exists nf_profiles_self_read on public.nf_profiles;
create policy nf_profiles_self_read on public.nf_profiles for select to authenticated using(user_id=(select auth.uid()));

-- FOR ALL policies: check permissions on both old/new rows.
drop policy if exists nf_sites_read on public.nf_sites;
create policy nf_sites_read on public.nf_sites for select to authenticated using(true);
drop policy if exists nf_sites_write on public.nf_sites;
create policy nf_sites_write on public.nf_sites for all to authenticated using(public.nf_is_admin()) with check(public.nf_is_admin());

drop policy if exists nf_blocks_read on public.nf_blocks;
create policy nf_blocks_read on public.nf_blocks for select to authenticated using(true);
drop policy if exists nf_blocks_write on public.nf_blocks;
create policy nf_blocks_write on public.nf_blocks for all to authenticated using(public.nf_is_admin()) with check(public.nf_is_admin());

drop policy if exists nf_materials_read on public.nf_materials;
create policy nf_materials_read on public.nf_materials for select to authenticated using(true);
drop policy if exists nf_materials_write on public.nf_materials;
create policy nf_materials_write on public.nf_materials for all to authenticated using(public.nf_is_admin()) with check(public.nf_is_admin());

drop policy if exists nf_invoices_read on public.nf_invoices;
create policy nf_invoices_read on public.nf_invoices for select to authenticated using(true);
drop policy if exists nf_invoices_write on public.nf_invoices;
create policy nf_invoices_write on public.nf_invoices for all to authenticated using(public.nf_is_admin()) with check(public.nf_is_admin());

drop policy if exists nf_invoice_materials_read on public.nf_invoice_materials;
create policy nf_invoice_materials_read on public.nf_invoice_materials for select to authenticated using(true);
drop policy if exists nf_invoice_materials_write on public.nf_invoice_materials;
create policy nf_invoice_materials_write on public.nf_invoice_materials for all to authenticated using(public.nf_is_admin()) with check(public.nf_is_admin());

drop policy if exists nf_activity_read on public.nf_activity;
create policy nf_activity_read on public.nf_activity for select to authenticated using(true);
-- audit INSERT by security definer trigger only; direct client writes denied.

-- Supabase Auth usa o papel authenticated. As GRANTs abaixo permitem acesso à API,
-- mas as políticas RLS acima é que determinam quem pode alterar dados.
grant select on public.nf_profiles, public.nf_sites, public.nf_blocks,
  public.nf_materials, public.nf_invoices, public.nf_invoice_materials,
  public.nf_activity to authenticated;
grant insert,update,delete on public.nf_sites, public.nf_blocks, public.nf_materials,
  public.nf_invoices, public.nf_invoice_materials to authenticated;

-- RPC executes as caller (invoker), RLS still active. All-or-nothing invoice update.
create or replace function public.nf_save_invoice(
 p_id uuid, p_number text, p_access_key text, p_issued_on date, p_notes text, p_material_ids uuid[]
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;v_count int;v_distinct int;
begin
 if not public.nf_is_admin() then raise exception 'Sem permissão';end if;
 v_count:=coalesce(array_length(p_material_ids,1),0);
 if v_count<1 or v_count>4 then raise exception 'Selecione de 1 a 4 materiais';end if;
 select count(distinct x) into v_distinct from unnest(p_material_ids) x;
 if v_distinct<>v_count then raise exception 'Materiais duplicados na nota';end if;
 if length(trim(coalesce(p_number,'')))=0 then raise exception 'Número obrigatório';end if;
 if coalesce(p_access_key,'')<>'' and p_access_key !~ '^[0-9]{44}$' then raise exception 'Chave deve ter 44 dígitos';end if;
 if p_id is null then
   insert into public.nf_invoices(number,access_key,issued_on,notes,created_by)
   values(trim(p_number),coalesce(p_access_key,''),coalesce(p_issued_on,current_date),coalesce(p_notes,''),auth.uid()) returning id into v_id;
 else
   update public.nf_invoices set number=trim(p_number), access_key=coalesce(p_access_key,''), issued_on=coalesce(p_issued_on,current_date), notes=coalesce(p_notes,'') where id=p_id returning id into v_id;
   if v_id is null then raise exception 'Nota fiscal não encontrada ou sem permissão';end if;
   delete from public.nf_invoice_materials where invoice_id=v_id and material_id <> all(p_material_ids);
 end if;
 insert into public.nf_invoice_materials(invoice_id,material_id)
   select v_id, x from unnest(p_material_ids) x
   where not exists (select 1 from public.nf_invoice_materials im where im.invoice_id=v_id and im.material_id=x)
   on conflict(invoice_id,material_id) do nothing;
 return v_id;
end;$$;
revoke all on function public.nf_save_invoice(uuid,text,text,date,text,uuid[]) from public;
grant execute on function public.nf_save_invoice(uuid,text,text,date,text,uuid[]) to authenticated;

commit;
