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

/**
 * The only country PrintForge ships to at launch (plan §6-S13 step 4: India-shaped
 * addresses). ISO 3166-1 alpha-2, as Dodo's `billing_address.country` expects.
 * OWNER DECISION REQUIRED before opening any other destination.
 */
export const SHIPPING_COUNTRY = "IN" as const

/** States and union territories accepted in a shipping address (plan §6-S13 step 4). */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const

export type IndianState = (typeof INDIAN_STATES)[number]
