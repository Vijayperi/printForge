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

## 2026-07-23 — S8: direct STL upload path

- `src/domain/geometry/stlParse.ts`: binary+ASCII → RawTriangles with typed
  rejections. Size/triangle limits are an injectable `StlLimits` param (default
  50MB / 2M) so the `too_large` branches are testable without huge allocations.
  Binary vs ASCII is disambiguated by exact byte-length match (84+50·n), so a
  binary file whose header starts with "solid" is still parsed as binary. S9's
  geometry engine will consume RawTriangles.
- `convertStlToGlb` (real, three GLTFExporter): needs a `FileReader` polyfill in
  a plain Node runtime (jsdom/browser have it) — extracted as a tested
  `ensureFileReader(host)`. Build-scene / export-glb split so the exporter
  error path is coverable by mocking GLTFExporter.
- UploadScanner adapter: interface + MockScanner (EICAR signature → threat) +
  contract; real scanner is owner-era.
- `POST /api/uploads/stl`: multipart → validate (.stl, ≤50MB) → scanner → parse
  (reject before storing) → ownership → convertStlToGlb + thumbnail → store STL
  + GLB + thumbnail, create DesignVersion(source `uploaded`, ready) with assets
  attached, enqueue `validation.run` (handler lands in S9). File presence is
  DUCK-TYPED (`isUploadedFile`), not `instanceof File`, because the File class
  differs between jsdom and undici; the route test runs with
  `/** @vitest-environment node */` so FormData/Request/File match production.
- StlUpload UI reads the file via `form.elements.namedItem("file")` and clears
  via `input.value = ""` (jsdom's `new FormData(form)` skips file inputs and
  `form.reset()` doesn't clear them). Uploaded versions badged "Uploaded" in
  history. Proven live by `tests/e2e/upload.spec.ts` (no worker needed — the
  route is synchronous).

## 2026-07-24 — S9: geometry analysis engine

- **`src/domain/geometry/` split (all pure, 100% branch-covered via fixtures):**
  `eps.ts` centralizes every tolerance (weld 1e-6, zero-area 1e-12, volume-sign
  1e-9, SAT gap 1e-6, degenerate-axis 1e-12) — no epsilon lives outside it, per
  the plan pitfall. `mesh.ts` welds by quantized position and filters+counts
  degenerate triangles. `edges.ts` (shared undirected edge map) feeds `manifold.ts`
  and `normals.ts`; `unionFind.ts` (typed-array DSU) feeds `components.ts` and the
  manifold boundary-loop count. `measure.ts`, `intersect.ts`, and the `analyze.ts`
  orchestrator round it out.
- **Self-intersection test uses SAT, not Möller.** The classic 11-axis edge-cross
  SAT degenerates for coplanar triangles (all edge-cross axes point out of plane),
  so coplanar-disjoint pairs would falsely report intersection. Augmented with the
  6 in-plane edge-normal axes (n×edge) → 17 axes; adding valid axes never creates
  false separation, so the test is correct for coplanar + skew uniformly and avoids
  Möller's fragile coplanar special-case branches. AABB BVH (median split, leaf ≤ 8)
  narrows candidates; adjacent (shared-welded-vertex) pairs are skipped; count capped
  at 100 with an early-exit flag.
- **`boundary_holes.count` carries total boundary edge count, not loop count.** The
  plan's manifold step says "loop count" but the S10 verdict thresholds on edge count
  (> 100 → fail, ≤ 100 → manual_review). Emitting the decision-critical number as
  `count` and putting the loop count in `detail` serves the pipeline; DECISIONS notes
  the deviation.
- **Finding severities are set for the S9 interim verdict** (pass/fail on *blocking*
  findings only): only `empty_mesh` and `self_intersections` are `blocking` (→ fail);
  `non_manifold_edges`, `boundary_holes`, `inverted_normals` are `warning`;
  `multiple_components`, `degenerate_geometry` are `info`. S10 replaces this with the
  full pass/warning/manual_review/fail mapping against printer/material profiles.
- **Interim terminal status is assigned directly**, not routed through
  `validationMachine.next()`. A fresh terminal report is an initial-state assignment
  (like generation inserting `queued`), not a transition of an existing row; routing
  it through the machine would add an unreachable error branch that breaks the 100%
  gate. The machine (full S×E matrix in `stateMachines/validation.ts`) is fully tested
  and will drive the REVALIDATE/OPERATOR_* transitions S10+ add.
- **Generated path now also enqueues `validation.run`.** Only the S8 upload route
  enqueued it; the S7 ingestion handler did not, so generated models were never
  validated. `handleAssetIngest` now enqueues `validation.run` (same `validate:{dvId}`
  key as upload → idempotent) after attaching assets; `IngestionDeps` gained `queue`.
- **Fixtures are generated in code, not committed as binary STL.** `tests/fixtures/
  models/generators.ts` builds each documented shape (README.md has the expected
  findings + hand-verified numbers); a 100k-triangle binary STL blob (~5 MB) would
  bloat the repo. The perf fixture is a procedural ~100k-tri torus; analysis runs in
  well under a second locally (budget 5 s, asserted < 15 s for ×3 CI margin).
- **`tests/integration/validationRun.test.ts` is written but UNRUN this session** —
  Docker/Supabase were down. It is env-gated (`SUPABASE_INTEGRATION=1`) and mirrors the
  known-good `assetIngest` integration setup; run it with `supabase start` +
  `npm run test:integration`.

## 2026-07-24 — S10: printability reports, profiles, report UI

- **`buildReport` signature returns `{ verdict, findings }`, not `{ …, explanations }`.**
  Plain-language copy is a display concern and lives in `content.ts`
  (`printabilityContent`), keyed by finding kind + verdict, and rendered by the
  PrintabilityPanel. The domain stays copy-free. buildReport computes the two
  scale/profile-derived findings itself (`exceeds_build_volume`, `below_min_wall`)
  and applies the decision table with strict precedence fail > manual_review >
  warning > pass. Every rule + numeric boundary is covered in `report.test.ts`.
- **`boundary_holes` verdict split keys on the finding's `count`** (= total
  boundary edge count, per the S9 decision): > 100 → fail, ≤ 100 → manual_review.
