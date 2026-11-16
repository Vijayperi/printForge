import type { PricingRules, ShippingTier } from "@/src/config/pricingRules"
import type { QuoteBreakdownLine } from "@/src/domain/types"
import { addMoney, inr, multiplyMoney, percentOf, type Money } from "@/src/lib/money"

/** The slice facts pricing depends on (a subset of the adapter's SliceResult). */
export interface PriceableSlice {
  materialGrams: number
  durationMinutes: number
  supportsUsed: boolean
}

/** The configuration facts pricing depends on (colour deliberately absent). */
export interface PriceableConfig {
  materialId: string
  shippingSpeed: string
}

export interface PriceResult {
  total: Money
  lines: QuoteBreakdownLine[]
}

/** Fixed line order + labels (keys are the §6-S12 contract; labels are display copy). */
const LABELS: Record<string, string> = {
  material: "Material",
  machine_time: "Machine time",
  supports: "Supports",
  labor: "Labour",
  failure_allowance: "Reprint allowance",
  shipping: "Shipping",
  tax: "GST",
}

function line(key: keyof typeof LABELS, amount: Money): QuoteBreakdownLine {
  return { key, label: LABELS[key] as string, amount }
}

/** Shipping price for a weight in the first bracket that contains it, per speed. */
export function shippingRateMinor(tiers: ShippingTier[], grams: number, speed: string): number {
  const tier = tiers.find((t) => grams <= t.maxGrams) ?? tiers[tiers.length - 1]
  return tier === undefined ? 0 : (tier.ratesMinor[speed] ?? 0)
}

/**
 * Price a slice + configuration into an INR breakdown (plan §6-S12 step 2). Pure,
 * Clock-free, and deterministic. The seven line keys are fixed; `total` is exactly
 * the sum of the lines (asserted by tests). Rounding is half-up to the paisa
 * (via the money helpers).
 */
export function price(slice: PriceableSlice, config: PriceableConfig, rules: PricingRules): PriceResult {
  const ratePerGram = rules.materialRatesMinor[config.materialId] ?? 0

  const material = multiplyMoney(inr(ratePerGram), slice.materialGrams)
  const machine = multiplyMoney(inr(rules.machineRatePerHourMinor), slice.durationMinutes / 60)
  const supports = slice.supportsUsed
    ? percentOf(addMoney(material, machine), rules.supportsSurchargeBps)
    : inr(0)
  const labor = inr(rules.laborFlatMinor)

  const production = [material, machine, supports, labor].reduce(addMoney, inr(0))
  const failureAllowance = percentOf(production, rules.failureAllowanceBps)
  const shipping = inr(shippingRateMinor(rules.shippingTiers, slice.materialGrams, config.shippingSpeed))

  const preTax = addMoney(addMoney(production, failureAllowance), shipping)
  const tax = rules.taxMode === "self" ? percentOf(preTax, rules.gstBps) : inr(0)

  const lines: QuoteBreakdownLine[] = [
    line("material", material),
    line("machine_time", machine),
    line("supports", supports),
    line("labor", labor),
    line("failure_allowance", failureAllowance),
    line("shipping", shipping),
    line("tax", tax),
  ]
  const total = lines.reduce((sum, l) => addMoney(sum, l.amount), inr(0))
  return { total, lines }
}
