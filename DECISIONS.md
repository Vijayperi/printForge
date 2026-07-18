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
