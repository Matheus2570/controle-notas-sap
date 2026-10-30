-- ================================================================
-- NOTAFLOW | BANCO FINAL (2.5) - INSTALACAO LIMPA
-- ================================================================
-- UNICO arquivo para criar o banco de um projeto Supabase NOVO.
-- Consolida: CRIAR_BANCO_NOVO + CORRIGIR_ERRO_OLD_NUMBER +
-- ATIVAR_BLOCOS_AUTOMATICOS + ATUALIZAR_FLUXO_PEDIDO_NF +
-- ATUALIZAR_HISTORICO_E_ARMAZENAMENTO.
--
-- O app usa as tabelas nf_* e auth.users do Supabase.
-- Execute UMA VEZ no SQL Editor, num projeto NOVO ou depois de
-- executar APAGAR_TUDO_NOTAFLOW.sql e confirmar o reset.
-- NAO execute os SQLs antigos depois deste arquivo: eles podem
-- substituir funcoes mais recentes por versoes antigas.
--
-- IMPORTANTE: este arquivo NAO EXCLUI registros existentes.
-- Ele tambem NAO cria usuarios/senhas no Supabase Auth.
-- Depois do SQL, crie usuarios em Authentication > Users e
-- promova o admin com o SQL comentado no fim do arquivo.
-- ================================================================
BEGIN;

-- (1) ESTRUTURA, AUTENTICACAO, RLS, REGRAS DE NF E AUDITORIA FINAL
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
  if v_status<>'solicitado' then raise exception 'Solicite o material no SAP (status Pedido) antes de vincular a NF';end if;
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
-- Auditoria robusta: campos variam entre materials, invoices e blocks.
-- JSONB evita resolução indevida de OLD.number em tabelas sem essa coluna.
create or replace function public.nf_audit()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  previous_data jsonb := '{}'::jsonb;
  current_data jsonb := '{}'::jsonb;
  picked jsonb;
  v_id uuid;
  v_action text := lower(tg_op);
  v_subject text := '';
  v_diff text := '';
  v_summary text;
begin
  if tg_op in ('UPDATE','DELETE') then previous_data := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then current_data := to_jsonb(new); end if;
  picked := case when tg_op='DELETE' then previous_data else current_data end;
  v_id := nullif(picked->>'id','')::uuid;

  -- Não gerar histórico quando só o carimbo updated_at foi alterado.
  if tg_op='UPDATE' and (previous_data - 'updated_at') = (current_data - 'updated_at') then
    return new;
  end if;

  if tg_table_name='nf_materials' then
    v_subject := concat_ws(' · ',
      case when coalesce(picked->>'sap_code','')<>'' then 'SAP '||left(picked->>'sap_code',35) end,
      case when coalesce(picked->>'forms_code','')<>'' then 'Forms '||left(picked->>'forms_code',35) end
    );
    if v_subject='' then v_subject:='Material'; end if;
    if tg_op='UPDATE' then
      v_diff := concat_ws('; ',
        case when previous_data->>'status' is distinct from current_data->>'status'
          then 'status '||coalesce(previous_data->>'status','—')||' → '||coalesce(current_data->>'status','—') end,
        case when previous_data->>'quantity' is distinct from current_data->>'quantity'
          then 'qtd '||coalesce(previous_data->>'quantity','—')||' → '||coalesce(current_data->>'quantity','—') end,
        case when previous_data->>'unit_price' is distinct from current_data->>'unit_price'
          then 'unitário '||coalesce(previous_data->>'unit_price','—')||' → '||coalesce(current_data->>'unit_price','—') end,
        case when previous_data->>'process' is distinct from current_data->>'process'
          then 'processo '||coalesce(previous_data->>'process','—')||' → '||coalesce(current_data->>'process','—') end,
        case when previous_data->>'block_id' is distinct from current_data->>'block_id'
          then 'bloco alterado' end,
        case when previous_data->>'site_id' is distinct from current_data->>'site_id'
          then 'site alterado' end,
        case when previous_data->>'sap_code' is distinct from current_data->>'sap_code'
          then 'SAP alterado' end,
        case when previous_data->>'forms_code' is distinct from current_data->>'forms_code'
          then 'Forms alterado' end,
        case when previous_data->>'description' is distinct from current_data->>'description'
          then 'descrição editada' end,
        case when previous_data->>'requested_on' is distinct from current_data->>'requested_on'
          then 'data alterada' end,
        case when previous_data->>'notes' is distinct from current_data->>'notes'
          then 'observações editadas' end
      );
      if v_diff='' then return new; end if;
      if previous_data->>'status' is distinct from current_data->>'status' then v_action:='status'; end if;
    end if;
  elsif tg_table_name='nf_invoices' then
    v_subject := 'NF '||coalesce(nullif(picked->>'number',''),'—');
    if tg_op='UPDATE' then
      v_diff := concat_ws('; ',
        case when previous_data->>'number' is distinct from current_data->>'number' then 'número alterado' end,
        case when previous_data->>'issued_on' is distinct from current_data->>'issued_on' then 'data alterada' end,
        case when previous_data->>'access_key' is distinct from current_data->>'access_key' then 'chave alterada' end,
        case when previous_data->>'notes' is distinct from current_data->>'notes' then 'observações editadas' end
      );
      if v_diff='' then return new; end if;
    end if;
  elsif tg_table_name='nf_blocks' then
    v_subject := left(coalesce(nullif(picked->>'name',''),'Bloco'),75);
    if tg_op='UPDATE' then
      v_diff := concat_ws('; ',
        case when previous_data->>'name' is distinct from current_data->>'name' then 'nome alterado' end,
        case when previous_data->>'position' is distinct from current_data->>'position' then 'ordem alterada' end
      );
      if v_diff='' then return new; end if;
    end if;
  else
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  v_summary := left(v_subject || case when v_diff<>'' then ' · '||v_diff else '' end, 240);
  insert into public.nf_activity(entity,entity_id,action,summary,author_id)
    values (tg_table_name,v_id,v_action,v_summary,auth.uid());

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

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

