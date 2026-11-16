import { z } from "zod"

import { commerce } from "@/src/config/commerce"

/** Rows per board page (plan §6-S14 step 1). */
export const OPS_PAGE_SIZE = 25

/**
 * Why an order needs a human. Computed by the `ops_orders` view; listed here so
 * the filter schema and the UI legend cannot drift from it.
 */
export const OPS_EXCEPTION_REASONS = [
  "manual_review",
  "print_failed",
  "dispute",
  "flagged",
] as const
export type OpsExceptionReason = (typeof OPS_EXCEPTION_REASONS)[number]

export const OPS_EXCEPTION_LABELS: Record<OpsExceptionReason, string> = {
  manual_review: "Needs design review",
  print_failed: "Print failed",
  dispute: "Payment disputed",
  flagged: "On hold",
}

/**
 * Board query (plan §4.6 `/api/ops/orders`). Every filter is applied by the
 * database — the board never fetches everything and narrows in the browser.
 */
export const opsOrderFilterSchema = z.strictObject({
  status: z.string().min(1).optional(),
  printerId: z.string().min(1).optional(),
  materialId: z.string().min(1).optional(),
  exception: z.enum(OPS_EXCEPTION_REASONS).optional(),
  /** Calendar day (YYYY-MM-DD) as a date input emits it; matches orders due on or before it. */
  dueBefore: z.iso.date().optional(),
  page: z.coerce.number().int().min(0).default(0),
})

export type OpsOrderFilter = z.infer<typeof opsOrderFilterSchema>

/** Parse a `URLSearchParams`-shaped record, dropping keys that were not supplied. */
export function parseOpsOrderFilter(
  raw: Record<string, string | undefined>
): ReturnType<typeof opsOrderFilterSchema.safeParse> {
  const present: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined && value !== "") present[key] = value
  }
  return opsOrderFilterSchema.safeParse(present)
}

const MS_PER_DAY = 86_400_000

/** Saturday/Sunday are not production days. OWNER DECISION REQUIRED: holidays. */
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

/** Walk `days` business days forward (or backward when negative) from `from`. */
export function shiftBusinessDays(from: Date, days: number): Date {
  const step = days < 0 ? -MS_PER_DAY : MS_PER_DAY
  let remaining = Math.abs(days)
  const cursor = new Date(from.getTime())
  while (remaining > 0) {
    cursor.setTime(cursor.getTime() + step)
    if (!isWeekend(cursor)) remaining -= 1
  }
  return cursor
}

/**
 * The promised-by date for an order: payment + the outer edge of the production
 * and delivery windows. Both windows are OWNER placeholders in `commerce.ts`, so
 * this is a placeholder too — it is what the board sorts and filters on, not a
 * commitment made to the customer.
 */
export const DUE_BUSINESS_DAYS = commerce.productionWindow.maxDays + commerce.deliveryWindow.maxDays

export function dueDateFor(paidAt: string | null): Date | null {
  if (paidAt === null) return null
  const paid = new Date(paidAt)
  if (Number.isNaN(paid.getTime())) return null
  return shiftBusinessDays(paid, DUE_BUSINESS_DAYS)
}

/**
 * The inverse, so "due on or before X" can be pushed into SQL as a bound on
 * `paid_at` — the column that actually exists — rather than computed per row.
 */
export function paidAtCutoffForDue(dueBefore: Date): Date {
  return shiftBusinessDays(dueBefore, -DUE_BUSINESS_DAYS)
}

/** The last instant of a `YYYY-MM-DD` filter day, so "due before" includes that whole day. */
export function endOfDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999Z`)
}
