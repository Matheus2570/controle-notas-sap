-- NOTAFLOW v1.1 — UPGRADE DE PERMISSÕES E PERSONALIZAÇÃO
-- Execute UMA VEZ no SQL Editor do Supabase já configurado.
-- Pode ser executado novamente sem reabrir acesso de escrita aos visualizadores.
-- O primeiro administrador é atribuído MANUALMENTE no final do README.
begin;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  role text not null default 'viewer' check (role in ('admin','viewer')),
  created_at timestamptz not null default now()
);

-- Usuários antigos recebem acesso SOMENTE LEITURA até serem promovidos no SQL Editor.
insert into public.app_users(user_id, email, role)
select id, coalesce(email,''), 'viewer' from auth.users
on conflict (user_id) do nothing;

create or replace function public.create_app_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_users (user_id,email,role)
  values (new.id,coalesce(new.email,''),'viewer')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notaflow on auth.users;
create trigger on_auth_user_created_notaflow after insert on auth.users
for each row execute function public.create_app_user();

-- A função é executada com privilégios do criador, sem permitir ao usuário
-- alterar a própria função ou se autoproclamar administrador.
create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_users p
    where p.user_id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create table if not exists public.app_config (
  id integer primary key default 1 check (id=1),
  product_name text not null default 'NotaFlow' check (char_length(product_name) between 1 and 36),
  subtitle text not null default 'CONTROLE SAP & FORMS' check (char_length(subtitle) between 1 and 60),
  dashboard_title text not null default 'Seu controle, tudo em um lugar.' check (char_length(dashboard_title) between 1 and 90),
  dashboard_message text not null default 'Acompanhe materiais, encontre Forms pelo SAP e gerencie pedidos de nota sem perder o histórico.' check (char_length(dashboard_message) between 1 and 280),
  accent_color text not null default '#17a89b' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);
insert into public.app_config(id) values(1) on conflict (id) do nothing;

alter table public.app_users enable row level security;
alter table public.app_config enable row level security;

-- Remova as políticas antigas, que deixavam todos os usuários editar tudo.
drop policy if exists "sites_authenticated" on public.sites;
drop policy if exists "requests_authenticated" on public.requests;
drop policy if exists "items_authenticated" on public.request_items;
drop policy if exists "history_select_authenticated" on public.status_history;

-- Políticas separadas: login autorizado lê; somente admin escreve.
drop policy if exists "sites_read" on public.sites;
create policy "sites_read" on public.sites for select to authenticated using (true);
drop policy if exists "sites_admin_insert" on public.sites;
create policy "sites_admin_insert" on public.sites for insert to authenticated with check ((select public.is_app_admin()));
drop policy if exists "sites_admin_update" on public.sites;
create policy "sites_admin_update" on public.sites for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
drop policy if exists "sites_admin_delete" on public.sites;
create policy "sites_admin_delete" on public.sites for delete to authenticated using ((select public.is_app_admin()));

drop policy if exists "requests_read" on public.requests;
create policy "requests_read" on public.requests for select to authenticated using (true);
drop policy if exists "requests_admin_insert" on public.requests;
create policy "requests_admin_insert" on public.requests for insert to authenticated with check ((select public.is_app_admin()));
drop policy if exists "requests_admin_update" on public.requests;
create policy "requests_admin_update" on public.requests for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
drop policy if exists "requests_admin_delete" on public.requests;
create policy "requests_admin_delete" on public.requests for delete to authenticated using ((select public.is_app_admin()));

drop policy if exists "items_read" on public.request_items;
create policy "items_read" on public.request_items for select to authenticated using (true);
drop policy if exists "items_admin_insert" on public.request_items;
create policy "items_admin_insert" on public.request_items for insert to authenticated with check ((select public.is_app_admin()));
drop policy if exists "items_admin_update" on public.request_items;
create policy "items_admin_update" on public.request_items for update to authenticated using ((select public.is_app_admin())) with check ((select public.is_app_admin()));
drop policy if exists "items_admin_delete" on public.request_items;
create policy "items_admin_delete" on public.request_items for delete to authenticated using ((select public.is_app_admin()));

