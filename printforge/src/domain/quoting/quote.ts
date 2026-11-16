import type { PrintConfigurationRow } from "@/src/domain/types"

/** How long a fresh quote stays valid (plan §6-S12 step 3). */
export const QUOTE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The configuration fields that affect price. Colour is deliberately absent — it
 * changes neither the slice nor the price, so a colour change must NOT invalidate
 * a quote (asserted by tests).
 */
export interface QuotePricingInput {
  scaleFactor: number
  materialId: string
  qualityId: string
  strengthId: string
  shippingSpeed: string
}

/**
 * Stable hash of the pricing-relevant configuration. Two configs with the same
 * hash yield the same quote; a change to any field here SUPERSEDEs the old quote
 * and triggers a re-slice/re-price. Scale is rounded to 6 dp so float noise never
 * forks the key.
 */
export function quoteConfigHash(input: QuotePricingInput): string {
  const scale = Math.round(input.scaleFactor * 1e6) / 1e6
  return [scale, input.materialId, input.qualityId, input.strengthId, input.shippingSpeed].join("|")
}

/** Derive the pricing hash from a persisted configuration row. */
export function configHashFromRow(row: PrintConfigurationRow): string {
  return quoteConfigHash({
    scaleFactor: row.scale_factor,
    materialId: row.material_id,
    qualityId: row.quality_id,
    strengthId: row.strength_id,
    shippingSpeed: row.shipping_speed,
  })
}

/** ISO expiry timestamp for a quote created now. */
export function quoteExpiresAt(now: Date): string {
  return new Date(now.getTime() + QUOTE_TTL_MS).toISOString()
}

/** Whether a quote's expiry has passed at `now` (expiry is checked on read). */
export function isExpired(expiresAt: string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime()
}
