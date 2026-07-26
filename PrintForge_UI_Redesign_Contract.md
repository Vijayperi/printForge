# PrintForge — UI Redesign Contract

**Purpose:** Give this document to the model/session doing the UI redesign. It defines what you may freely change (all visuals) and the small set of **contracts** you must preserve so the redesigned UI stays wired to the working backend (server actions, API routes, hooks, the 3D viewer, and the test suite).

**Repo:** `PrintForge/printforge` (Next.js 16 App Router + TypeScript strict, Tailwind v4, shadcn/ui on Radix, React Three Fiber for 3D). Everything is committed; the app builds and all tests pass at 100% coverage.

---

## 0. How to use this document

1. **Redesign by editing the real components** (recommended) — not by producing separate mockups. That way the wiring travels with the design. If you must design in isolation first, an engineering pass has to re-apply every contract in §4, so prefer editing in place.
2. **Change presentation freely:** markup structure, Tailwind classes, layout, spacing, color, typography, motion, imagery, component composition, adding presentational components.
3. **Preserve the contracts in §4–§7 exactly:** prop names & shapes, form field `name`s, accessible roles/names, `data-*` attributes, links/hrefs, and the action/fetch calls. These are how the UI connects to logic and tests.
4. **After redesigning, run `npm run verify`.** Failing tests are your map of what wiring you disturbed. Fix by restoring the contract (preferred) or, where the structure legitimately changed, update the test to assert the new structure **without dropping the behavioral assertion** (see §8).
5. **Never touch** files under `src/domain/`, `src/adapters/`, `src/data/`, `src/jobs/`, `app/api/`, `src/lib/`, `supabase/`, or any `*.test.*` logic assertions unless a contract genuinely moved. Those are logic, not design.

---

## 1. The one golden rule

> **Style the shell; keep the seams.**
> The "seams" are: (a) what props a component accepts, (b) what it renders that tests/e2e/assistive-tech query (roles, labels, `data-*`), and (c) what it *calls* (a server action or `fetch` to an API route). Restyle everything around those.

---

## 2. Where the visual system lives (make global look-and-feel changes here first)

| Concern | File | Notes |
|---|---|---|
| **Design tokens** (color, radius, dark mode) | `app/globals.css` | CSS custom properties (`--primary`, `--background`, `--ring`, radii, chart colors…) in oklch. Dark mode via the `.dark` class. Changing tokens re-themes every button/badge/card/input at once — do this before restyling individual components. Current brand accent is a "forge orange". |
| **shadcn/ui primitives** | `src/components/ui/*` | Vendored, Radix-based ("new-york" style). Button, Input, Card, Dialog, AlertDialog, Tabs, Switch, Tooltip, Textarea, Badge, Accordion, Separator, Label. Restyle these to restyle the whole app. **If you add a new shadcn component, it must get a test to keep 100% coverage.** Keep it Radix-based (do not switch to Base UI). |
| **Layout primitives** | `src/components/layout/primitives.tsx` | `Container`, `Section`, `PageHeader` — reused everywhere. |
| **All user-facing copy / catalog data** | `src/config/content.ts` | Landing copy, FAQs, example objects, materials, pricing, policies, delivery notice. **Copy lives here, not in markup.** Edit strings here; don't hardcode them in components. |
| **Utility for class merging** | `src/lib/utils.ts` → `cn()` | Use `cn(...)` for conditional/merged Tailwind classes (already the convention). |

**Theming rules:** the app is theme-aware (light/dark). Keep both working. Respect `prefers-reduced-motion` for any animation (the viewer already does; new motion must too).

---

## 3. Framework & pattern rules you must follow (Next 16 specific)

These are non-negotiable or the build/lint/tests fail:

- **Server vs client components.** Pages that fetch data are **async server components** (no `"use client"`). Anything interactive (state, onClick, hooks) is a **client component** with `"use client"` at the top. Don't convert a data-loading server page into a client component.
- **Never call `setState` synchronously inside a `useEffect`.** The `react-hooks` lint rule forbids it and it's enforced. Patterns already in use: close dialogs / refresh via **event handlers** (`useTransition`), derive values during render, or use interval-callback setState. Copy these patterns.
- **Forms use one of two patterns** (keep whichever a component already uses):
  - **Server actions + `useActionState`** (auth, projects) — the form's `action` is a server action; errors come back as `{ fieldErrors, formError, done }`.
  - **`fetch` to an API route inside `useTransition`** (generation, upload) — read `res.ok` / `res.json()`.
