/**
 * Commercial SLAs shown alongside a quote (plan §6-S12 step 4). All placeholders —
 * OWNER DECISION REQUIRED before publishing real delivery promises. Windows are in
 * business days from order confirmation.
 */
export interface DayWindow {
  minDays: number
  maxDays: number
}

export const commerce: {
  productionWindow: DayWindow
  deliveryWindow: DayWindow
} = {
  // OWNER DECISION REQUIRED: real production + delivery SLAs (and whether they vary by speed).
  productionWindow: { minDays: 2, maxDays: 4 },
  deliveryWindow: { minDays: 3, maxDays: 6 },
}
