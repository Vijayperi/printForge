-- S14 step 1: the operations orders board.
--
-- Two additions:
--   1. orders.paid_at — the moment the payment webhook confirmed the order. The
--      board's due date is paid_at + the commerce SLA, and "due before X" has to
--      be a server-side filter, so this cannot be derived per row in the client.
--   2. ops_orders — a read-model view that flattens everything the board filters
--      and sorts on (material, printer, exception reason, amount) into plain
--      columns, so the route needs only equality/range filters and a range page
--      rather than PostgREST embedded-join gymnastics.

alter table public.orders add column if not exists paid_at timestamptz;

-- Backfill: any order already past payment is treated as paid when it was created.
update public.orders set paid_at = created_at
where paid_at is null and payment_status <> 'unpaid';

create index if not exists orders_paid_at_idx on public.orders (paid_at);
create index if not exists orders_status_idx on public.orders (status);

create or replace view public.ops_orders
with (security_invoker = on) as
select
  o.id,
  o.user_id,
  o.status,
  o.payment_status,
  o.held_from_status,
  o.paid_at,
  o.created_at,
  o.quote_id,
  o.frozen_dv_id,
  o.payment_ref,
  o.contact_json ->> 'name'          as customer_name,
  o.contact_json ->> 'email'         as customer_email,
  o.frozen_config_json ->> 'materialId' as material_id,
  q.amount_minor                     as amount_minor,
  pj.id                              as print_job_id,
  pj.printer_id                      as printer_id,
  pj.status                          as print_job_status,
  vr.status                          as validation_status,
  case
    when pj.status = 'failed' then 'print_failed'
    when exists (
      select 1 from public.audit_events ae
      where ae.entity_type = 'order' and ae.entity_id = o.id and ae.action = 'dispute.opened'
    ) then 'dispute'
    when vr.status = 'manual_review' then 'manual_review'
    when o.status = 'on_hold' then 'flagged'
    else null
  end                                as exception_reason
from public.orders o
left join public.quotes q on q.id = o.quote_id
-- The current print job and the current validation report for the FROZEN design
-- version: newest wins, so a retry or a re-validation is what the board shows.
left join lateral (
  select p.id, p.printer_id, p.status
  from public.print_jobs p
  where p.order_id = o.id
  order by p.created_at desc
  limit 1
) pj on true
left join lateral (
  select v.status
  from public.validation_reports v
  where v.design_version_id = o.frozen_dv_id
  order by v.created_at desc
  limit 1
) vr on true;

-- security_invoker means the view runs with the querying role's RLS. Customers
-- can already only see their own orders; staff see all (orders_select_own).
-- The base schema's blanket service_role grant ran before this view existed, so
-- both roles are granted explicitly here.
grant select on public.ops_orders to authenticated;
grant all on public.ops_orders to service_role;
