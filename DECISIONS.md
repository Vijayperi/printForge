# Decisions log

Deviations from `PrintForge_Implementation_Plan.md`, per executor protocol §0.3.

## 2026-07-19 — S1: shadcn style pinned to "new-york" (Radix)

The current `shadcn init` default style ("base-nova") generates components on
Base UI, not Radix. The user requirement is Radix, so `components.json` is
pinned to `"style": "new-york"`. Keep it pinned; re-running `init` would flip it
back.

## 2026-07-19 — S1: vitest 4 has no `coverage.all` option

Plan §5.1 specifies `all: true`. Vitest 4 removed the option; files matching
`coverage.include` are instrumented regardless of being imported by tests,
which is the same behavior (verified: an uncovered file fails the thresholds).
Config simply omits `all`.

## 2026-07-19 — S2: bulk shadcn component adds deferred to consuming sessions

Plan §6-S2 step 2 lists adding Dialog, Sheet, Tabs, Select, Slider, Tooltip,
Toast, Skeleton, DropdownMenu, Table, Form, Textarea, Label, Alert up front.
This conflicts with the stronger normative rule §4.1/§5.1 ("only add components
as they're needed") and would force coverage exclusions for subcomponents that
cannot render in jsdom (e.g. Select scroll buttons) while nothing uses them.
S2 adds only what the landing page consumes (Accordion, Badge, Separator, plus
existing Button/Input/Card); each later session adds and fully tests the
components it introduces. No interface changes.

## 2026-07-19 — S3: `**/*.spec-factory.ts` added to coverage exclusions

Plan §4.4 names shared adapter contract suites `contract.spec-factory.ts`.
They contain only vitest describe/it blocks — test code that happens to live
beside the adapter so both mock and real implementations import it. Excluding
them from coverage mirrors the existing `**/*.test.ts` exclusion; they are
exercised on every test run, not product source.

## 2026-07-19 — S3: `middleware.ts` renamed to `proxy.ts` (Next 16 convention)

Next 16 deprecated the `middleware` file convention in favour of `proxy`
(node_modules/next/dist/docs/.../file-conventions/proxy.md). The file is
`proxy.ts` at the repo root exporting a `proxy(request)` function; behaviour is
identical. It sits outside the `app/`/`src/` coverage globs (like the
`scripts/worker.ts` bootstrap exemption) because it is thin edge-runtime request
plumbing that cannot run under jsdom; its decision logic lives in the fully
covered `src/lib/routeGuard.ts`.

## 2026-07-19 — S3: explicit table GRANTs in the profiles migration

RLS policies filter *which rows* a role sees but Postgres still needs base
GRANTs for the role to touch the table at all. Without `grant select, update on
public.profiles to authenticated` the authenticated client got "permission
denied for table profiles" even with correct policies. Added grants for
`authenticated` (own rows via RLS) and `service_role` (bypasses RLS for
server-side admin). Also: seeded `auth.users` rows must set the GoTrue token
columns (confirmation_token, recovery_token, email_change*, phone_change*,
reauthentication_token) to '' — NULLs make GoTrue's Go scanner 500 on sign-in.

## 2026-07-19 — S3: integration + auth-e2e tests are local-only, gated by env

`tests/integration/**` (Supabase gateway contract + RLS isolation) runs via
`npm run test:integration` (SUPABASE_INTEGRATION=1) and `tests/e2e/auth.spec.ts`
runs via `E2E_SUPABASE=1 npm run e2e`. Both require the local Supabase stack and
are skipped by default so `npm run verify` and the CI `e2e` job stay green
without a Supabase service. CI gains a Supabase service later (owner task).

## 2026-07-19 — S4: repository scope and the fakeDb harness

Plan §6-S4 step 3 says "repositories for all tables." Built now: projects (full
CRUD, reference), assets, design_versions, validation_reports,
print_configurations, quotes, orders, shipments, notification_log, print_jobs,
printers, audit_events, webhook_events — each with the narrow functions their
consuming sessions need (insert + parent/owner-scoped reads + the status updates
the state machines require). Deferred: the `jobs` table's repository (S5 owns the
full JobQueue implementation on it) and `rate_limits` (S5/S16 rate limiter). All
repos depend on a small `Db` abstraction (`src/data/db.ts`) plus helpers
(insertReturning/selectWhere/maybeOneWhere/updateReturning); repository unit
tests run against a PostgREST-shaped in-memory `tests/helpers/fakeDb.ts`
(outside coverage globs — it is test infrastructure), integration/RLS tests run
against local Supabase. This keeps repos free of `@supabase` (enforced by the
new no-restricted-imports ESLint rule) and fully unit-testable without Docker.

## 2026-07-19 — S4: id prefixes added (prn, evt, wh)

The §4.1 prefix list lacked ids for printers, audit_events, and webhook_events.
Added `prn`, `evt`, `wh` to ID_PREFIXES (ids.test.ts iterates the list, so they
are covered automatically).

## 2026-07-22 — S5: queue atomicity via SQL functions + `Db.rpc`

