export type Money = { amountMinor: number; currency: "INR" }

export function assertMoneyInvariant(m: Money): void {
  if (!Number.isInteger(m.amountMinor)) {
    throw new Error(`money invariant violated: amountMinor must be an integer, got ${m.amountMinor}`)
  }
  if (m.amountMinor < 0) {
    throw new Error(`money invariant violated: amountMinor must be non-negative, got ${m.amountMinor}`)
  }
  if (m.currency !== "INR") {
    throw new Error(`money invariant violated: currency must be INR, got ${String(m.currency)}`)
  }
}

export function inr(amountMinor: number): Money {
  const m: Money = { amountMinor, currency: "INR" }
  assertMoneyInvariant(m)
  return m
}

export function addMoney(a: Money, b: Money): Money {
  assertMoneyInvariant(a)
  assertMoneyInvariant(b)
  return inr(a.amountMinor + b.amountMinor)
}

/** Multiply by a non-negative factor, rounding half-up to the nearest paisa. */
export function multiplyMoney(m: Money, factor: number): Money {
  assertMoneyInvariant(m)
  if (!Number.isFinite(factor) || factor < 0) {
    throw new Error(`money invariant violated: factor must be a non-negative finite number, got ${factor}`)
  }
  return inr(Math.floor(m.amountMinor * factor + 0.5))
}

/** Percentage in basis points (100 bps = 1%), rounding half-up. */
export function percentOf(m: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error(`money invariant violated: bps must be a non-negative integer, got ${bps}`)
  }
  return multiplyMoney(m, bps / 10_000)
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatINR(m: Money): string {
  assertMoneyInvariant(m)
  return inrFormatter.format(m.amountMinor / 100)
}
