import { z } from "zod"

import { INDIAN_STATES, SHIPPING_COUNTRY } from "@/src/config/commerce"

/** Strip the separators people type into phone fields before validating. */
function stripPhoneSeparators(value: string): string {
  return value.replace(/[\s()-]/g, "")
}

/**
 * Indian mobile number, normalized to `+91XXXXXXXXXX`. Accepts the number with
 * or without the country code / a leading 0, since all three are what customers
 * actually type (plan §6-S13 step 4: "+91 10 digits").
 */
export const phoneSchema = z
  .string()
  .transform(stripPhoneSeparators)
  .refine((v) => /^(?:\+91|91|0)?[6-9]\d{9}$/.test(v), {
    message: "enter a 10-digit Indian mobile number",
  })
  .transform((v) => `+91${v.slice(-10)}`)

/** Indian PIN code: 6 digits, never starting with 0. */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, "enter a 6-digit PIN code")

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1, "enter a name").max(120),
  email: z.email("enter a valid email address"),
  phone: phoneSchema,
})

export const shippingAddressSchema = z.strictObject({
  line1: z.string().trim().min(1, "enter a street address").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "enter a city").max(100),
  state: z.enum(INDIAN_STATES),
  pincode: pincodeSchema,
  country: z.literal(SHIPPING_COUNTRY).default(SHIPPING_COUNTRY),
})

/**
 * Body of `POST /api/checkout/session` (plan §4.6). Strict at every level: the
 * server re-reads the amount from the quote, so a client-supplied `amount` (or
 * any other unexpected key) is a hard validation failure, never silently dropped.
 */
export const checkoutRequestSchema = z.strictObject({
  quoteId: z.string().trim().min(1),
  contact: contactSchema,
  shippingAddress: shippingAddressSchema,
})

export type Contact = z.infer<typeof contactSchema>
export type ShippingAddress = z.infer<typeof shippingAddressSchema>
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

/**
 * Readers for the contact + address snapshots stored on an order. Unlike the
 * request schemas these never reject: an order page must render whatever jsonb
 * we already wrote, so every field falls back to an empty string.
 */
const storedString = z.string().catch("")

const storedContactSchema = z.object({
  name: storedString,
  email: storedString,
  phone: storedString,
})

const storedAddressSchema = z.object({
  line1: storedString,
  line2: storedString,
  city: storedString,
  state: storedString,
  pincode: storedString,
  country: z.string().catch(SHIPPING_COUNTRY),
})

export type StoredContact = z.infer<typeof storedContactSchema>
export type StoredAddress = z.infer<typeof storedAddressSchema>

export function readStoredContact(json: Record<string, unknown>): StoredContact {
  return storedContactSchema.parse(json)
}

export function readStoredAddress(json: Record<string, unknown>): StoredAddress {
  return storedAddressSchema.parse(json)
}
