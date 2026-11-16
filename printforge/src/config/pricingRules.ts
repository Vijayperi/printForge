/**
 * Pricing rules (plan §6-S12 step 2). ALL values are launch placeholders — OWNER
 * DECISION REQUIRED before charging real customers. Amounts are INR minor units
 * (paise); rates in basis points (100 bps = 1%).
 */

/** One weight bracket's shipping prices per speed (paise). */
export interface ShippingTier {
  /** Inclusive upper bound of the bracket in grams (`Infinity` = catch-all). */
  maxGrams: number
  ratesMinor: Record<string, number>
}

export interface PricingRules {
  /** ₹/g of filament, per material id (paise). */
  materialRatesMinor: Record<string, number>
  /** Machine time rate, ₹/hour (paise). */
  machineRatePerHourMinor: number
  /** Surcharge on (material + machine) when supports are used (bps). */
  supportsSurchargeBps: number
  /** Flat handling/labour charge (paise). */
  laborFlatMinor: number
  /** Shipping brackets, ordered by ascending `maxGrams` (last is the catch-all). */
  shippingTiers: ShippingTier[]
  /** Reprint/failure allowance on production cost (bps). */
  failureAllowanceBps: number
  /** GST rate (bps) — only charged when `taxMode` is "self". */
  gstBps: number
  /**
   * Dodo Payments is Merchant of Record and may remit tax on our behalf. Until the
   * owner confirms, `mor_handled` keeps the GST line computed but zero; `self`
   * charges it. OWNER DECISION REQUIRED (re-verify at Session 13).
   */
  taxMode: "mor_handled" | "self"
}

export const pricingRules: PricingRules = {
  // OWNER DECISION REQUIRED: real filament costs (kept in sync with profiles.ts).
  materialRatesMinor: { pla: 300, petg: 400 },
  // OWNER DECISION REQUIRED: machine amortisation + power.
  machineRatePerHourMinor: 6000,
  // OWNER DECISION REQUIRED: supports waste + post-processing.
  supportsSurchargeBps: 1500,
  // OWNER DECISION REQUIRED: handling/labour per order.
  laborFlatMinor: 5000,
  // OWNER DECISION REQUIRED: real carrier rates by weight × speed.
  shippingTiers: [
    { maxGrams: 250, ratesMinor: { standard: 6000, express: 15000 } },
    { maxGrams: 1000, ratesMinor: { standard: 9000, express: 20000 } },
    { maxGrams: Number.POSITIVE_INFINITY, ratesMinor: { standard: 15000, express: 30000 } },
  ],
  // OWNER DECISION REQUIRED: observed reprint rate.
  failureAllowanceBps: 800,
  // OWNER DECISION REQUIRED: confirm GST rate + whether we remit it (see taxMode).
  gstBps: 1800,
  taxMode: "mor_handled",
}