-- (2) BLOCOS AUTOMATICOS, LIMITE DE 4, MOVIMENTACAO
ALTER TABLE public.nf_blocks
  ADD COLUMN IF NOT EXISTS auto_created boolean NOT NULL DEFAULT false;
ALTER TABLE public.nf_blocks
  ADD COLUMN IF NOT EXISTS process text;
ALTER TABLE public.nf_blocks
  ADD COLUMN IF NOT EXISTS site_id uuid;

-- Restringe a capacidade a 4 itens mesmo em edições manuais ou pela API.
CREATE OR REPLACE FUNCTION public.nf_guard_block_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_total integer;
BEGIN
  IF new.block_id IS NULL THEN RETURN new; END IF;
  IF tg_op = 'UPDATE' THEN
    IF old.block_id IS NOT DISTINCT FROM new.block_id THEN
      RETURN new;
    END IF;
  END IF;
  -- Bloqueio de linha evita que duas sessões insiram o 4º e 5º item ao mesmo tempo.
  PERFORM 1 FROM public.nf_blocks WHERE id = new.block_id FOR UPDATE;
  SELECT count(*) INTO v_total
    FROM public.nf_materials WHERE block_id = new.block_id AND id <> new.id;
  IF v_total >= 4 THEN
    RAISE EXCEPTION 'Este bloco já possui 4 materiais. Escolha outro bloco.';
  END IF;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS nf_guard_block_capacity_trigger ON public.nf_materials;
CREATE TRIGGER nf_guard_block_capacity_trigger
BEFORE INSERT OR UPDATE OF block_id ON public.nf_materials
FOR EACH ROW EXECUTE FUNCTION public.nf_guard_block_capacity();

-- Agrupa APENAS itens sem bloco; mantém site e processo separados.
-- Blocos manuais nunca são usados pela automação.
CREATE OR REPLACE FUNCTION public.nf_autogroup_materials()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_item record;
  v_block uuid;
  v_slot integer;
  v_new_pos integer;
  v_group_name text;
  v_done integer := 0;
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND NOT public.nf_is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem organizar materiais';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);
  FOR v_item IN
    SELECT id,site_id,process FROM public.nf_materials
    WHERE block_id IS NULL
    ORDER BY site_id,
      CASE process WHEN 'cnc' THEN 0 WHEN '3d' THEN 1 WHEN 'outro' THEN 2 ELSE 3 END,
      created_at,id
  LOOP
    v_block := NULL;
    v_slot := 0;
    SELECT b.id, COALESCE((SELECT max(x.position)+1 FROM public.nf_materials x WHERE x.block_id=b.id),0)
      INTO v_block,v_slot
      FROM public.nf_blocks b
      WHERE b.auto_created = true
        AND b.site_id IS NOT DISTINCT FROM v_item.site_id
        AND b.process = v_item.process
        AND (SELECT count(*) FROM public.nf_materials x WHERE x.block_id=b.id) < 4
      ORDER BY b.position,b.created_at,b.id
      LIMIT 1;
    IF v_block IS NULL THEN
      SELECT coalesce(max(position),-1)+1 INTO v_new_pos FROM public.nf_blocks;
      v_group_name := CASE v_item.process
        WHEN 'cnc' THEN 'CNC'
        WHEN '3d' THEN 'Impressão 3D'
        WHEN 'outro' THEN 'Outro'
        ELSE 'Não definido' END;
      INSERT INTO public.nf_blocks(name,position,auto_created,process,site_id)
      VALUES ('BLOCO ' || lpad((v_new_pos+1)::text,3,'0') || ' — ' || v_group_name,
              v_new_pos,true,v_item.process,v_item.site_id)
      RETURNING id INTO v_block;
      v_slot := 0;
    END IF;
    UPDATE public.nf_materials
      SET block_id=v_block,position=v_slot
      WHERE id=v_item.id AND block_id IS NULL;
    v_done := v_done + 1;
  END LOOP;
  RETURN v_done;
