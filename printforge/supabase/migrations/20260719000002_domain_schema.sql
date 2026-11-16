-- S4: full domain schema (plan §4.5) with RLS, triggers, indexes, grants.
-- Tables are created in FK-dependency order. All ids are prefixed text (the app
-- supplies them via newId(); the md5 default is a safety fallback only).

-- ------------------------------------------------------------------ enums
create type public.design_source_enum as enum ('generated', 'uploaded');
create type public.asset_type_enum as enum (
  'model_glb', 'model_stl', 'model_3mf', 'thumbnail', 'gcode', 'reference_image'
);
create type public.actor_kind_enum as enum ('user', 'system');
create type public.job_status_enum as enum ('pending', 'running', 'done', 'failed', 'dead');

-- helper to default a prefixed id
create or replace function public.gen_prefixed_id(prefix text)
returns text language sql volatile as $$
  select prefix || '_' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 26));
$$;

-- shared updated_at trigger fn already exists from migration 0001 (touch_updated_at)

-- ------------------------------------------------------------------ assets
create table public.assets (
  id text primary key default public.gen_prefixed_id('ast'),
  type public.asset_type_enum not null,
  storage_key text not null unique,
  checksum_sha256 text not null,
  bytes bigint not null,
  mime text not null,
  source_asset_id text references public.assets (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ projects
create table public.projects (
  id text primary key default public.gen_prefixed_id('proj'),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on public.projects (user_id, status);

-- ------------------------------------------------------------- design_versions
create table public.design_versions (
  id text primary key default public.gen_prefixed_id('dv'),
  project_id text not null references public.projects (id) on delete cascade,
  source public.design_source_enum not null,
  version_no int not null,
  prompt text,
  brief_json jsonb,
  provider_task_id text,
  glb_asset_id text references public.assets (id),
  stl_asset_id text references public.assets (id),
  thumbnail_asset_id text references public.assets (id),
  generation_status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version_no)
);
create index design_versions_project_idx on public.design_versions (project_id);

-- design_versions are immutable after creation EXCEPT generation_status and the
-- three asset id columns, and only while generation is not yet 'ready'.
create or replace function public.enforce_design_version_immutable()
returns trigger language plpgsql as $$
begin
  if old.generation_status = 'ready' then
    raise exception 'design_versions are immutable once ready';
  end if;
  if new.project_id is distinct from old.project_id
     or new.source is distinct from old.source
     or new.version_no is distinct from old.version_no
     or new.prompt is distinct from old.prompt
     or new.brief_json is distinct from old.brief_json
     or new.provider_task_id is distinct from old.provider_task_id
     or new.created_at is distinct from old.created_at then
    raise exception 'only generation_status and asset ids may change on a design_version';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
create trigger design_versions_immutable
  before update on public.design_versions
  for each row execute function public.enforce_design_version_immutable();

-- ------------------------------------------------------- validation_reports
create table public.validation_reports (
  id text primary key default public.gen_prefixed_id('vr'),
  design_version_id text not null references public.design_versions (id) on delete cascade,
  printer_profile_id text not null,
  status text not null,
  findings_json jsonb not null default '[]'::jsonb,
  measurements_json jsonb,
  scale_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index validation_reports_dv_idx on public.validation_reports (design_version_id);

-- ------------------------------------------------------ print_configurations
create table public.print_configurations (
  id text primary key default public.gen_prefixed_id('cfg'),
  design_version_id text not null references public.design_versions (id) on delete cascade,
  material_id text not null,
  color_id text not null,
  dimensions_mm jsonb not null,
  scale_factor numeric not null,
  quality_id text not null,
  strength_id text not null,
  shipping_speed text not null,
  special_instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index print_configurations_dv_idx on public.print_configurations (design_version_id);

-- ------------------------------------------------------------------ quotes
create table public.quotes (
  id text primary key default public.gen_prefixed_id('qt'),
  configuration_id text not null references public.print_configurations (id) on delete cascade,
  status text not null default 'active',
  amount_minor bigint not null,
  currency char(3) not null default 'INR',
  breakdown_json jsonb not null default '[]'::jsonb,
  slice_json jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_config_idx on public.quotes (configuration_id);

-- ------------------------------------------------------------------ orders
create table public.orders (
  id text primary key default public.gen_prefixed_id('ord'),
  user_id uuid not null references auth.users (id) on delete cascade,
  quote_id text not null unique references public.quotes (id),
  status text not null default 'pending_payment',
  payment_status text not null default 'unpaid',
  held_from_status text,
  contact_json jsonb not null,
  shipping_address_json jsonb not null,
  provider_session_id text,
  payment_ref text,
  frozen_dv_id text not null references public.design_versions (id),
  frozen_config_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_status_idx on public.orders (user_id, status);

-- ------------------------------------------------------------------ printers
create table public.printers (
  id text primary key default public.gen_prefixed_id('pj'),
  name text not null,
  gateway_kind text not null,
  capabilities_json jsonb not null default '{}'::jsonb,
  current_state text not null default 'idle',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ print_jobs
create table public.print_jobs (
  id text primary key default public.gen_prefixed_id('pj'),
  order_id text not null references public.orders (id) on delete cascade,
  printer_id text references public.printers (id),
  status text not null default 'pending',
  gcode_asset_id text references public.assets (id),
  slice_json jsonb,
  gateway_job_ref text,
  failure_reason text,
  attempt int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index print_jobs_order_idx on public.print_jobs (order_id);
-- one active job per printer (safety interlock, plan §6-S15)
create unique index print_jobs_active_printer_idx
  on public.print_jobs (printer_id)
  where status in ('released', 'printing');

-- ------------------------------------------------------------------ shipments
create table public.shipments (
  id text primary key default public.gen_prefixed_id('shp'),
  order_id text not null references public.orders (id) on delete cascade,
  carrier text not null,
  tracking_number text not null,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shipments_order_idx on public.shipments (order_id);

-- ------------------------------------------------------------- audit_events
create table public.audit_events (
  id text primary key default public.gen_prefixed_id('ntf'),
  actor_id text,
  actor_kind public.actor_kind_enum not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

-- audit_events are INSERT-only.
create or replace function public.block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'table % is insert-only', tg_table_name;
end;
$$;
create trigger audit_events_no_update
  before update or delete on public.audit_events
  for each row execute function public.block_mutation();

-- ------------------------------------------------------------------ jobs
create table public.jobs (
  id text primary key default public.gen_prefixed_id('job'),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status_enum not null default 'pending',
  idempotency_key text not null unique,
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_run_at_idx on public.jobs (status, run_at);

-- ------------------------------------------------------------ webhook_events
create table public.webhook_events (
  id text primary key default public.gen_prefixed_id('ntf'),
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  processing_result text,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ------------------------------------------------------------ notification_log
create table public.notification_log (
  id text primary key default public.gen_prefixed_id('ntf'),
  order_id text references public.orders (id) on delete set null,
  to_email text not null,
  template text not null,
  status text not null,
  message_ref text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_log_order_idx on public.notification_log (order_id);

-- ------------------------------------------------------------- rate_limits
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- updated_at triggers for mutable tables
create trigger assets_touch before update on public.assets
  for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger validation_reports_touch before update on public.validation_reports
  for each row execute function public.touch_updated_at();
create trigger print_configurations_touch before update on public.print_configurations
  for each row execute function public.touch_updated_at();
create trigger quotes_touch before update on public.quotes
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
create trigger printers_touch before update on public.printers
  for each row execute function public.touch_updated_at();
create trigger print_jobs_touch before update on public.print_jobs
  for each row execute function public.touch_updated_at();
create trigger shipments_touch before update on public.shipments
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();
create trigger notification_log_touch before update on public.notification_log
  for each row execute function public.touch_updated_at();

-- ================================================================== RLS
-- Helper: is the current user staff (operator or admin)?
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role in ('operator', 'admin')
  );
$$;

-- Helper: does the current user own the given project?
create or replace function public.owns_project(pid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.user_id = auth.uid()
  );
$$;

-- Helper: does the current user own the project behind a design version?
create or replace function public.owns_design_version(dvid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.design_versions dv
    join public.projects p on p.id = dv.project_id
    where dv.id = dvid and p.user_id = auth.uid()
  );
$$;

alter table public.assets enable row level security;
alter table public.projects enable row level security;
alter table public.design_versions enable row level security;
alter table public.validation_reports enable row level security;
alter table public.print_configurations enable row level security;
alter table public.quotes enable row level security;
alter table public.orders enable row level security;
alter table public.printers enable row level security;
alter table public.print_jobs enable row level security;
alter table public.shipments enable row level security;
alter table public.audit_events enable row level security;
alter table public.jobs enable row level security;
alter table public.webhook_events enable row level security;
alter table public.notification_log enable row level security;
alter table public.rate_limits enable row level security;

-- projects: customers manage their own; staff read all.
create policy projects_select_own on public.projects
  for select using (user_id = auth.uid() or public.is_staff());
create policy projects_insert_own on public.projects
  for insert with check (user_id = auth.uid());
create policy projects_update_own on public.projects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- design_versions: customers manage those under their projects; staff read all.
create policy design_versions_select on public.design_versions
  for select using (public.owns_project(project_id) or public.is_staff());
create policy design_versions_insert on public.design_versions
  for insert with check (public.owns_project(project_id));
create policy design_versions_update on public.design_versions
  for update using (public.owns_project(project_id)) with check (public.owns_project(project_id));

-- print_configurations: via owned design version; staff read all.
create policy print_configurations_select on public.print_configurations
  for select using (public.owns_design_version(design_version_id) or public.is_staff());
create policy print_configurations_insert on public.print_configurations
  for insert with check (public.owns_design_version(design_version_id));
create policy print_configurations_update on public.print_configurations
  for update using (public.owns_design_version(design_version_id))
  with check (public.owns_design_version(design_version_id));

-- orders: customers read their own (writes are server/service-role only); staff read all.
create policy orders_select_own on public.orders
  for select using (user_id = auth.uid() or public.is_staff());

-- shipments: customers read those on their orders; staff read all.
create policy shipments_select on public.shipments
  for select using (
    public.is_staff()
    or exists (select 1 from public.orders o where o.id = shipments.order_id and o.user_id = auth.uid())
  );

-- validation_reports / quotes: customers read those tied to their design versions /
-- configurations; staff read all. Writes are service-role only.
create policy validation_reports_select on public.validation_reports
  for select using (public.owns_design_version(design_version_id) or public.is_staff());
create policy quotes_select on public.quotes
  for select using (
    public.is_staff()
    or exists (
      select 1 from public.print_configurations c
      where c.id = quotes.configuration_id and public.owns_design_version(c.design_version_id)
    )
  );

-- Staff-only read tables. Customers get nothing (no policy → denied).
create policy assets_staff_select on public.assets for select using (public.is_staff());
create policy printers_staff_select on public.printers for select using (public.is_staff());
create policy print_jobs_staff_select on public.print_jobs for select using (public.is_staff());
create policy audit_events_staff_select on public.audit_events for select using (public.is_staff());
create policy notification_log_staff_select on public.notification_log for select using (public.is_staff());
-- jobs, webhook_events, rate_limits: no authenticated access at all (service-role only).

-- ================================================================== grants
grant usage on schema public to anon, authenticated;

-- Customers write these; operators read them (RLS narrows rows).
grant select, insert, update on public.projects to authenticated;
grant select, insert, update on public.design_versions to authenticated;
grant select, insert, update on public.print_configurations to authenticated;
-- Customers read-only; operators read; server writes via service_role.
grant select on public.orders to authenticated;
grant select on public.shipments to authenticated;
grant select on public.validation_reports to authenticated;
grant select on public.quotes to authenticated;
grant select on public.assets to authenticated;
grant select on public.printers to authenticated;
grant select on public.print_jobs to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.notification_log to authenticated;

-- service_role bypasses RLS and manages everything server-side.
grant all on all tables in schema public to service_role;
