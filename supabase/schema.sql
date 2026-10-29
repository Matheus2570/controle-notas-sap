-- NotaFlow: execute todo este script no SQL Editor do seu projeto Supabase.
-- PROTEÇÃO: habilite login e desabilite cadastros públicos em Authentication > Settings.
-- Usuários autenticados visualizam. Apenas o admin pode alterar (RLS).

create extension if not exists pgcrypto;

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) > 0),
  center_code text not null default '',
  carrier_info text not null default '',
  region text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  requested_on date not null default current_date,
  status text not null default 'rascunho'
    check (status in ('rascunho','solicitado','nota_recebida','concluido','cancelado')),
  note_number text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  sap_code text not null default '',
  forms_code text not null default '',
  material text not null default '',
  process text not null default 'indefinido'
    check (process in ('3d','cnc','outro','indefinido')),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  total numeric(18,2) generated always as ((quantity * unit_price)::numeric(18,2)) stored,
  created_at timestamptz not null default now(),
  constraint sap_or_forms_required check (length(trim(sap_code)) > 0 or length(trim(forms_code)) > 0)
);

create table if not exists public.status_history (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists idx_requests_date on public.requests(requested_on desc);
create index if not exists idx_requests_site_status on public.requests(site_id, status);
create index if not exists idx_items_request on public.request_items(request_id);
create index if not exists idx_items_sap on public.request_items(sap_code);
create index if not exists idx_items_forms on public.request_items(forms_code);
create index if not exists idx_history_request on public.status_history(request_id, changed_at desc);

create or replace function public.touch_request_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.log_request_status()
returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace trigger trg_requests_updated_at
before update on public.requests
for each row execute function public.touch_request_updated_at();

create or replace trigger trg_requests_status_history
  after insert or update of status on public.requests
  for each row execute function public.log_request_status();

alter table public.sites enable row level security;
alter table public.requests enable row level security;
alter table public.request_items enable row level security;
alter table public.status_history enable row level security;

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


-- Invoker: a consulta respeita as políticas RLS das tabelas envolvidas.
create or replace view public.v_request_lines with (security_invoker = true) as
select
  i.id as item_id, i.request_id, i.sap_code, i.forms_code,
  i.material, i.process, i.quantity, i.unit_price, i.total,
  i.created_at,
  r.requested_on, r.status, r.note_number, r.notes,
  r.site_id, s.name as site_name, s.center_code, s.carrier_info,
  concat_ws(' ',i.sap_code,i.forms_code,i.material,r.note_number,s.name,s.center_code) as search_text
from public.request_items i
join public.requests r on r.id = i.request_id
join public.sites s on s.id = r.site_id;

create or replace function public.dashboard_stats()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'requests_total', (select count(*) from public.requests),
    'items_total', (select count(*) from public.request_items),
    'pending_total', (select count(*) from public.requests where status in ('rascunho','solicitado')),
    'total_value', (select coalesce(sum(total),0) from public.request_items)
  );
$$;

create or replace function public.site_summary()
returns table(site_id uuid, site_name text, requests_total bigint, items_total bigint, total_value numeric)
language sql stable security invoker set search_path = public as $$
  select s.id, s.name,
    count(distinct r.id), count(i.id), coalesce(sum(i.total),0)::numeric
  from public.sites s
  left join public.requests r on r.site_id=s.id
  left join public.request_items i on i.request_id=r.id
  group by s.id,s.name
  order by coalesce(sum(i.total),0) desc, s.name asc;
$$;

revoke all on public.sites, public.requests, public.request_items, public.status_history from anon;
revoke all on public.v_request_lines from anon;
grant select,insert,update,delete on public.sites,public.requests,public.request_items to authenticated;
grant select on public.status_history,public.v_request_lines to authenticated;
grant usage,select on sequence public.status_history_id_seq to authenticated;
revoke all on function public.dashboard_stats() from public,anon;
revoke all on function public.site_summary() from public,anon;
grant execute on function public.dashboard_stats(), public.site_summary() to authenticated;

-- Sites da imagem. A informação de transportadora pode ser corrigida na interface.
insert into public.sites(name,center_code,carrier_info)
values
  ('Valinhos','3178','10083071 | Nordeste'),
  ('Vinhedo','3166','10122618 | Sudeste'),
  ('Pouso Alegre','5038',''),
  ('Ipojuca','3165',''),
  ('Igarassu','3181',''),
  ('Garanhuns','5029','')
on conflict (name) do nothing;

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


-- NOTAFLOW v1.3 — fluxo de notas fiscais e vínculo com até quatro materiais
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