- **`multiple_components` split needs per-component volume**, so `Measurements`
  gained `smallestComponentVolumeFraction` (0..1; 1 for a single body). Computed in
  `components.ts` (per-root signed-volume accumulation) and threaded through
  `measure`/`analyze`. `< 5%` → manual_review, else warning.
- **Overhang is a print-orientation heuristic, kept OUT of `analyzeGeometry`.** A
  separate `analyzeOverhang(mesh)` (merged in by the validation handler) flags
  `unsupported_overhang` when downward faces steeper than 55° from vertical exceed
  15% of the surface — excluding faces resting on the base plane (they carry the
  first layer, not an overhang). Keeping it out of the S9 mesh-validity engine means
  the sphere/torus fixtures stay "clean" and unchanged.
- **`unstable_base` and `trapped_volume` are handled by the verdict mapping but not
  yet emitted by the engine** (base-contact-area and internal-cavity detection are
  owner-era). The decision table + tests cover them via injected findings, so the
  pipeline is complete and future-proof.
- **The verdict is persisted directly as the report status** (Verdict ⊆ terminal
  ValidationState); a fresh report is an initial-state assignment, not a transition.
  `validationMachine` governs the later REVALIDATE / OPERATOR_* transitions (S14+).
  `manual_review` additionally writes a system-actor `audit_events` flag and enqueues
  an idempotent `notification.send(ops_manual_review)` (handler is S16 — the job sits
  pending until then).
- **Moderation-flagged → manual_review is deferred.** buildReport keeps the plan's
  `(findings, measurements, profile, material, scaleFactor)` signature; the brief's
  moderation flag isn't currently persisted on the design version, so wiring it into
  the verdict is left to a later session.
