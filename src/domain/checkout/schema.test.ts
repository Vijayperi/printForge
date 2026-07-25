import { describe, expect, it } from "vitest"

import { INDIAN_STATES } from "@/src/config/commerce"
import {
  checkoutRequestSchema,
  contactSchema,
  phoneSchema,
  pincodeSchema,
  readStoredAddress,
  readStoredContact,
  shippingAddressSchema,
} from "@/src/domain/checkout/schema"

const ADDRESS = {
  line1: "12 Residency Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560025",
}

const CONTACT = { name: "Asha Rao", email: "asha@example.com", phone: "+919876543210" }

describe("phoneSchema", () => {
  it.each([
    ["+919876543210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["(+91) 98765 43210", "+919876543210"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected)
  })

  it.each([
    ["98765", "too short"],
    ["12345678901", "leading digit not 6-9"],
    ["5876543210", "starts with 5"],
    ["+9198765432101", "too long"],
    ["+1 415 555 0100", "not an Indian number"],
    ["abcdefghij", "not digits"],
  ])("rejects %s (%s)", (input) => {
    expect(phoneSchema.safeParse(input).success).toBe(false)
  })
})

describe("pincodeSchema", () => {
  it("accepts a 6-digit PIN and trims whitespace", () => {
    expect(pincodeSchema.parse(" 560025 ")).toBe("560025")
  })

  it.each(["05600", "560025 1", "56002", "5600255", "0560025", "056002", "abc123"])(
    "rejects %s",
    (input) => {
      expect(pincodeSchema.safeParse(input).success).toBe(false)
    }
  )
})

describe("contactSchema", () => {
  it("accepts a complete contact and trims the name", () => {
    const parsed = contactSchema.parse({ ...CONTACT, name: "  Asha Rao  " })
    expect(parsed).toEqual({ name: "Asha Rao", email: "asha@example.com", phone: "+919876543210" })
  })

  it.each([
    ["empty name", { ...CONTACT, name: "   " }],
    ["bad email", { ...CONTACT, email: "not-an-email" }],
    ["bad phone", { ...CONTACT, phone: "123" }],
    ["missing phone", { name: CONTACT.name, email: CONTACT.email }],
    ["extra key", { ...CONTACT, nickname: "Ash" }],
  ])("rejects %s", (_label, input) => {
    expect(contactSchema.safeParse(input).success).toBe(false)
  })
})

describe("shippingAddressSchema", () => {
  it("defaults the country to IN", () => {
    expect(shippingAddressSchema.parse(ADDRESS).country).toBe("IN")
  })

  it("keeps an optional second address line", () => {
    const parsed = shippingAddressSchema.parse({ ...ADDRESS, line2: "Flat 3B" })
    expect(parsed.line2).toBe("Flat 3B")
  })

  it("accepts every state and union territory in the list", () => {
    for (const state of INDIAN_STATES) {
      expect(shippingAddressSchema.safeParse({ ...ADDRESS, state }).success).toBe(true)
    }
  })

  it.each([
    ["unknown state", { ...ADDRESS, state: "Californiya" }],
    ["non-IN country", { ...ADDRESS, country: "US" }],
    ["empty line1", { ...ADDRESS, line1: "  " }],
    ["empty city", { ...ADDRESS, city: "" }],
    ["bad pincode", { ...ADDRESS, pincode: "12345" }],
    ["extra key", { ...ADDRESS, landmark: "near the park" }],
  ])("rejects %s", (_label, input) => {
    expect(shippingAddressSchema.safeParse(input).success).toBe(false)
  })
})

describe("checkoutRequestSchema", () => {
  const body = { quoteId: "qt_1", contact: CONTACT, shippingAddress: ADDRESS }

  it("accepts {quoteId, contact, shippingAddress}", () => {
    const parsed = checkoutRequestSchema.parse(body)
    expect(parsed.quoteId).toBe("qt_1")
    expect(parsed.shippingAddress.country).toBe("IN")
  })

  // Plan §6-S13 "Done when": the client can never send an amount.
  it.each([
    ["amount", { ...body, amount: 100 }],
    ["amountMinor", { ...body, amountMinor: 100 }],
    ["total", { ...body, total: { amountMinor: 1, currency: "INR" } }],
    ["currency", { ...body, currency: "USD" }],
  ])("rejects a client-supplied %s", (_label, input) => {
    expect(checkoutRequestSchema.safeParse(input).success).toBe(false)
  })

  it("exposes exactly three top-level keys", () => {
    expect(Object.keys(checkoutRequestSchema.shape).sort()).toEqual([
      "contact",
      "quoteId",
      "shippingAddress",
    ])
  })

  it.each([
    ["missing quoteId", { contact: CONTACT, shippingAddress: ADDRESS }],
    ["blank quoteId", { ...body, quoteId: "  " }],
    ["missing contact", { quoteId: "qt_1", shippingAddress: ADDRESS }],
    ["missing address", { quoteId: "qt_1", contact: CONTACT }],
  ])("rejects %s", (_label, input) => {
    expect(checkoutRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe("readStoredContact / readStoredAddress", () => {
  it("reads back a snapshot we wrote ourselves", () => {
    const parsed = shippingAddressSchema.parse(ADDRESS)
    expect(readStoredAddress({ ...parsed })).toEqual({
      line1: parsed.line1,
      line2: "",
      city: parsed.city,
      state: parsed.state,
      pincode: parsed.pincode,
      country: "IN",
    })
  })

  it("keeps an optional second address line when one was stored", () => {
    expect(readStoredAddress({ ...ADDRESS, line2: "Flat 3B" }).line2).toBe("Flat 3B")
  })

  it("never throws on an empty or wrongly-typed snapshot", () => {
    expect(readStoredContact({})).toEqual({ name: "", email: "", phone: "" })
    expect(readStoredContact({ name: 7, email: null, phone: [] })).toEqual({
      name: "",
      email: "",
      phone: "",
    })
    expect(readStoredAddress({}).country).toBe("IN")
    expect(readStoredAddress({ country: 42 }).country).toBe("IN")
  })

  it("reads a contact snapshot back verbatim", () => {
    expect(readStoredContact({ ...CONTACT, phone: "+919876543210" })).toEqual({
      name: CONTACT.name,
      email: CONTACT.email,
      phone: "+919876543210",
    })
  })
})
