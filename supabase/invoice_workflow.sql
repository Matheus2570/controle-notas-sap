-- NotaFlow v1.3 — Registro de notas fiscais vinculadas aos materiais
-- Para bancos já configurados com schema.sql / roles_upgrade.sql da v1.2.
-- Execute este arquivo inteiro no SQL Editor do Supabase.
begin;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  note_number text not null check (char_length(trim(note_number)) between 1 and 60),
  access_key text not null unique check (access_key ~ '^[0-9]{44}$'),
  issued_on date not null default current_date,
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_items (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  request_item_id uuid not null references public.request_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invoice_id, request_item_id),
  unique (request_item_id)
);

-- A trilha não tem FK para invoices de propósito: exclusões também ficam auditadas.
create table if not exists public.invoice_activity (
  id bigint generated always as identity primary key,
  invoice_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE','LINK','UNLINK')),
  summary text not null,
  changed_by uuid,
  changed_by_email text not null default '',
  changed_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb
);

create index if not exists idx_invoices_issued_on on public.invoices(issued_on desc);
create index if not exists idx_invoices_note_number on public.invoices(note_number);
create index if not exists idx_invoice_items_invoice on public.invoice_items(invoice_id);
create index if not exists idx_invoice_activity_invoice_date on public.invoice_activity(invoice_id, changed_at desc);

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_activity enable row level security;

drop policy if exists "invoices_read" on public.invoices;
create policy "invoices_read" on public.invoices for select to authenticated using (true);
drop policy if exists "invoices_admin_insert" on public.invoices;
create policy "invoices_admin_insert" on public.invoices for insert to authenticated with check ((select public.is_app_admin()));
drop policy if exists "invoices_admin_update" on public.invoices;
create policy "invoices_admin_update" on public.invoices for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
drop policy if exists "invoices_admin_delete" on public.invoices;
create policy "invoices_admin_delete" on public.invoices for delete to authenticated using ((select public.is_app_admin()));

drop policy if exists "invoice_items_read" on public.invoice_items;
create policy "invoice_items_read" on public.invoice_items for select to authenticated using (true);
drop policy if exists "invoice_items_admin_insert" on public.invoice_items;
create policy "invoice_items_admin_insert" on public.invoice_items for insert to authenticated with check ((select public.is_app_admin()));
drop policy if exists "invoice_items_admin_update" on public.invoice_items;
create policy "invoice_items_admin_update" on public.invoice_items for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
drop policy if exists "invoice_items_admin_delete" on public.invoice_items;
create policy "invoice_items_admin_delete" on public.invoice_items for delete to authenticated using ((select public.is_app_admin()));

drop policy if exists "invoice_activity_read" on public.invoice_activity;
create policy "invoice_activity_read" on public.invoice_activity for select to authenticated using (true);
revoke all on public.invoices, public.invoice_items from public, anon, authenticated;
grant select,insert,update,delete on public.invoices, public.invoice_items to authenticated;
revoke all on public.invoice_activity from public, anon, authenticated;
grant select on public.invoice_activity to authenticated;

-- No material already invoiced can be deleted or changed behind the invoice record.
create or replace function public.guard_invoiced_request_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.invoice_items ii where ii.request_item_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception using errcode = '23503', message = 'Este material já está vinculado a uma nota fiscal. Desvincule ou exclua a nota na tela Notas fiscais antes de remover o material.';
    end if;
    if row(new.request_id,new.sap_code,new.forms_code,new.material,new.process,new.quantity,new.unit_price)
       is distinct from
       row(old.request_id,old.sap_code,old.forms_code,old.material,old.process,old.quantity,old.unit_price) then
      raise exception using errcode = '23514', message = 'Este material já está vinculado a uma nota fiscal e não pode ser alterado. Edite a nota na tela Notas fiscais primeiro.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_invoiced_request_item on public.request_items;
create trigger trg_guard_invoiced_request_item before update or delete on public.request_items
for each row execute function public.guard_invoiced_request_item();
revoke all on function public.guard_invoiced_request_item() from public, anon, authenticated;

-- Site/data são parte do contexto fiscal do material. Não podem mudar após a vinculação.
create or replace function public.guard_invoiced_request_context()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.site_id is distinct from old.site_id or new.requested_on is distinct from old.requested_on)
     and exists (
       select 1 from public.request_items ri
       join public.invoice_items ii on ii.request_item_id = ri.id
       where ri.request_id = old.id
     ) then
    raise exception using errcode = '23514', message = 'Este pedido contém materiais vinculados a uma nota fiscal. Para mudar site ou data, desvincule primeiro os materiais na tela Notas fiscais.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_invoiced_request_context on public.requests;
