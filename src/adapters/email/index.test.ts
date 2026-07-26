import { describe, expect, it } from "vitest"

import {
  CUSTOMER_TEMPLATE_KEYS,
  isCustomerTemplate,
  isTemplateKey,
  OPS_TEMPLATE_KEYS,
  TEMPLATE_KEYS,
  templateAudience,
} from "@/src/adapters/email"

/** The seven §4.4 named verbatim; the union may grow past them but never shrink. */
const PLAN_TEMPLATE_KEYS = [
  "order_receipt",
  "review_hold",
  "production_milestone",
  "shipment",
  "cancellation_refund",
  "ops_manual_review",
  "ops_print_failure",
] as const

describe("TEMPLATE_KEYS", () => {
  it("contains every template plan §4.4 requires", () => {
    for (const key of PLAN_TEMPLATE_KEYS) expect(TEMPLATE_KEYS).toContain(key)
  })

  it("is the customer keys followed by the ops keys, with no duplicates", () => {
    expect(TEMPLATE_KEYS).toEqual([...CUSTOMER_TEMPLATE_KEYS, ...OPS_TEMPLATE_KEYS])
    expect(new Set(TEMPLATE_KEYS).size).toBe(TEMPLATE_KEYS.length)
  })
})

describe("isTemplateKey", () => {
  it("accepts a key we render", () => {
    expect(isTemplateKey("order_receipt")).toBe(true)
  })

  it("rejects anything else", () => {
    expect(isTemplateKey("order_delivered")).toBe(false)
  })
})

describe("isCustomerTemplate", () => {
  it.each(CUSTOMER_TEMPLATE_KEYS)("treats %s as customer mail", (key) => {
    expect(isCustomerTemplate(key)).toBe(true)
  })

  it.each(OPS_TEMPLATE_KEYS)("does not treat %s as customer mail", (key) => {
    expect(isCustomerTemplate(key)).toBe(false)
  })
})

describe("templateAudience", () => {
  it("routes customer templates to the customer", () => {
    expect(templateAudience("shipment")).toBe("customer")
  })

  it("routes ops templates to ops", () => {
    expect(templateAudience("ops_dispute_opened")).toBe("ops")
  })
})
