-- Seed the print fleet (plan §6-S14 step 4: "assign printer (Select from
-- `printers` seeded via config)").
--
-- The rows live here rather than in a TypeScript config because the ops UI
-- reads the fleet from the table (`listPrinters`) and Session 15's gateway will
-- read per-printer credentials from server env keyed by these ids — a second
-- copy in application code would only be able to drift from this one.
--
-- OWNER DECISION REQUIRED: replace these with the real machines (names, build
-- volumes, materials) before launch. `gateway_kind` stays 'mock' until Session
-- 15 introduces the OctoPrint gateway; ids are stable so re-running the
-- migration or re-seeding a database never duplicates the fleet.

insert into public.printers (id, name, gateway_kind, capabilities_json, current_state)
values
  (
    'prn_01K0PRNSEED000000000000001',
    'Bay 1 — Prusa MK4',
    'mock',
    '{"buildVolumeMm": {"x": 250, "y": 210, "z": 220}, "materials": ["pla", "petg"]}'::jsonb,
    'idle'
  ),
  (
    'prn_01K0PRNSEED000000000000002',
    'Bay 2 — Prusa MK4',
    'mock',
    '{"buildVolumeMm": {"x": 250, "y": 210, "z": 220}, "materials": ["pla", "petg"]}'::jsonb,
    'idle'
  ),
  (
    'prn_01K0PRNSEED000000000000003',
    'Bay 3 — Prusa XL',
    'mock',
    '{"buildVolumeMm": {"x": 360, "y": 360, "z": 360}, "materials": ["pla", "petg", "asa"]}'::jsonb,
    'idle'
  )
on conflict (id) do nothing;