create trigger trg_guard_invoiced_request_context before update on public.requests
for each row execute function public.guard_invoiced_request_context();
revoke all on function public.guard_invoiced_request_context() from public, anon, authenticated;

-- Segunda linha de defesa: no máximo quatro materiais por nota fiscal.
create or replace function public.enforce_invoice_item_limit()
returns trigger language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.invoice_id is not distinct from old.invoice_id
       and new.request_item_id is not distinct from old.request_item_id then
      return new;
    end if;
  end if;
  -- Serializa inclusões concorrentes na mesma nota para não ultrapassar o limite.
  perform 1 from public.invoices inv where inv.id = new.invoice_id for update;
  select count(*) into v_count from public.invoice_items ii where ii.invoice_id = new.invoice_id;
  if v_count >= 4 then
    raise exception using errcode = '23514', message = 'Uma nota fiscal pode conter no máximo quatro materiais neste controle.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_invoice_item_limit on public.invoice_items;
create trigger trg_enforce_invoice_item_limit before insert or update on public.invoice_items
for each row execute function public.enforce_invoice_item_limit();
revoke all on function public.enforce_invoice_item_limit() from public, anon, authenticated;

create or replace function public.touch_invoice_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
drop trigger if exists trg_invoice_updated_at on public.invoices;
create trigger trg_invoice_updated_at before update on public.invoices
for each row execute function public.touch_invoice_updated_at();
revoke all on function public.touch_invoice_updated_at() from public, anon, authenticated;

create or replace function public.audit_invoice_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_invoice_id uuid;
  v_action text;
  v_summary text;
  v_before jsonb;
  v_after jsonb;
  v_note text;
  v_sap text;
  v_forms text;
begin
  if tg_table_name = 'invoices' then
    if tg_op = 'INSERT' then
      v_invoice_id := new.id; v_action := 'INSERT'; v_note := new.note_number;
      v_summary := 'Nota fiscal registrada: ' || new.note_number; v_after := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
      v_invoice_id := new.id; v_action := 'UPDATE'; v_note := new.note_number;
      v_summary := 'Dados da nota fiscal atualizados: ' || new.note_number;
      v_before := to_jsonb(old); v_after := to_jsonb(new);
    else
      v_invoice_id := old.id; v_action := 'DELETE'; v_note := old.note_number;
      v_summary := 'Nota fiscal excluída: ' || old.note_number; v_before := to_jsonb(old);
    end if;
  elsif tg_table_name = 'invoice_items' then
    if tg_op = 'INSERT' then
      v_invoice_id := new.invoice_id; v_action := 'LINK';
      select coalesce(nullif(btrim(ri.sap_code),''),'não informado'), coalesce(nullif(btrim(ri.forms_code),''),'não informado')
        into v_sap,v_forms from public.request_items ri where ri.id = new.request_item_id;
      v_summary := 'Material vinculado à nota (SAP ' || coalesce(v_sap,'não informado') || '; Forms ' || coalesce(v_forms,'não informado') || ')';
      v_after := to_jsonb(new);
    elsif tg_op = 'DELETE' then
      v_invoice_id := old.invoice_id; v_action := 'UNLINK';
      select coalesce(nullif(btrim(ri.sap_code),''),'não informado'), coalesce(nullif(btrim(ri.forms_code),''),'não informado')
        into v_sap,v_forms from public.request_items ri where ri.id = old.request_item_id;
      v_summary := 'Material desvinculado da nota (SAP ' || coalesce(v_sap,'não informado') || '; Forms ' || coalesce(v_forms,'não informado') || ')';
      v_before := to_jsonb(old);
    else
      v_invoice_id := new.invoice_id; v_action := 'UPDATE'; v_summary := 'Vínculo de material atualizado';
      v_before := to_jsonb(old); v_after := to_jsonb(new);
    end if;
  else
    return null;
  end if;
  insert into public.invoice_activity(invoice_id,action,summary,changed_by,changed_by_email,before_data,after_data)
  values (v_invoice_id,v_action,v_summary,auth.uid(),coalesce(auth.jwt() ->> 'email',''),v_before,v_after);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_audit_invoice_header on public.invoices;