drop policy if exists "history_select_authenticated" on public.status_history;
drop policy if exists "history_read" on public.status_history;
create policy "history_read" on public.status_history for select to authenticated using (true);

-- A tabela de papéis é SOMENTE LEITURA; nem um admin pode mudar
-- seus próprios privilégios pelo browser. Promoção via SQL Editor.
drop policy if exists "app_users_self_read" on public.app_users;
create policy "app_users_self_read" on public.app_users for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "app_config_read" on public.app_config;
create policy "app_config_read" on public.app_config for select to authenticated using (true);
drop policy if exists "app_config_admin_update" on public.app_config;
create policy "app_config_admin_update" on public.app_config for update to authenticated
  using ((select public.is_app_admin())) with check ((select public.is_app_admin()));

revoke all on public.app_users, public.app_config from public, anon, authenticated;
grant select on public.app_users, public.app_config to authenticated;
grant update (product_name,subtitle,dashboard_title,dashboard_message,accent_color)
  on public.app_config to authenticated;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
-- triggers, não APIs do browser
revoke all on function public.create_app_user() from public, anon, authenticated;

commit;

begin;

-- Endurece os gatilhos de data e histórico contra alterações de search_path.
create or replace function public.touch_request_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create or replace function public.log_request_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_history(request_id, previous_status, new_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.status_history(request_id, previous_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

-- Índices auxiliares para consultas frequentes por SAP/Forms, data, centro e NF.
create index if not exists idx_requests_note_number on public.requests(note_number);
create index if not exists idx_sites_center_code on public.sites(center_code);

-- NOTAFLOW v1.2 — gravação transacional e trilha de auditoria
-- Pode ser executado novamente sem duplicar triggers ou políticas.

create table if not exists public.request_activity (
  id bigint generated always as identity primary key,
  request_id uuid not null, -- sem FK intencional: preserva a trilha mesmo após exclusão do pedido
  entity_type text not null check (entity_type in ('request','item')),
  entity_id text not null default '',
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  summary text not null,
  changed_by uuid,
  changed_by_email text not null default '',
  changed_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb
);

create index if not exists idx_request_activity_request_date
  on public.request_activity(request_id, changed_at desc);
create index if not exists idx_request_activity_changed_date
  on public.request_activity(changed_at desc);

alter table public.request_activity enable row level security;
drop policy if exists "request_activity_read" on public.request_activity;
create policy "request_activity_read" on public.request_activity
  for select to authenticated using (true);
revoke all on public.request_activity from public, anon, authenticated;
grant select on public.request_activity to authenticated;

create or replace function public.audit_request_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_entity_id text;
  v_entity_type text;
  v_summary text;
  v_before jsonb;
  v_after jsonb;
  v_action text;
  v_sap text;
  v_forms text;
begin
  v_action := tg_op;
  if tg_table_name = 'requests' then
    v_entity_type := 'request';
    if tg_op = 'INSERT' then
      v_request_id := new.id;
      v_entity_id := new.id::text;
      v_summary := 'Pedido criado';
      v_after := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
      v_request_id := new.id;
      v_entity_id := new.id::text;
      if new.status is distinct from old.status then
        v_summary := 'Situação alterada: ' || old.status || ' → ' || new.status;
      else
        v_summary := 'Dados do pedido atualizados';
      end if;
      v_before := to_jsonb(old);
      v_after := to_jsonb(new);
    else
      v_request_id := old.id;
      v_entity_id := old.id::text;
      v_summary := 'Pedido excluído';
      v_before := to_jsonb(old);
    end if;
  elsif tg_table_name = 'request_items' then
    v_entity_type := 'item';
    if tg_op = 'INSERT' then
      v_request_id := new.request_id;
      v_entity_id := new.id::text;
      v_sap := coalesce(nullif(btrim(new.sap_code), ''), 'não informado');
      v_forms := coalesce(nullif(btrim(new.forms_code), ''), 'não informado');
      v_summary := 'Material adicionado (SAP: ' || v_sap || '; Forms: ' || v_forms || ')';
      v_after := to_jsonb(new);
    elsif tg_op = 'UPDATE' then
      v_request_id := new.request_id;
      v_entity_id := new.id::text;
      v_sap := coalesce(nullif(btrim(new.sap_code), ''), 'não informado');
      v_forms := coalesce(nullif(btrim(new.forms_code), ''), 'não informado');
      v_summary := 'Material atualizado (SAP: ' || v_sap || '; Forms: ' || v_forms || ')';
      v_before := to_jsonb(old);
      v_after := to_jsonb(new);
    else
      v_request_id := old.request_id;
      v_entity_id := old.id::text;
      v_sap := coalesce(nullif(btrim(old.sap_code), ''), 'não informado');
      v_forms := coalesce(nullif(btrim(old.forms_code), ''), 'não informado');
      v_summary := 'Material removido (SAP: ' || v_sap || '; Forms: ' || v_forms || ')';
      v_before := to_jsonb(old);
    end if;
  else
    return null;
  end if;

  insert into public.request_activity (
    request_id, entity_type, entity_id, action, summary,
    changed_by, changed_by_email, before_data, after_data
  ) values (
    v_request_id, v_entity_type, v_entity_id, v_action, v_summary,
    auth.uid(), coalesce(auth.jwt() ->> 'email', ''), v_before, v_after
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_request_activity() from public, anon, authenticated;
drop trigger if exists trg_audit_request_activity on public.requests;
create trigger trg_audit_request_activity
after insert or update or delete on public.requests
for each row execute function public.audit_request_activity();
drop trigger if exists trg_audit_item_activity on public.request_items;
create trigger trg_audit_item_activity
after insert or update or delete on public.request_items
for each row execute function public.audit_request_activity();

-- RPC transacional: o pedido e todos os seus itens são salvos juntos.
-- Se qualquer item falhar na validação, nenhuma parte da alteração é confirmada.
create or replace function public.save_request_with_items(
  p_request_id uuid,
  p_site_id uuid,
  p_requested_on date,
  p_status text,
  p_note_number text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_sap text;
  v_forms text;
  v_material text;
  v_process text;
  v_quantity numeric;
  v_unit_price numeric;
  v_exists boolean;
begin
  if not coalesce(public.is_app_admin(), false) then
    raise exception using errcode = '42501', message = 'Apenas o administrador pode salvar pedidos.';
  end if;

  if p_site_id is null or p_requested_on is null then
    raise exception using errcode = '22023', message = 'Informe o site e a data do pedido.';
  end if;
  if p_status is null or p_status not in ('rascunho','solicitado','nota_recebida','concluido','cancelado') then
    raise exception using errcode = '22023', message = 'A situação do pedido não é válida.';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'A lista de materiais não é válida.';
  end if;
  if pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'Adicione ao menos um material com SAP ou Forms.';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_items) as j(value)
    where coalesce(pg_catalog.btrim(j.value ->> 'sap_code'), '') = ''
      and coalesce(pg_catalog.btrim(j.value ->> 'forms_code'), '') = ''
  ) then
    raise exception using errcode = '22023', message = 'Cada linha precisa ter um código SAP ou Forms.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as j(value)
    where nullif(j.value ->> 'id', '') is not null
    group by j.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'A lista contém uma linha duplicada. Atualize e tente novamente.';
  end if;

  select coalesce(pg_catalog.array_agg((j.value ->> 'id')::uuid), '{}'::uuid[])
    into v_keep_ids
  from pg_catalog.jsonb_array_elements(p_items) as j(value)
  where nullif(j.value ->> 'id', '') is not null;

  if p_request_id is null then
    insert into public.requests(site_id, requested_on, status, note_number, notes)
    values (p_site_id, p_requested_on, p_status, coalesce(pg_catalog.btrim(p_note_number), ''), coalesce(pg_catalog.btrim(p_notes), ''))
    returning id into v_request_id;
  else
    select r.id into v_request_id
    from public.requests as r
    where r.id = p_request_id
    for update;
    if v_request_id is null then
      raise exception using errcode = 'P0002', message = 'O pedido não existe ou não pode ser acessado.';
    end if;
    update public.requests
      set site_id = p_site_id,
          requested_on = p_requested_on,
          status = p_status,
          note_number = coalesce(pg_catalog.btrim(p_note_number), ''),
          notes = coalesce(pg_catalog.btrim(p_notes), '')
      where id = v_request_id
        and (site_id is distinct from p_site_id
          or requested_on is distinct from p_requested_on
          or status is distinct from p_status
          or note_number is distinct from coalesce(pg_catalog.btrim(p_note_number), '')
          or notes is distinct from coalesce(pg_catalog.btrim(p_notes), ''));
  end if;

  delete from public.request_items
  where request_id = v_request_id and not (id = any(v_keep_ids));

  for v_item in select j.value from pg_catalog.jsonb_array_elements(p_items) as j(value) loop
    v_item_id := nullif(v_item ->> 'id', '')::uuid;
    v_sap := coalesce(pg_catalog.btrim(v_item ->> 'sap_code'), '');
    v_forms := coalesce(pg_catalog.btrim(v_item ->> 'forms_code'), '');
    v_material := coalesce(pg_catalog.btrim(v_item ->> 'material'), '');
    v_process := coalesce(nullif(v_item ->> 'process', ''), 'indefinido');
    v_quantity := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1);
    v_unit_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0);

    if v_quantity is null or v_quantity = 'NaN'::numeric or v_quantity <= 0
      or v_unit_price is null or v_unit_price = 'NaN'::numeric or v_unit_price < 0 then
      raise exception using errcode = '22023', message = 'Quantidade deve ser maior que zero e valor unitário não pode ser negativo.';
    end if;
    if v_process not in ('3d','cnc','outro','indefinido') then
      raise exception using errcode = '22023', message = 'O processo informado não é válido.';
    end if;

    if v_item_id is null then
      insert into public.request_items(request_id, sap_code, forms_code, material, process, quantity, unit_price)
      values (v_request_id, v_sap, v_forms, v_material, v_process, v_quantity, v_unit_price);
    else
      perform 1 from public.request_items as ri
      where ri.id = v_item_id and ri.request_id = v_request_id
      for update;
      v_exists := found;
      if not v_exists then
        raise exception using errcode = '22023', message = 'Uma linha de material não pertence a este pedido. Atualize a página e tente novamente.';
      end if;
      update public.request_items
        set sap_code = v_sap, forms_code = v_forms, material = v_material,
            process = v_process, quantity = v_quantity, unit_price = v_unit_price
        where id = v_item_id and request_id = v_request_id
          and (sap_code is distinct from v_sap
            or forms_code is distinct from v_forms
            or material is distinct from v_material
            or process is distinct from v_process
            or quantity is distinct from v_quantity
            or unit_price is distinct from v_unit_price);
    end if;
  end loop;

  return v_request_id;
end;
$$;

revoke all on function public.save_request_with_items(uuid, uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.save_request_with_items(uuid, uuid, date, text, text, text, jsonb) to authenticated;

-- Atualiza a data de alteração da configuração visual.
create or replace function public.touch_app_config_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
drop trigger if exists trg_app_config_updated_at on public.app_config;
create trigger trg_app_config_updated_at before update on public.app_config
for each row execute function public.touch_app_config_updated_at();
revoke all on function public.touch_app_config_updated_at() from public, anon, authenticated;

commit;
