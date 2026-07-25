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

## 2026-07-25 — S12: slicer adapter, pricing engine, quotes (INR)

- **The MockSlicer reads the mesh from storage and derives volume itself** (via the
  S9 geometry engine) rather than taking volume in the payload. The §4.4 `Slicer`
  interface only carries `meshStorageKey`, so both impls read the mesh; volume scales
  by `scaleFactor³`, and `supportsUsed` reuses the S10 overhang heuristic. Deterministic,
  binary-free, self-contained. Writes a stub gcode (text header) to a new `gcode` bucket.
- **PrusaSlicerCli is DI'd over a `PrusaRuntime` seam** (writeTempMesh/run/readGcode/
  cleanup). Its logic (arg building, gcode-comment parsing, orchestration + error paths)
  is 100%-covered against a fake runtime + a captured gcode fixture; only the real
  child_process+fs wrapper (`src/adapters/slicer/nodeRuntime.ts`) is coverage-excluded
  (plan §5.1, like scripts/worker.ts). Real-binary slicing is a `describe.skipIf`.
- **Material ₹/g lives in `pricingRules.ts`, density stays on the material profile.**
  Slicing is physical (density → grams); pricing is commercial (₹/g). The pricing engine
  is pure/Clock-free, emits the seven fixed line keys, `total === Σ lines` (asserted), and
  half-up paisa rounding via the money helpers. Three golden breakdowns are committed in
  `tests/fixtures/pricing/` (kept out of `src/` so they aren't instrumented as source).
- **`taxMode: 'mor_handled'`** — Dodo is Merchant of Record and may remit GST, so the GST
  line is computed but zero until the owner confirms (re-verify at S13). All pricingRules +
  commerce SLAs are `OWNER DECISION REQUIRED` placeholders.
- **Quote freshness is keyed by a `config_hash`** (scale|material|quality|strength|shipping
  — **colour excluded**, a test asserts a colour change doesn't fork the hash). The
  print_configuration row mutates in place per DV, so `configuration_id` alone can't detect
  a pricing change; a migration adds `config_hash` to `quotes`. The slicing.run handler is
  idempotent (no-ops if an active quote already exists for the hash) and self-invalidating
  (no-ops if the config changed since enqueue), so a duplicate enqueue is harmless and a
  lapsed quote can be re-quoted. The POST route's `slicing.run` idempotency key therefore
  carries a per-request ULID rather than deduping on the hash.
- **`transitionOrThrow(machine, from, event)`** added to the machine module: resolves a
  transition the caller knows is legal by construction (literal source state), returning
  the target directly and throwing on an illegal pair. This avoids a dead
  error-handling branch at each always-legal writer (e.g. `active→EXPIRE` on quote read).
  The supersede path instead transitions from each quote's *actual* status over all
  quotes, skipping terminal ones — so both `next()` branches are reachable and covered.
- **Quote expiry is enforced on read** (no cron): GET/POST resolve the fresh active quote
  and EXPIRE a lapsed one in place. The `QuotePanel` is action-driven ("Get a quote" POSTs;
  a 202 shows a slicing skeleton and polls until the quote lands) with all async in a
  single effect guarded by one `active` closure — the pattern that stays 100%-coverable
  (an event-handler `mountedRef` guard's unmount branch proved un-coverable under jsdom).
- **New `gcode` storage bucket** (migration `20260725000001`) — the MockSlicer/PrusaSlicerCli
  write gcode with keyPrefix `gcode`, which `bucketOf` maps to this bucket (found the gap via
  the quote e2e: "Bucket not found").
- **Verified:** 1298 unit @ 100% + `npm run verify` green; 26 live integration; the new
  `quote.spec.ts` (upload → configure → get quote → INR breakdown) passes with Supabase +
  worker. **Full-suite e2e remains flaky under load** (dev-server slowness; plus a
  pre-existing S4 `projects.spec` strict-mode ambiguity unrelated to S12) — every S12/worker
  spec passes in isolation.

## 2026-07-25 — S13 Phase A: order/payment machines, payments adapter, checkout session

- **Dodo docs re-verified at S13 start** (plan §0 rule 4, §2.2) against
  `docs.dodopayments.com/developer-resources/{checkout-session,webhooks}` plus the installed
  `dodopayments@2.43.0` type definitions. Everything §2.2 asserts still holds: SDK client
  `{ bearerToken, environment }`, `client.checkoutSessions.create(...) → { session_id,
  checkout_url }` (single-use, 24 h), pay-what-you-want `amount` in minor units on the
  `product_cart` item, `billing_address.country` as ISO 3166-1 alpha-2, and Standard Webhooks
  headers `webhook-id` / `webhook-timestamp` / `webhook-signature`. **Two points of drift:**
  1. **Refunds have no top-level `amount`.** `RefundCreateParams` is
     `{ payment_id, items?, metadata?, reason? }`; a partial refund is expressed per line item
     (`items: [{ item_id, amount }]`). The §4.4 interface is unchanged — `createRefund(ref,
     amount?)` maps an amount onto the single catalog product, and omits `items` for a full
     refund.
  2. **The SDK now ships its own verifier** (`client.webhooks.unwrap` with a `webhookKey`
     client option). We stay on `standardwebhooks` per §2.2: it is the same spec, and it is
     the one path both the Dodo *and* mock providers can share (the mock signs with it too).
- **`RELEASE_HOLD` is not in the order machine table.** Its target is the stored
  `held_from_status`, which a `(state, event) → state` table cannot express. It ships as
  `releaseHold(state, heldFrom)` beside `orderMachine`, asserted over the full
  state × heldFrom matrix. `on_hold` therefore has no table entries at all, matching §4.3's
  literal wording ("HOLD / CANCEL, any state paid..quality_check") — an operator releases a
  hold before cancelling.
- **`cancelled` stays terminal.** Phase B's "late `payment.succeeded` on a cancelled order"
  case is handled by logging the webhook + an ops alert + an audit row, **not** by a
  `cancelled → on_hold` transition, which §4.3 does not grant.
- **`ORDER_CUSTOMER_LABELS` is total over `OrderState`.** §4.3 names labels for
  paid..delivered only; `pending_payment` ("Confirming payment…"), `on_hold` and `cancelled`
  get labels too so the order pages never fall back to a raw status string (test-asserted).
- **Webhook timestamp tolerance is checked against the injected `Clock` first**, ahead of
  `standardwebhooks`' own ±5 min check (which uses the system clock and cannot be injected).
  Both windows are 5 minutes. Consequence for tests: payloads must be signed at real "now"
  and only the injected clock may be moved.
- **`verify()` returns the parsed body**, so a well-signed but non-JSON payload surfaces as
  `validation`, not `unauthorized` — the two faults are genuinely different and are reported
  separately.
- **The mock provider emits Dodo-shaped payloads** (`{business_id, type, timestamp, data:
  {payload_type, …}}`) signed with a fixed base64 dev key, so the Phase B `/mock-checkout`
  page and E2E travel the *real* verification + normalization path. Session ids are
  `cks_mock_{orderId}` so the dev page recovers the order without any store.
- **Checkout body is `z.strictObject` at every level** — a client-supplied `amount`,
  `amountMinor`, `total` or `currency` is a 400, never a silently dropped key. The amount is
  re-read from the stored quote (test-asserted, plus `tests/unit/paymentInvariants.test.ts`
  guarding Dodo-credential and Stripe leakage from the source tree).
- **`return_url` is `${APP_URL}/orders/{orderId}`.** The plan sketched
  `?session={session_id}`, but the session id only exists *after* creation and is persisted on
  the order anyway; Dodo appends its own status params to the return URL.
- **A failed `createCheckout` cancels the freshly created order** (`pending_payment
  –PAYMENT_FAILED→ cancelled`) rather than leaving a zombie row. The quote stays `consumed`;
  the customer re-quotes, which the S12 flow already self-heals.
- **No migration needed.** The S4 `orders` table already has every column §4.5 requires
  (`held_from_status`, `provider_session_id`, `payment_ref`, `frozen_dv_id`,
  `frozen_config_json`); only a `provider_session_id` writer was added to `src/data/orders.ts`.
- **Verified:** 1702 unit tests @ 100/100/100/100, `npm run verify` green. Phase A ships no
  UI, no webhook route and no e2e — those are Phase B.

## 2026-07-25 — S13 Phase B: webhook route, checkout & orders UI, e2e

- **A webhook whose processing never completed can be re-processed.** The route inserts into
  `webhook_events` first and stamps `processing_result` only on success. A replay of an event
  id whose row still has `processing_result IS NULL` (we crashed, or answered 500) is handed
  back for another attempt; a replay of a *stamped* row answers 200 `duplicate`. Without this,
  a 500 would poison the event id forever — the row would exist, so every Dodo retry would be
  treated as a duplicate and the event would never be applied.
- **"One transaction" is approximated by one row update.** §6-S13 step 3 asks for transactional
  processing, but the PostgREST data layer has no multi-statement transaction. Instead
  `applyPaymentOutcome` writes status + payment axis + payment ref + `held_from_status` in a
  SINGLE atomic `UPDATE`, and everything after it (audit row, queued notification) is
  idempotent-by-key, so a retry converges.
- **Verification failures answer 401 or 400, never 502.** A bad signature is 401; a malformed
  payload of a type we act on is a permanent 400 (`toHttpError` would map its `provider_error`
  to 502, which Dodo retries — pointless, since a malformed body never becomes valid).
- **Refunds and disputes are matched by `payment_ref`, not metadata.** A refund arriving before
  the `payment.succeeded` that would have recorded the reference finds no order and is logged
  `out_of_order` + escalated to ops — never guessed at.
- **Processing-result vocabulary** (stored on `webhook_events.processing_result`, echoed in the
  ACK body): `processed`, `ignored`, `unknown_order`, `out_of_order`, `already_paid`,
  `not_pending`, `late_payment_on_cancelled_order`, `not_holdable`, `illegal_refund`.
- **Late money on a cancelled order is recorded, not transitioned.** `cancelled` is terminal,
  so the payment axis and `payment_ref` are written (the money really did arrive) while the
  fulfillment status stays `cancelled`; ops gets an audit row + an `ops_late_payment`
  notification to refund it. Same principle for an unmatched payment (`ops_payment_unmatched`),
  an unmatched refund (`ops_refund_unmatched`) and every dispute (`ops_dispute_opened`).
- **Ops alerts are queued as `notification.send` jobs.** That handler ships in S16; until then
  the rows sit `pending` (the worker's `HANDLED_TYPES` does not claim them), which is the same
  pattern S10 used for `ops_manual_review`.
- **`freezeConfiguration` moved into `src/domain/checkout/frozenConfig.ts`** and gained a
  `readFrozenConfig` partner so the freeze and the thaw live together. The reader uses
  `z…​.catch(...)` on every field: an order page must render whatever jsonb we already stored,
  even a differently-shaped older row. `readStoredContact`/`readStoredAddress` in `schema.ts`
  follow the same rule.
- **`ORDER_TIMELINE` excludes `on_hold` and `cancelled`.** They are conditions shown *beside*
  the customer track, not stops on it: an on-hold order renders frozen at its
  `held_from_status`, a cancelled one has no position at all.
- **The return page polls itself while `pending_payment`.** Coming back from the payment page
  proves nothing — the webhook settles the order — so `OrderStatus` calls `router.refresh()`
  every 2s until the status moves off `pending_payment`.
- **`/mock-checkout/{sessionId}` signs both outcomes server-side** and the client POSTs the raw
  body byte-for-byte. It 404s unless `NODE_ENV !== production` AND `PAYMENT_PROVIDER === mock`.
- **Fixed a pre-existing S4 e2e bug:** `projects.spec.ts` asserted `getByText("Renamed print")`,
  which matches both the project card and the closing rename dialog's description (strict-mode
  violation). Scoped to the card. This was the last blocker to a fully green e2e suite.
- **Verified:** 1857 unit tests @ 100/100/100/100, `npm run verify` green; 8 new live
  integration cases for the webhook route (34 integration total, 1 pre-existing cross-file
  flake in `generationFlow` — a stale `validation.run` job from another file gets claimed;
  passes alone); **all 17 Playwright specs green serially** with Supabase + worker.

## 2026-07-25 — S14 Phase A: ops board, order detail, review workflow

- **S14 is split into two half-sessions**, like S13, for token budget. Phase A is the *review*
  half (§6-S14 steps 1–3): board, order detail, review workflow. Phase B is the *production*
  half (steps 4–5): print-job controls, shipment form, ops Playwright journey.
- **New: `orders.paid_at`** (migration `20260725000002`). §4.5 does not list it, but the board's
  due date is "paid_at + SLA" and "due before X" has to be a server-side filter, so it cannot be
  derived per row. Stamped by the payment webhook at the moment of confirmation — deliberately
  not `created_at` and not a SQL default. Existing paid rows are backfilled from `created_at`.
- **New: the `ops_orders` view**, a read model that flattens material, printer, current print-job
  status, current verdict, amount and exception reason onto one row. The alternative was
  PostgREST embedded joins plus JSON-path filters, which our narrow `Db` interface cannot express
  and the fake db cannot emulate. A view keeps the route to plain equality/range filters. It is
  `security_invoker = on`, so customer RLS still applies through it; the base schema's blanket
  `service_role` grant ran before the view existed, so both grants are repeated in the migration.
- **Exception-reason precedence** (encoded in the view, asserted in live integration):
  `print_failed` > `dispute` > `manual_review` > `flagged`. A failed machine outranks a dispute
  because it is the thing that stops production right now. `flagged` is the residual case: an
  order on hold for a reason that is not a dispute, i.e. an operator hold.
- **"Newest wins"** for both the print job and the validation report (lateral joins), so a retry
  or a re-validation is what the board shows rather than the original.
- **`Db` gained `lte`, `gte` and `range`**, plus a `selectPage` helper. Paging reads
  `pageSize + 1` rows and reports the extra as `hasMore` instead of requesting an exact `count`,
  which would cost a second scan on every keystroke. The fake db learned the same operations, and
  `eq` now understands PostgREST's `column->>key` JSON path.
- **Due dates are business days.** `shiftBusinessDays` skips Saturday and Sunday in both
  directions, and `paidAtCutoffForDue` is its exact inverse so the SQL bound and the displayed
  date always agree (test-asserted). OWNER DECISION REQUIRED: public holidays.
- **The board is a plain GET form.** Filters live in the query string, so a filtered board is a
  shareable URL, the back button works, and nothing about the filtering needs JavaScript.
- **Operator notes are `audit_events` rows** (`action: 'order.note'`) rather than a new table.
  That table is INSERT-only by trigger, so "append-only and attributed" is enforced by the
  database instead of by convention — and no migration is needed.
- **Rejecting refunds before it cancels.** If the provider refuses the refund the order stays in
  `design_review` and the operator can retry, rather than being cancelled with the money still
  held. The payment axis is NOT moved here: only the provider's `refund.succeeded` webhook may do
  that (§6-S13), so we never mark money returned on our own say-so.
- **Ops routes answer 404, never 403** (`requireOperator`), matching `decideRoute` from S3: the
  ops surface does not confirm its own existence to a customer.
- **Fixed a long-standing integration flake:** `npm run test:integration` now runs with
  `--no-file-parallelism`. DB-backed test files share one Postgres and one job queue, so
  `generationFlow`'s worker was claiming `validation.run` jobs enqueued by other files running
  concurrently. That test also parks any already-pending jobs before enqueuing its own.
- **Verified:** 2047 unit tests @ 100/100/100/100, `npm run verify` green; 45 live integration
  (11 of them new, proving the view's SQL — the fake db cannot express lateral joins or the
  exception CASE), green twice in a row. E2E: 16/17 on a full serial run with a fresh stack;
  the one failure is the **pre-existing dev-server load flakiness** — every worker-dependent spec
  passes in isolation, and which spec drops varies between runs. No ops e2e yet: that is Phase B
  step 5.
