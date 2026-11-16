# PrintForge launch checklist

Everything that must be decided, configured or verified before PrintForge takes
real money from real customers. Plan §6-S16 step 5; the owner inputs are plan §8.

The build is **mock-first**: every external provider defaults to an in-repo mock,
so the app runs with no environment at all. Going live is a sequence of
deliberate flips, each of which makes its own credentials mandatory at boot
(`src/config/env.ts` cross-checks them). Nothing here is code — it is decisions,
accounts and configuration.

Find every unresolved decision in the tree at any time with:

```
grep -rn "OWNER DECISION REQUIRED" src/ .env.example
```

---

## 1. Owner decisions (plan §8)

| # | Decision | Where it lands | Blocks |
|---|---|---|---|
| 1 | Brand name, visual identity, domain | `src/config/content.ts` (`landingContent.brand`) | Launch |
| 2 | Launch geography / serviceable pincodes | `src/config/commerce.ts`, `landingContent.deliveryNotice` | Checkout |
| 3 | GST registration + **tax mode** — confirm whether Dodo's Merchant-of-Record status covers tax on these sales | `src/config/pricingRules.ts` (`taxMode`) | Pricing, invoices |
| 4 | Carrier accounts + per-carrier tracking URL templates | `src/config/commerce.ts` (`SHIPPING_CARRIERS`), `ordersContent.trackingNote` | Shipment emails |
| 5 | Real production + delivery SLAs | `src/config/commerce.ts` | Quote copy |
| 6 | Printer fleet: machines, firmware (OctoPrint confirmed?), build volumes, nozzles | `src/config/profiles.ts`, `supabase/migrations/*_seed_printers.sql`, `PRINTER_GATEWAY_CONFIG` | Dispatch |
| 7 | Material catalog: colours in stock, min wall rules, densities, per-gram prices | `src/config/profiles.ts` | Quoting |
| 8 | Real slicer profiles (`.ini`) per printer × material | `src/config/slicerProfiles/` | Quoting |
| 9 | Cost model: filament cost, machine amortisation + power, waste, labour, carrier rates, reprint rate | `src/config/pricingRules.ts` | Pricing |
| 10 | Starting price shown on the landing page | `src/config/content.ts` (`pricing.startingPriceMinor`) | Landing |
| 11 | Prohibited-content wordlists (the shipped lists are representative starters) | `src/config/moderation.ts` | Generation |
| 12 | Legal text: terms, privacy, refunds/cancellations, acceptable use | `src/config/content.ts` (`policies`) + the pages they link to | Launch |
| 13 | Refund policy wording and the real refund window | `src/config/content.ts` | Checkout |
| 14 | Support channel (the address customers reply to) | `EMAIL_FROM`, `src/config/content.ts` | Emails |
| 15 | Public holidays for the ops due-date calendar | `src/domain/ops/board.ts` (`shiftBusinessDays`) | Ops board accuracy |

> **Item 3 is the one to settle first.** `taxMode: "mor_handled"` currently makes
> GST zero on every quote. If Dodo does *not* remit Indian GST on our behalf,
> every price shown to date is wrong and `pricingRules.ts` must change before a
> single order is taken.

---

## 2. Mock → real flip matrix

Each row is independent: flip one, verify it, flip the next. A provider set to
its real value makes the listed credentials **required at boot** — a missing one
fails startup rather than the first request.

| Seam | Env switch | Credentials required | Smoke test |
|---|---|---|---|
| AI generation | `GENERATION_PROVIDER=meshy` | `MESHY_API_KEY` | Create a project, submit a prompt, watch `generation.submit` → `generation.poll` → `asset.ingest` land a GLB in the viewer |
| Payments | `PAYMENT_PROVIDER=dodo` | `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_PRODUCT_ID`, `DODO_ENV=live_mode` | See §3 below |
| Slicing | `SLICER=prusa` | `PRUSA_SLICER_PATH` (+ profiles in `src/config/slicerProfiles/`) | Request a quote; confirm the G-code asset and a plausible print duration |
| Printer fleet | `PRINTER_GATEWAY=octoprint` | `PRINTER_GATEWAY_CONFIG` (JSON, keyed by `printers.id`) | `/ops/printers` shows real states; release a test print to one bay and watch it walk to `completed` |
| Email | `EMAIL=resend` | `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), `OPS_ALERT_EMAIL` | Place a test order; confirm the receipt arrives and `notification_log` says `sent` |
| Upload scanning | — (still mock-only) | ClamAV or equivalent endpoint | **Not yet implemented against a real service** — see §6 |

`PRINTER_GATEWAY_CONFIG` shape (one entry per bay, keyed by the seeded printer id):

```json
{"prn_01K0PRNSEED000000000000001": {"baseUrl": "http://octopi-bay1.local", "apiKey": "…"}}
```

**After every flip, re-run `npm run verify`.** Its `check:bundle` step greps the
built client bundles for all six server-only credential names *and their values*
and fails the build on a hit.

---

## 3. Dodo Payments go-live

1. Complete Dodo account verification and business onboarding.
2. **Get written confirmation that physical goods are permitted under their
   Merchant-of-Record terms** (plan §8 item 5). PrintForge ships physical
   objects; if Dodo's MoR covers digital goods only, the payment provider must
   change before launch. Nothing else on this list matters until this is answered.
3. Create **one** product, "Custom 3D Print", with **pay-what-you-want enabled** —
   this is what lets the server set each order's amount. Copy its id to
   `DODO_PRODUCT_ID`.
4. Generate a **live-mode** API key → `DODO_API_KEY`; set `DODO_ENV=live_mode`.
5. Register the webhook endpoint `https://<domain>/api/webhooks/dodo`, subscribed
   to `payment.succeeded`, `payment.failed`, `refund.succeeded`, `dispute.opened`.
   Copy the signing secret to `DODO_WEBHOOK_SECRET`.
