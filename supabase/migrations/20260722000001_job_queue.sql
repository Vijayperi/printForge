-- S5: job-queue SQL functions. These express the operations PostgREST cannot:
-- atomic claim (FOR UPDATE SKIP LOCKED), the stale-lock reaper, an atomic
-- fixed-window rate limiter, and the transactional generation outbox
-- (design_version + job inserted in one transaction).

-- Refine the design_versions immutability trigger. FR-2's immutability is about
-- USER CONTENT (a version is a frozen snapshot of prompt/brief/project/version),
-- not the generation-process fields, which evolve as generation runs and assets
-- are ingested: generation_status, provider_task_id (set on provider accept;
-- needed to correlate webhooks), and the three asset ids (attached after the
-- model is ready, in S7). So freeze only user content.
create or replace function public.enforce_design_version_immutable()
returns trigger language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id
     or new.source is distinct from old.source
     or new.version_no is distinct from old.version_no
     or new.prompt is distinct from old.prompt
     or new.brief_json is distinct from old.brief_json
     or new.created_at is distinct from old.created_at then
    raise exception 'user content on a design_version is immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Atomically claim the next runnable job of an allowed type for a worker.
create or replace function public.claim_next_job(
  p_worker_id text,
  p_types text[],
  p_now timestamptz
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  select id into v_id
    from public.jobs
    where status = 'pending' and run_at <= p_now and type = any (p_types)
    order by run_at asc
    for update skip locked
    limit 1;

  if v_id is null then
    return;
  end if;

  return query
    update public.jobs
      set status = 'running', locked_by = p_worker_id, locked_at = p_now, updated_at = p_now
      where id = v_id
      returning *;
end;
$$;

-- Reset jobs stuck in 'running' past the stale threshold back to 'pending'.
create or replace function public.reap_stale_jobs(
  p_now timestamptz,
  p_threshold_seconds int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.jobs
    set status = 'pending', locked_by = null, locked_at = null, updated_at = p_now
    where status = 'running'
      and locked_at is not null
      and locked_at < p_now - make_interval(secs => p_threshold_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Atomic fixed-window rate limiter. Returns whether the action is allowed and,
-- when denied, how many seconds until the window resets.
create or replace function public.bump_rate_limit(
  p_key text,
  p_window_seconds int,
  p_limit int,
  p_now timestamptz
)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count)
    values (p_key, p_now, 1)
    on conflict (key) do update
      set count = case
            when public.rate_limits.window_start < p_now - make_interval(secs => p_window_seconds)
            then 1 else public.rate_limits.count + 1 end,
          window_start = case
            when public.rate_limits.window_start < p_now - make_interval(secs => p_window_seconds)
            then p_now else public.rate_limits.window_start end
    returning public.rate_limits.window_start, public.rate_limits.count
      into v_window_start, v_count;

  if v_count <= p_limit then
    return query select true, 0;
  else
    return query select
      false,
      ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - p_now)))::int;
  end if;
end;
$$;

-- Transactional outbox: create a design_version shell and its generation.submit
-- job atomically. SECURITY DEFINER (writes the jobs table, which customers
-- cannot touch), so it re-checks project ownership against auth.uid().
create or replace function public.enqueue_generation(
  p_project_id text,
  p_prompt text,
  p_brief jsonb,
  p_idempotency_key text
)
returns table (design_version_id text, job_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dv_id text;
  v_job_id text;
  v_version int;
begin
  if not exists (
    select 1 from public.projects where id = p_project_id and user_id = auth.uid()
  ) then
    raise exception 'not the owner of project %', p_project_id using errcode = '42501';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_version
    from public.design_versions where project_id = p_project_id;

  v_dv_id := public.gen_prefixed_id('dv');
  insert into public.design_versions (id, project_id, source, version_no, prompt, brief_json, generation_status)
    values (v_dv_id, p_project_id, 'generated', v_version, p_prompt, p_brief, 'queued');

  v_job_id := public.gen_prefixed_id('job');
  insert into public.jobs (id, type, payload, idempotency_key, status)
    values (v_job_id, 'generation.submit', jsonb_build_object('designVersionId', v_dv_id), p_idempotency_key, 'pending');

  return query select v_dv_id, v_job_id;
end;
$$;

-- Grants: worker-only functions to service_role; user-facing functions to
-- authenticated (they are SECURITY DEFINER and self-check authorization).
revoke all on function public.claim_next_job(text, text[], timestamptz) from public;
grant execute on function public.claim_next_job(text, text[], timestamptz) to service_role;

revoke all on function public.reap_stale_jobs(timestamptz, int) from public;
grant execute on function public.reap_stale_jobs(timestamptz, int) to service_role;

revoke all on function public.bump_rate_limit(text, int, int, timestamptz) from public;
grant execute on function public.bump_rate_limit(text, int, int, timestamptz) to authenticated, service_role;

revoke all on function public.enqueue_generation(text, text, jsonb, text) from public;
grant execute on function public.enqueue_generation(text, text, jsonb, text) to authenticated, service_role;
