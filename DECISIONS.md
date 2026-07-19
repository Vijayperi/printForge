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