6. Verify signature rejection is live: replay a webhook with a tampered body and
   confirm a **401** and no order movement.
7. Place one real low-value order end to end, then refund it from the ops console
   and confirm the `refund.succeeded` webhook moves the payment axis.

> The webhook route is deliberately **not** rate-limited: its signature is the
> gate, and throttling a payment provider's retries would drop money on the floor.

---

## 4. Supabase production project

1. Create the production project; record its URL and keys.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`. The service-role key belongs **only** to the
   server and the worker — never to a client-visible variable.
3. Apply migrations: `supabase link --project-ref <ref>` then `supabase db push`.
   Migrations are forward-only.
4. Seed the printer fleet with the real machines (edit the seed migration's ids
   before pushing if the bays differ), then confirm `/ops/printers` lists them.
5. **Verify RLS in production**, not just locally: sign in as two customers and
   confirm neither can read the other's projects, orders or assets.
6. Promote the first operator account: set `profiles.role` to `operator` (or
   `admin`) for that user. The ops surface answers **404** to everyone else, so a
   missing role looks like a missing page.
7. Confirm the storage buckets (`models`, `thumbnails`, `gcode`) are **private**.
   Assets are served only through `/api/assets/[id]`, which checks ownership and
   redirects to a signed URL valid for 10 minutes.

---

## 5. Deployment

- **The worker is a separate process** (PRD §2). `npm run dev:worker` is the
  local form; in production run `scripts/worker.ts` as its own container or
  service. Without it nothing progresses past "queued": generation, ingestion,
  validation, slicing, print polling and *every notification* are jobs.
  - It must keep the `--conditions=react-server` flag.
  - It needs the same environment as the web app, including
    `SUPABASE_SERVICE_ROLE_KEY` and `PRINTER_GATEWAY_CONFIG`.
  - More than one instance is safe: the queue claims jobs atomically and every
    handler is idempotent.
- Set `APP_URL` to the public origin. It is what customer emails link to.
- Give the printer network no route to the public internet; the worker reaches
  the machines, browsers never do (FR-9, enforced by an ESLint boundary and the
  client-bundle grep).
- Run a **Lighthouse mobile audit against the deployed landing page** and confirm
  performance ≥ 90. CI enforces the part that decides it — the landing page's
  initial JavaScript budget and the absence of three.js from it (`npm run
  check:budget`) — but the score itself needs a real deployment.
- Configure long-lived CDN cache headers on the storage objects themselves.
  `/api/assets/[id]` caps its redirect below the signed URL's lifetime, so the
  durable caching has to happen at the edge.

---

## 6. Known gaps to close before launch

These are implemented as seams with mocks behind them. Each needs a real service
before real customers arrive.

- **Upload scanning** — `src/adapters/scanner/` has only `MockScanner`, which
  passes everything. Wire a real scanner (ClamAV endpoint or equivalent) and add
  it to the factory. The route already calls it and refuses a dirty file; only
  the implementation is missing.
- **GLB → STL conversion and thumbnails** — `MockGlbConverter` returns a
  zero-triangle STL and a 1×1 placeholder PNG. Real conversion and an offscreen
  render are owner-era work.
- **Geometry-level GLB compression** — `optimizeGlb` today does lossless
  container work only (JSON minification, dropping ignorable chunks). Meshopt or
  Draco quantization drops in behind the same seam.
- **`unstable_base` and `trapped_volume` findings** — handled everywhere in the
  verdict mapping, but the geometry engine does not emit them yet.

---

## 7. Pre-launch verification

Run in order; all must be green.

```
npm run verify            # types, lint, 100% coverage, build, bundle-secret grep, JS budget
npm run test:integration  # RLS, repositories, webhooks, the print-release interlock
E2E_SUPABASE=1 npm run e2e   # every journey, with the worker running
```

Then, by hand, against production:

- [ ] Sign up, place a real order, and receive the receipt email.
- [ ] Confirm the order appears on `/ops` with the right due date.
- [ ] Approve it, assign a printer, release it, and watch the fleet view move.
- [ ] Record a QC pass, add tracking, and confirm the customer sees "Shipped".
- [ ] Refund it and confirm the payment axis moves only when the webhook lands.
- [ ] Confirm a customer gets a **404** — not a 403 — at `/ops`.