create trigger trg_audit_invoice_header after insert or update or delete on public.invoices
for each row execute function public.audit_invoice_activity();
drop trigger if exists trg_audit_invoice_items on public.invoice_items;
create trigger trg_audit_invoice_items after insert or update or delete on public.invoice_items
for each row execute function public.audit_invoice_activity();
revoke all on function public.audit_invoice_activity() from public, anon, authenticated;

-- Salva cabeçalho e vínculos em uma única transação. O limite de quatro também é validado no banco.
create or replace function public.save_invoice_with_items(
  p_invoice_id uuid,
  p_note_number text,
  p_access_key text,
  p_issued_on date,
  p_notes text,
  p_item_ids uuid[]
)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_invoice_id uuid;
  v_key text;
  v_item_count integer;
  v_old_request_ids uuid[] := '{}'::uuid[];
begin
  if not coalesce(public.is_app_admin(),false) then
    raise exception using errcode = '42501', message = 'Apenas o administrador pode registrar ou editar notas fiscais.';
  end if;
  if coalesce(pg_catalog.btrim(p_note_number),'') = '' then
    raise exception using errcode = '22023', message = 'Informe o número da nota fiscal.';
  end if;
  v_key := pg_catalog.regexp_replace(coalesce(p_access_key,''),'[^0-9]','','g');
  if v_key !~ '^[0-9]{44}$' then
    raise exception using errcode = '22023', message = 'A chave da NF-e deve conter exatamente 44 dígitos numéricos.';
  end if;
  if p_issued_on is null then
    raise exception using errcode = '22023', message = 'Informe a data da nota fiscal.';
  end if;
  if p_item_ids is null or pg_catalog.cardinality(p_item_ids) < 1 or pg_catalog.cardinality(p_item_ids) > 4 then
    raise exception using errcode = '22023', message = 'Selecione de um a quatro materiais para a nota fiscal.';
  end if;
  if (select count(distinct ids.item_id) from pg_catalog.unnest(p_item_ids) as ids(item_id)) <> pg_catalog.cardinality(p_item_ids) then
    raise exception using errcode = '22023', message = 'A seleção contém material duplicado.';
  end if;
  if exists (select 1 from public.invoices inv where inv.access_key = v_key and inv.id is distinct from p_invoice_id) then
    raise exception using errcode = '23505', message = 'Esta chave de acesso já está cadastrada em outra nota fiscal.';
  end if;

  perform 1 from public.request_items ri where ri.id = any(p_item_ids) order by ri.id for update;
  select count(*) into v_item_count from public.request_items ri where ri.id = any(p_item_ids);
  if v_item_count <> pg_catalog.cardinality(p_item_ids) then
    raise exception using errcode = 'P0002', message = 'Um dos materiais selecionados não existe mais. Atualize a tela.';
  end if;
  if exists (
    select 1 from public.request_items ri join public.requests r on r.id = ri.request_id
    where ri.id = any(p_item_ids) and r.status = 'cancelado'
  ) then
    raise exception using errcode = '22023', message = 'Não é possível vincular materiais de um pedido cancelado a uma nota fiscal.';
  end if;
  if exists (
    select 1 from public.invoice_items ii
    where ii.request_item_id = any(p_item_ids)
      and ii.invoice_id is distinct from p_invoice_id
  ) then
    raise exception using errcode = '23505', message = 'Um dos materiais já está vinculado a outra nota fiscal. Atualize a tela.';
  end if;

  if p_invoice_id is null then
    insert into public.invoices(note_number,access_key,issued_on,notes)
    values (pg_catalog.btrim(p_note_number),v_key,p_issued_on,coalesce(pg_catalog.btrim(p_notes),''))
    returning id into v_invoice_id;
  else
    select inv.id into v_invoice_id from public.invoices inv where inv.id = p_invoice_id for update;
    if v_invoice_id is null then
      raise exception using errcode = 'P0002', message = 'A nota fiscal não existe mais. Atualize a tela.';
    end if;
    select coalesce(array_agg(distinct ri.request_id),'{}'::uuid[]) into v_old_request_ids
      from public.invoice_items ii join public.request_items ri on ri.id = ii.request_item_id
      where ii.invoice_id = v_invoice_id;
    update public.invoices set note_number = pg_catalog.btrim(p_note_number), access_key = v_key,
      issued_on = p_issued_on, notes = coalesce(pg_catalog.btrim(p_notes),'')
    where id = v_invoice_id;
    delete from public.invoice_items where invoice_id = v_invoice_id;
  end if;

  insert into public.invoice_items(invoice_id,request_item_id)
  select v_invoice_id, ids.item_id from pg_catalog.unnest(p_item_ids) as ids(item_id);

  -- Se uma edição retirou o último vínculo de algum material, reabre o pedido.
  update public.requests r set status = 'solicitado', note_number = ''
    where r.id = any(v_old_request_ids) and r.status = 'nota_recebida'
      and exists (select 1 from public.request_items ri left join public.invoice_items ii on ii.request_item_id = ri.id
                  where ri.request_id = r.id and ii.request_item_id is null);

  -- Quando todos os materiais de um pedido já têm nota, avança o status e sincroniza a NF legada.
  update public.requests r
    set status = case when r.status in ('rascunho','solicitado') then 'nota_recebida' else r.status end,
        note_number = case
          when (select count(distinct ii.invoice_id) from public.request_items ri join public.invoice_items ii on ii.request_item_id = ri.id where ri.request_id = r.id) = 1
          then (select inv.note_number from public.request_items ri join public.invoice_items ii on ii.request_item_id = ri.id join public.invoices inv on inv.id = ii.invoice_id where ri.request_id = r.id limit 1)
          else ''
        end
  where r.id in (select ri.request_id from public.request_items ri where ri.id = any(p_item_ids))
    and not exists (
      select 1 from public.request_items ri left join public.invoice_items ii on ii.request_item_id = ri.id
      where ri.request_id = r.id and ii.request_item_id is null
    );

  return v_invoice_id;