END;
$$;
REVOKE ALL ON FUNCTION public.nf_autogroup_materials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_autogroup_materials() TO authenticated;

-- Mover manualmente com validação no SERVIDOR. O RPC estava faltando no SQL original.
-- Continua permitindo misturar processos manualmente, mas nunca ultrapassa 4.
CREATE OR REPLACE FUNCTION public.nf_move_materials(p_material_ids uuid[], p_block_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_exists integer;
  v_extra integer;
  v_current integer;
  v_position integer;
  v_moved integer := 0;
BEGIN
  IF NOT public.nf_is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem mover materiais';
  END IF;
  IF p_material_ids IS NULL OR cardinality(p_material_ids) = 0 THEN RETURN 0; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(936100, 4204);

  SELECT count(DISTINCT id) INTO v_exists
  FROM public.nf_materials WHERE id = ANY(p_material_ids);
  IF v_exists <> (SELECT count(DISTINCT x) FROM unnest(p_material_ids) x WHERE x IS NOT NULL) THEN
    RAISE EXCEPTION 'Um dos materiais não existe ou não está acessível';
  END IF;

  IF p_block_id IS NOT NULL THEN
    PERFORM 1 FROM public.nf_blocks WHERE id = p_block_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bloco de destino não encontrado'; END IF;
    SELECT count(*) INTO v_current FROM public.nf_materials WHERE block_id=p_block_id;
    SELECT count(*) INTO v_extra FROM public.nf_materials
      WHERE id = ANY(p_material_ids) AND block_id IS DISTINCT FROM p_block_id;
    IF v_current + v_extra > 4 THEN
      RAISE EXCEPTION 'O bloco admite até 4 materiais; libere espaço ou escolha outro bloco';
    END IF;
  END IF;

  FOR v_id IN SELECT DISTINCT m.id FROM public.nf_materials m
              WHERE m.id = ANY(p_material_ids) AND m.block_id IS DISTINCT FROM p_block_id
              ORDER BY m.id
  LOOP
    IF p_block_id IS NULL THEN
      v_position := 0;
    ELSE
      SELECT coalesce(max(position),-1)+1 INTO v_position
        FROM public.nf_materials WHERE block_id=p_block_id;
    END IF;
    UPDATE public.nf_materials SET block_id=p_block_id, position=v_position WHERE id=v_id;
    v_moved := v_moved + 1;
  END LOOP;
  RETURN v_moved;
END;
$$;
REVOKE ALL ON FUNCTION public.nf_move_materials(uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nf_move_materials(uuid[],uuid) TO authenticated;

-- Importação de uma vez: organiza depois que todas as linhas foram inseridas.
CREATE OR REPLACE FUNCTION public.nf_autogroup_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM public.nf_autogroup_materials();
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS nf_autogroup_after_insert ON public.nf_materials;
CREATE TRIGGER nf_autogroup_after_insert
AFTER INSERT ON public.nf_materials
FOR EACH STATEMENT EXECUTE FUNCTION public.nf_autogroup_on_insert();

-- (3) MEDIDOR REAL DE ARMAZENAMENTO SOMENTE PARA ADMIN
create or replace function public.nf_database_usage_bytes()
returns bigint
language plpgsql security definer stable set search_path = '' as $$
begin
  if auth.uid() is null or not public.nf_is_admin() then
    raise exception 'Apenas administradores podem consultar o tamanho do banco';
  end if;
  return pg_catalog.pg_database_size(pg_catalog.current_database());
end;
$$;
revoke all on function public.nf_database_usage_bytes() from public;
revoke all on function public.nf_database_usage_bytes() from anon;
grant execute on function public.nf_database_usage_bytes() to authenticated;

COMMIT;

-- ================================================================
-- CONFERENCIA OPCIONAL (somente leitura):
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema='public' AND table_name LIKE 'nf_%'
-- ORDER BY table_name;
--
-- IMPORTANTE - CADASTRAR ADMIN (PASSO SEPARADO):
-- 1. Crie a conta no Supabase > Authentication > Users.
-- 2. Em outra consulta, substitua o email e execute:
-- UPDATE public.nf_profiles SET role = 'admin'
-- WHERE user_id = (
--   SELECT id FROM auth.users
--   WHERE lower(email)=lower('SEU_EMAIL@EXEMPLO.COM')
-- );
-- SELECT email,role FROM public.nf_profiles ORDER BY email;
--
-- Este banco nao preenche automaticamente seus sites/fabricas;
-- cadastre-os na tela Configuracoes do NotaFlow.
-- ================================================================