PostgREST cannot express FOR UPDATE SKIP LOCKED, the stale-lock reaper, an
atomic fixed-window rate limiter, or a multi-statement transactional outbox.
S5 adds four SQL functions (`claim_next_job`, `reap_stale_jobs`,
`bump_rate_limit`, `enqueue_generation`) in migration
`20260722000001_job_queue.sql` and extends the `Db` interface with `rpc()`
(fakeDb gets a handler-based `rpc` + `failCall(n)` for multi-op failure tests).
`PostgresJobQueue` uses the builder for enqueue/complete/fail/heartbeat and RPCs
for the atomic claim/reap; backoff math is a pure module. `getServiceDb()`
(service-role, bypasses RLS) is added for the worker. The queue's real
concurrency/dedup is proven by integration tests; unit coverage uses fakeDb +
mocked rpc.

## 2026-07-22 — S5: design_versions immutability relaxed to user content only

S4's trigger froze a design_version entirely once `generation_status='ready'`,
which would block S7's asset ingestion (asset ids are attached after ready) and
S5's need to record `provider_task_id` after the provider accepts. Migration
`20260722000001` replaces the trigger to freeze only USER CONTENT
(project_id, source, version_no, prompt, brief_json, created_at) — FR-2's real
intent — while generation-process fields (generation_status, provider_task_id,
asset ids) evolve as generation runs. Verified live.

## 2026-07-22 — S5: generation lifecycle & outbox

The generation route calls `enqueue_generation` (SECURITY DEFINER, re-checks
ownership) to insert the design_version shell + generation.submit job in ONE
transaction (outbox). Handlers are dependency-injected (db/queue/provider/clock)
for unit testing; the worker (`src/jobs/worker.ts`) wires them and is bootstrapped
by `scripts/worker.ts` (excluded from coverage; run via `npm run dev:worker`).
Poll jobs re-enqueue themselves with an incrementing pollCount key until the
provider reaches a terminal state; ready hands off `asset.ingest` (S7). tsx added
for the worker runtime; eslint now allows `_`-prefixed unused args.

## 2026-07-22 — S6: 3D viewer structure & the coverage boundary

R3F renders to WebGL, which jsdom lacks. To keep 100% coverage honest:
- All viewer logic is pure and unit-tested (`src/viewer/logic/*`, plus
  `sceneStats`/`sceneClone`/`orbitReset`/`download`/`fullscreen` in canvas/).
- Thin R3F wrappers (MeshOverlays, GLBModel, OrbitRig, Lighting, ViewerScene)
  are tested with `@react-three/test-renderer` (no real WebGL). Note: R3F-
  intrinsic-created objects (lights) fail `instanceof` against the test's three
  import, so those specs match on the node `.type` string instead.
- `src/viewer/canvas/ModelViewer.tsx` is the ONLY coverage-excluded viewer file
  (added to vitest exclude): it hosts the raw `<Canvas>` and cannot run under
  jsdom. Its children are covered; Playwright (`tests/e2e/viewer.spec.ts`)
  drives the real canvas and asserts `data-viewer-mode`.
- `ViewerWorkspace` (the container) is covered by mocking ModelViewer.

Other S6 choices: lighting uses explicit lights (no drei `Environment`/HDR) to
stay self-contained (no CDN/CSP dependency). Wireframe/swatch modes render
CLONED materials so the loaded scene is never mutated. The bundled sample
`public/samples/cube.glb` was generated with three's GLTFExporter (a FileReader
polyfill is needed in Node — see the one-off script approach). The landing
DemoSlot lazy-loads the workspace via `next/dynamic` (ssr:false) gated by an
IntersectionObserver, keeping three.js out of the initial bundle. The controls
subagent used an accessible toggle-button group (not shadcn Tabs) for the mode
switch and a role=group (not <dl>) for dimensions to satisfy axe.

## 2026-07-23 — S7: asset pipeline, moderation, creator workspace

- AssetStorage: interface + InMemory (unit/dev) + SupabaseStorage (private
  `models`/`thumbnails` buckets, migration 20260722000002) behind a factory that
  switches on Supabase env. Assets are staff-only under RLS; served to owners via
  `GET /api/assets/[id]` which verifies ownership through an RLS-scoped
  design_version query, then redirects to a short-lived signed URL fetched with
  the service client. `asset.ingest` handler (DI) copies the provider GLB into
  storage, derives STL + thumbnail (MockGlbConverter — real conversion is
  owner-era), attaches all three; idempotent; added to the worker HANDLED_TYPES.
  No provider URL is ever persisted — only storage keys.
- Worker runtime: `scripts/worker.ts` must run with
  `node --conditions=react-server` so the `server-only` package resolves to its
  safe module in a plain Node process (dev:worker script updated).
- Moderation: WordlistModerator (deny→400, flag→allowed but brief marked
  `flagged`) replaces the allow-all mock in the factory; lists in
  `src/config/moderation.ts` (OWNER DECISION REQUIRED). MockModerator kept as a
  covered test double.
- Creator workspace `(studio)/projects/[projectId]`: server page + client
  workspace (viewer-first on mobile), creation panel (POST generation + interval
  polling of GET /api/generations — interval-callback setState, not
  setState-in-effect), version history, and the S6 ViewerWorkspace embedded via
  `/api/assets/{glbId}`. Selection is DERIVED from the current versions (falls
  back to newest ready) so a freshly-ingested model shows after router.refresh
  without a setState-in-effect. Durability uses a native <select> (Radix Select's
  portal/scroll-buttons can't cover under jsdom). ProjectCard now links its title
  to the project detail page.
- Proven live: `tests/integration/assetIngest.test.ts` (real bucket ingest +
  idempotency) and `tests/e2e/creator.spec.ts` (full sign-up→prompt→generate→
  ingest→viewer golden path, ~27s with the worker running).
