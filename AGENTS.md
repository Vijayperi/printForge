<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# PrintForge

D2C AI-assisted 3D-printing service. Next 16 App Router · React 19 · TS strict · Tailwind v4 · shadcn/ui (Radix) · Supabase · Dodo Payments. This dir is its own git repo; the specs live one level up.

**Read these before starting a build session, not the whole tree:**

- `../PrintForge_Implementation_Plan.md` — §0 executor protocol, §4 normative contracts (4.2 types · 4.3 state machines · 4.4 adapters · 4.5 schema · 4.6 API), §6 the 16 sessions, **§9 session log — read first to resume, update at session end**.
- `DECISIONS.md` — every deviation from the plan, append-only. Add an entry rather than silently diverging.
- `../PrintForge_UI_Redesign_Contract.md` — only when doing visual work.

Do not redesign. Don't swap libraries, rename §4 contracts, or restructure directories. If §4 is impossible as written, implement the closest equivalent **inside the affected adapter**, keep the interface identical, and log it in `DECISIONS.md`.

## Hard rules

- **100% coverage, always.** vitest thresholds are 100/100/100/100. Every function gets tests. The only permitted exclusions are the ones already in `vitest.config.ts`; adding one requires a `DECISIONS.md` entry.
- **`npm run verify` must be green before every commit** (typecheck → lint → coverage → build). Each session ends green and committed.
- **`@supabase/*` may only be imported in `src/data/**` and `proxy.ts`** — ESLint enforces it. Everything else calls a repository that takes a `Db`.
- **`src/domain/**` is pure** — no I/O, no env, no `new Date()`. Inject a `Clock`, a runtime seam, or a client.
- **Payments are Dodo, never Stripe** (owner is in India; Stripe won't onboard). `tests/unit/paymentInvariants.test.ts` guards this.
- **Money is integer paisa** — `Money = {amountMinor, currency: "INR"}`, half-up rounding, `formatINR` to display. No floats.
- Unresolved owner inputs get the greppable comment `OWNER DECISION REQUIRED`.

## Where things go

| | |
|---|---|
| `app/` | routes only — `(auth)`, `(studio)`, `(ops)`, `api/`, `mock-checkout/` |
| `src/adapters/<seam>/` | `index.ts` (interface) · `mock.ts` · real impl · `factory.ts` · `contract.spec-factory.ts` |
| `src/components/` | `ui/` shadcn primitives, then one dir per feature |
| `src/config/` | `env.ts`, `content.ts` (**all copy**), `commerce.ts`, `pricingRules.ts`, `profiles.ts` |
| `src/data/` | one repository per table + `db.ts` (`Db` interface & helpers) + `supabaseClients.ts` |
| `src/domain/` | `types.ts`, `stateMachines/`, `geometry/`, `printability/`, `quoting/`, `pricing/`, `checkout/`, `ops/` |
| `src/jobs/` | `queue.ts`, `worker.ts`, `handlers/` |
| `src/lib/` | `result`, `errors`, `clock`, `money`, `ids`, `opsAuth`, `opsRoute`, `logger`, `utils` |
| `src/viewer/` | `canvas/` (R3F) · `controls/` · `logic/` (all testable logic) |
| `supabase/migrations/` | `YYYYMMDDNNNNNN_name.sql`, forward-only |
| `tests/` | shared infra only — `e2e/`, `integration/`, `fixtures/`, `helpers/`, `msw/` |

Unit and component tests are **colocated** as `<source>.test.ts(x)`.

## Conventions

- Prettier: **no semicolons**, `printWidth: 100`, double quotes. TS `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (indexed access is `T | undefined`; never pass `undefined` for an optional prop).
- Filenames: camelCase in `domain`/`data`/`lib`/`config`/`adapters`; **kebab-case** in `components/`; PascalCase for `viewer/` components.
- Imports: `@/`-absolute, never `../..`. External packages, blank line, then `@/` imports — alphabetized within each group. `import type` for types. `import "server-only"` at the top of server-only modules.
- **No default exports in `src/`** — named only. `export default` is for `app/` pages/layouts; routes are `export async function GET/POST`.
- Failure is a value: return `Result<T>` (`ok`/`err` + `appError(code, msg)`), branch with `if (!x.ok) return x`. try/catch only at real boundaries (`request.json()`, SDK calls). Route errors respond `{error: {code, message}}` via `jsonError`; validate bodies with `parseJsonBody`.
- Ops routes gate on `requireOperator()` and answer **404, never 403** — the ops surface doesn't confirm it exists.
- DB columns stay `snake_case` in Row types; repository arguments are camelCase.
- IDs: `newId("ord")` → prefixed ULID.
- Server components by default; `"use client"` only where interaction needs it. `params`/`searchParams` are Promises — `await` them. Client mutations `fetch` an API route then `router.refresh()`.
- Copy lives in `src/config/content.ts`, never inline in JSX.
- Comments: short JSDoc on exports saying *why*, citing the spec (`plan §6-S14 step 2`); inline `//` only for gotchas. No TODOs, no restating code.
- Tests: one `describe` per exported function, behavioural `it` names, local `Partial<Row>` factories, `it.each` over `as const` tables, and an axe assertion in every component test.

## Commands

```
npm run dev              # :3000
npm run dev:worker       # job worker (keep --conditions=react-server)
npm run verify           # the gate: typecheck + lint + coverage + build
npm test                 # vitest
npm run e2e              # Playwright (E2E_SUPABASE=1 to include DB specs)
npm run test:integration # needs local Supabase; --no-file-parallelism is load-bearing
supabase start && supabase db reset   # local stack; seeded users' password: printforge-dev-123
```

Every provider defaults to a mock, so the app runs with **no env at all**; setting a provider to a real one makes its credentials required (`src/config/env.ts`).

## Known flakes — retry alone before believing them

The full e2e suite is load-flaky (which spec drops varies; each passes in isolation); the 100k-triangle geometry *perf* assertion fails under parallel load; a stale Supabase stack under a different project id squats ports 54321/54322 and breaks all integration tests (`npx supabase stop --project-id <name> --no-backup`).