- **Dynamic route params are Promises** in Next 16 (`{ params }: { params: Promise<{ id: string }> }`, then `await params`). Don't change route handler signatures.
- **`next/dynamic` + IntersectionObserver** defers the heavy 3D bundle on the landing page (see `DemoSlot`). Keep the deferral if you restyle it.
- **Underscore-prefixed unused args** are allowed by lint (`_foo`); everything else must be used.

---

## 4. The contract inventory — per UI surface

For each surface: the file(s), and the **contracts to preserve** (props / form `name`s / roles & labels / `data-*` / links / calls). Restyle everything else.

### 4.1 Landing page
**Files:** `app/page.tsx`, `src/components/landing/*`
- **Section anchors (do not rename ids):** `#demo`, `#how-it-works`, `#examples`, `#materials`, `#faq`. The header nav links and e2e depend on them.
- **Header** (`site-header.tsx`): brand link → `/`; nav has accessible name **"Main"** (desktop) / **"Main mobile"**; primary CTA link → `/projects`. Mobile menu toggle button labelled "Menu"/"Close" with `aria-expanded`.
- **Hero** (`hero.tsx`): the prompt form has `role="search"` and **`action="/projects"`**; the input's accessible name is the placeholder from content. CTAs "Start creating" / "See examples".
- **DemoSlot** (`demo-slot.tsx`): region labelled **"3D preview demo"** with `id="demo"`; lazy-loads the viewer on scroll. Keep the region + the deferral; restyle the poster.
- **Copy** for every section comes from `src/config/content.ts`. Change copy there.
- Footer policy links point to `/policies/*` slugs from content.

### 4.2 Auth (login / sign-up / reset / profile)
**Files:** `app/(auth)/*`, `src/components/auth/forms.tsx`
- **Server actions** (do not rename or change signatures): `loginAction`, `signUpAction`, `resetRequestAction`, `updatePasswordAction`, `updateProfileAction`, `signOutAction`. Forms wire to these via `useActionState`.
- **Form accessible names & field `name`s (must stay):**
  - Login form: labelled **"Log in"**; fields `email`, `password`; optional hidden `next`.
  - Sign-up form: labelled **"Sign up"**; fields `name`, `email`, `password`, `confirm`.
  - Reset request: labelled **"Reset password"**; field `email`.
  - Update password: labelled **"Set new password"**; fields `password`, `confirm`.
  - Profile: labelled **"Profile"**; field `name`.
- **Error rendering contract:** `FieldError` and `FormError` render `role="alert"`; keep those (tests + a11y rely on them). `ResetRequestForm` shows a `role="status"` success message.
- Buttons: "Log in", "Create account", "Send reset link", "Update password", "Save changes", "Sign out".

### 4.3 Projects list & cards
**Files:** `app/(studio)/projects/page.tsx`, `src/components/projects/*`
- **Server actions:** `createProjectAction`, `renameProjectAction`, `archiveProjectAction` (form fields: create/rename use `title`; rename/archive include hidden `id`).
- **ProjectCard** (`project-card.tsx`): `data-testid="project-card"`; the **title is a link to `/projects/{project.id}`** (this is the entry into the workspace — must remain a navigable link); status shown via Badge; "Rename" (Dialog) and "Archive" (AlertDialog confirm) actions. Buttons: "New project", "Create", "Rename", "Save", "Archive", "Cancel".
- Dialog/AlertDialog **close on success via event handler** (not effect) — keep the `useTransition` pattern.