end;
$$;
revoke all on function public.save_invoice_with_items(uuid,text,text,date,text,uuid[]) from public, anon;
grant execute on function public.save_invoice_with_items(uuid,text,text,date,text,uuid[]) to authenticated;

create or replace function public.delete_invoice(p_invoice_id uuid)
returns void language plpgsql set search_path = '' as $$
declare v_request_ids uuid[];
begin
  if not coalesce(public.is_app_admin(),false) then
    raise exception using errcode = '42501', message = 'Apenas o administrador pode excluir notas fiscais.';
  end if;
  select coalesce(array_agg(distinct ri.request_id),'{}'::uuid[]) into v_request_ids
    from public.invoice_items ii join public.request_items ri on ri.id = ii.request_item_id
    where ii.invoice_id = p_invoice_id;
  delete from public.invoices where id = p_invoice_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'A nota fiscal não foi encontrada.';
  end if;
  update public.requests r set status = 'solicitado', note_number = ''
    where r.id = any(v_request_ids) and r.status = 'nota_recebida'
      and exists (select 1 from public.request_items ri left join public.invoice_items ii on ii.request_item_id = ri.id
                  where ri.request_id = r.id and ii.request_item_id is null);
end;
$$;
revoke all on function public.delete_invoice(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;

-- Mantém a lista de materiais compatível e acrescenta os dados da nota vinculada.
create or replace view public.v_request_lines with (security_invoker = true) as
select
  i.id as item_id, i.request_id, i.sap_code, i.forms_code,
  i.material, i.process, i.quantity, i.unit_price, i.total,
  i.created_at,
  r.requested_on, r.status, r.note_number, r.notes,
  r.site_id, s.name as site_name, s.center_code, s.carrier_info,
  concat_ws(' ',i.sap_code,i.forms_code,i.material,r.note_number,s.name,s.center_code,inv.note_number,inv.access_key) as search_text,
  inv.id as invoice_id, inv.note_number as invoice_note_number,
  inv.access_key as invoice_access_key, inv.issued_on as invoice_issued_on
from public.request_items i
join public.requests r on r.id = i.request_id
join public.sites s on s.id = r.site_id
left join public.invoice_items ii on ii.request_item_id = i.id
left join public.invoices inv on inv.id = ii.invoice_id;

create or replace view public.v_invoice_lines with (security_invoker = true) as
select
  inv.id as invoice_id, inv.note_number, inv.access_key, inv.issued_on, inv.notes as invoice_notes,
  inv.created_at as invoice_created_at, inv.updated_at as invoice_updated_at,
  i.id as item_id, i.request_id, i.sap_code, i.forms_code, i.material, i.process,
  i.quantity, i.unit_price, i.total, i.created_at as item_created_at,
  r.requested_on, r.status, r.site_id, s.name as site_name, s.center_code
from public.invoices inv
join public.invoice_items ii on ii.invoice_id = inv.id
join public.request_items i on i.id = ii.request_item_id
join public.requests r on r.id = i.request_id
join public.sites s on s.id = r.site_id;

revoke all on public.v_invoice_lines from public, anon;
grant select on public.v_invoice_lines to authenticated;

commit;