- **PrintabilityPanel** polls `GET /api/design-versions/[id]/validation` via a
  self-rescheduling `setTimeout` (reschedules only while pending; a `key` on the
  component resets it between versions, so the effect never calls setState
  synchronously — the react-hooks lint rule). Verdict badge is icon + text (never
  colour alone). `SCALE_FACTOR = 1` / empty scale hash are placeholders until S11
  threads real configuration scale into the payload.
- **`tests/e2e/validation.spec.ts` is written but UNRUN this session** (Docker/
  Supabase down). Gated on `E2E_SUPABASE=1` + a running worker; covers clean→pass,
  holed→manual_review, oversized→fail.

## 2026-07-24 — S11: print configuration UI

- **Native form controls, not new Radix components.** The Configure tab uses a
  native `<input type="range">` + numeric `<Input>` for size, native `<input
  type="radio">` (visually-hidden + styled `<label>`) for colour/quality/strength,
  and native `<select>` for material/shipping. This continues the S6/S7 precedent
  (native `<select>`, toggle-button groups) — these are axe-clean, keyboard-native,
  and fully coverable under jsdom without Radix pointer-event/portal shims. A future
  UI redesign may swap in Radix Slider/RadioGroup if it can keep axe + 100% coverage.
- **Configure/Printability are a two-tab strip below the viewer, both panels kept
  mounted** (inactive one `hidden`). Keeping both mounted preserves the Configure
  form state + the PrintabilityPanel poll across tab switches, and lets a size
  change's re-validation surface on the Printability tab automatically. Tabs are a
  hand-rolled ARIA `tablist`/`tab`/`tabpanel` (aria-selected/controls/labelledby) —
  no Radix Tabs — so it stays axe-clean and coverable.
- **Live viewer sync is lifted to `CreatorWorkspace`.** `ConfigurePanel` reports
  `{ swatchColor, scaleFactor }` up via `onLiveChange` (event-driven, never
  setState-in-effect); the workspace passes them to `WorkspaceViewer` →
  `ViewerWorkspace`, so the 3D preview tracks colour + scale as the form changes.
- **Re-validation fires only on a scale change** (plan §6-S11 step 3). The config
  POST compares `scaleHash(new) !== scaleHash(prior ?? 1)` and, only then, enqueues
  `validation.run` with the real `scaleFactor`/`scaleHash`/`printerProfileId`/
  `materialId` and idempotency key `validate:{dvId}:{scaleHash}`. Colour/quality/
  strength/shipping changes persist without re-validating. **Consequence:** because
  the report is keyed `(dv, profile, scaleHash)` and material is NOT in the key, a
  material change alone does not refresh `below_min_wall` — the report reflects the
  material current at the last scale-triggering run. Accepted for S11; S12 pricing
  re-reads the live config, and a future revision can add material to the trigger set.
- **`scaleHash(sf) = "s" + round6(sf)`** — a stable, non-empty, human-readable key.
  It doubles as validation-report `scale_hash`, the re-validation job idempotency
  suffix (so re-running a scale de-dupes AND caches its report), and the client's
  "which scaled report am I waiting for" signal (the validation GET now returns
  `scaleHash`). The generation/upload paths omit it → default `""` (unchanged S9/S10).
- **`ConfigurePanel` splits config-load and validation-poll into two effects.** The
  saved config is a one-shot fetch; the base measurements come from a single-fetch,
  self-rescheduling validation poll (mirrors `PrintabilityPanel`). A shared
  `tryInit()` initialises the form exactly once when BOTH the config (or its absence)
  and the base dims are known — whichever lands last — so no setState runs
  synchronously in an effect. The size slider's max is clamped to what fits the build
  volume (`sizeBounds`); the colour swatch grid shows in-stock colours only, but a
  *saved* config referencing a since-out-of-stock colour surfaces an inline violation.
- **S9/S10/S11 carry-overs all cleared this session** (Docker was up): `supabase
  start` + `db reset` → 26 live integration tests pass (incl. S9 `validationRun`),
  and `E2E_SUPABASE=1 npm run e2e` with a running worker → all 14 e2e pass, incl. the
  previously-UNRUN `validation.spec.ts` (S10) and the new `configuration.spec.ts`
  (S11: constraint matrix + resize re-check + per-DV persistence across reload).