### 4.4 Creator workspace (the core screen)
**Files:** `app/(studio)/projects/[projectId]/page.tsx`, `src/components/studio/*`
- **Layout intent:** responsive split — desktop = creation controls left / 3D viewer right; **mobile stacks with the viewer first** (PRD §7.2). Preserve the viewer-first-on-mobile intent.
- **CreationPanel** (`creation-panel.tsx`): guided brief form → **POST `/api/projects/{projectId}/generations`** with JSON body fields `rawPrompt`, `intendedUse`, `approxSizeMm` (number), `style`, `durability` (`display|everyday|reinforced`), optional `materialPref`, `colorPref`. On `202 { designVersionId }` it **polls `GET /api/generations/{id}`** (~1.5s) until `ready|failed`, then `router.refresh()`. Handles 400 (policy/validation message), 429 (rate-limited). Preserve these calls, the field names, and the status states (idle / submitting / generating / ready / failed). The prompt field's accessible name is **"What would you like to create?"** (used by e2e); intended use = "Intended use", size = "Approx. size (mm)", style = "Style".
- **StlUpload** (`stl-upload.tsx`): file input `accept=".stl"`, name **`file`**; **POST `/api/uploads/stl`** multipart with `file` + `projectId`; on 201 calls `onUploaded()` (→ `router.refresh()`); shows server `error.message` on failure. Keep the multipart field names and the endpoint.
- **VersionHistory** (`version-history.tsx`): lists versions; **thumbnail `<img src="/api/assets/{thumbnailAssetId}">`**; status badge; **an "Uploaded" badge when `source === "uploaded"`**; `onSelect(version)` reopens a version; selected item marked with `aria-current`.
- **WorkspaceViewer** (`workspace-viewer.tsx`): for a `ready` version with `glb_asset_id`, renders `<ViewerWorkspace url={"/api/assets/" + glbAssetId} projectTitle={...} />`; otherwise a placeholder. **The viewer's model URL is always `/api/assets/{assetId}`** — do not hardcode storage URLs.
- **CreatorWorkspace** (`creator-workspace.tsx`): selection is **derived** from the current versions (falls back to newest ready) so a freshly-generated/uploaded model shows after `router.refresh()`. Keep this derived-selection behavior (don't reintroduce a stale `useState` initializer).

### 4.5 The 3D viewer — special rules (see also §5)
**Files:** `src/viewer/*`
- **`ViewerWorkspace`** is the reusable entry: props `{ url: string; projectTitle: string; swatchColor?: string|null; scaleFactor?: number }`. Embed it; don't rebuild it.
- **Preserve these accessible/queryable hooks** (tests + e2e + a11y): toolbar `role="toolbar"` name **"3D viewer controls"** carrying **`data-viewer-mode`** (`"visual"|"mesh"`); mode buttons **"Visual"** / **"Technical Mesh"**; switches **"Show normals"** / **"Bounding box"**; buttons **"Reset view"**, **"Fit to view"**, **"Fullscreen"**, **"Screenshot"**; a `role="status"` live-region announcer; the texture disclaimer.
- You may restyle the toolbar/controls layout, but keep the roles, names, `data-viewer-mode`, and the fact that every canvas action also has a real button/switch (keyboard accessibility is a hard requirement — PRD/WCAG 2.2 AA).
- The `<canvas>` itself is WebGL (three.js). Don't try to restyle inside the canvas with CSS; visual changes to the 3D scene (materials, lighting) are code changes in `src/viewer/canvas/*` and are out of scope for a CSS redesign.

### 4.6 Ops dashboard
**Files:** `app/(ops)/*` — currently a placeholder; the full ops UI is a later build session (S14). Safe to skip or lightly theme.

---

## 5. The API/action surface the UI talks to (reference)

Do not change these; the UI must keep calling them the same way:
- `POST /api/projects/[id]/generations` → `202 { designVersionId }` | 400 | 429
- `GET /api/generations/[id]` → `{ designVersionId, status }`
- `POST /api/uploads/stl` (multipart: `file`, `projectId`) → `201 { designVersionId }` | 400 | 404 | 5xx
- `GET /api/assets/[id]` → redirects to a signed URL (use as `<img src>` and as the viewer `url`)
- `POST /api/projects` (GET/POST) — projects API
- Server actions (auth + projects) listed in §4.2 and §4.3
- Error bodies are `{ error: { code, message } }`; the `message` is safe to show to users.

---

## 6. Accessibility contract (hard requirement — WCAG 2.2 AA outside the canvas)

Tests use `vitest-axe` and assert **zero violations**, and query by **role/label**, so accessibility *is* part of the wiring:
- Every input has an associated label; keep `htmlFor`/`id` or `aria-label` pairings and the visible label text (many tests do `getByLabelText("…")` / `getByRole("button", { name: "…" })`).
- Keep `role="alert"` for errors, `role="status"` for async status/live regions, `aria-expanded` on toggles, `aria-current` on selected list items, `aria-pressed` on the viewer mode buttons.
- Don't remove focus styles or keyboard operability. Don't replace buttons/links with non-interactive elements + onClick.
- Color is never the only signal (badges/verdicts pair color with text/icon) — keep that.

---

## 7. `data-*` and role hooks that tests & e2e depend on (quick list)

Keep these present (rename only if you also update the corresponding test/e2e):
- `data-viewer-mode` (viewer toolbar) — Playwright asserts it.
- `data-testid="project-card"`, and studio stubs like `model-viewer-stub` in tests.
- `data-slot="…"` on shadcn components (some tests query it) — comes free if you keep the shadcn components.
- Section ids `#demo`/`#how-it-works`/`#examples`/`#materials`/`#faq`.
- Accessible names listed throughout §4 (buttons, forms, nav, toolbar, switches).
- Links: ProjectCard → `/projects/{id}`; header/hero CTAs → `/projects`.

---

## 8. The test safety net & how to update tests after a redesign

- **The 100% coverage gate is your friend.** Run `npm run verify` (typecheck + lint + tests+coverage + build) and `npm run e2e`. Every broken contract shows up as a failing test — that's the redesign's punch-list.
- **Two kinds of test assertions:**
  1. **Behavioral** (a button with name X fires action Y; a form posts to Z; a status message appears) — **never weaken or delete these.** If they fail, you changed wiring; restore it.
  2. **Structural** (this element has this class / this exact markup) — there are few of these; if a redesign legitimately changes structure, update the *query* to the new structure while keeping the behavioral assertion.
- **If you add/remove a presentational element,** coverage may drop; add a small render/interaction/`axe` test for new components (mirror the existing `*.test.tsx` next to any component).
- **Do not lower the coverage thresholds** (100/100/100/100) or broaden the exclusion list in `vitest.config.ts`. The only sanctioned exclusion is the WebGL `ModelViewer.tsx` (documented in `DECISIONS.md`).
- Read **`printforge/DECISIONS.md`** — it records UI-relevant constraints already discovered (e.g., Radix `Select`/`Tabs` couldn't meet the a11y/coverage bar in places, so a native `<select>` and a toggle-button group were used; keep those choices unless you can pass axe + 100% coverage with the Radix versions).

---

## 9. Workflow to attach the redesign to the codebase

1. Branch off `main` (or a worktree). The repo is committed and green.
2. Make global token changes in `app/globals.css`, then restyle `src/components/ui/*`, then each surface's components (§4).
3. Keep copy in `src/config/content.ts`.
4. Run `npm run verify` frequently; treat failures as the contract punch-list (§8).
5. Run `npm run e2e` (and the gated flows with `E2E_SUPABASE=1` + `supabase start` + `npm run dev:worker` if you touched studio/viewer flows).
6. When green, it's ready to merge — the wiring is intact by construction.

---

## 10. Final "did I keep the wiring?" checklist

- [ ] Section ids, nav/toolbar roles & names, `data-viewer-mode`, `data-testid`s intact.
- [ ] Form field `name`s unchanged (auth, project, brief, upload).
- [ ] Server actions still called by the same forms; API `fetch` calls unchanged (endpoints, methods, body shapes).
- [ ] Model images/viewer still use `/api/assets/{id}`.
- [ ] ProjectCard title still links to `/projects/{id}`.
- [ ] No `setState` in `useEffect`; server/client component boundaries unchanged.
- [ ] axe passes; keyboard operability preserved; light+dark both work.
- [ ] `npm run verify` and `npm run e2e` green; coverage still 100%.

---

**If in doubt:** change how it *looks*, not what it *is called* or what it *announces*. Everything you must not break is a name, an id, a `data-*`, a `name=` attribute, an href, or a function call — and they're all listed above.
