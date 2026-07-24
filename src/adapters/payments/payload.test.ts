import { describe, expect, it } from "vitest"

import { normalizePaymentPayload } from "@/src/adapters/payments/payload"
import { inr } from "@/src/lib/money"

import disputeOpened from "@/tests/fixtures/dodo/webhook-dispute-opened.json"
import paymentFailed from "@/tests/fixtures/dodo/webhook-payment-failed.json"
import paymentSucceeded from "@/tests/fixtures/dodo/webhook-payment-succeeded.json"
import refundSucceeded from "@/tests/fixtures/dodo/webhook-refund-succeeded.json"
import subscriptionRenewed from "@/tests/fixtures/dodo/webhook-subscription-renewed.json"

const asPayload = (fixture: unknown) => fixture as Record<string, unknown>

describe("normalizePaymentPayload", () => {
  it("maps payment.succeeded from the documented payload", () => {
    const result = normalizePaymentPayload("evt_1", asPayload(paymentSucceeded))
    expect(result).toEqual({
      ok: true,
      value: {
        type: "payment.succeeded",
        eventId: "evt_1",
        paymentRef: "pay_8Jw3nQx1Ab",
        amount: inr(24360),
        metadata: {
          order_id: "ord_01JZ0000000000000000000000",
          quote_id: "qt_01JZ0000000000000000000000",
        },
      },
    })
  })

  it("maps payment.failed and prefers error_message as the reason", () => {
    const result = normalizePaymentPayload("evt_2", asPayload(paymentFailed))
    expect(result.ok && result.value).toMatchObject({
      type: "payment.failed",
      eventId: "evt_2",
      reason: "The card issuer declined the payment.",
    })
  })

  it("falls back to error_code when there is no error_message", () => {
    const data = { ...(paymentFailed.data as Record<string, unknown>), error_message: null }
    const result = normalizePaymentPayload("evt_2", { ...paymentFailed, data })
    expect(result.ok && result.value).toMatchObject({ reason: "card_declined" })
  })

  it("falls back to a generic reason when the payload carries neither", () => {
    const data = {
      ...(paymentFailed.data as Record<string, unknown>),
      error_message: null,
      error_code: null,
    }
    const result = normalizePaymentPayload("evt_2", { ...paymentFailed, data })
    expect(result.ok && result.value).toMatchObject({ reason: "payment failed" })
  })

  it("defaults absent metadata to an empty object", () => {
    const data = { ...(paymentFailed.data as Record<string, unknown>) }
    delete data["metadata"]
    const result = normalizePaymentPayload("evt_2", { ...paymentFailed, data })
    expect(result.ok && result.value).toMatchObject({ metadata: {} })
  })

  it("stringifies non-string metadata values", () => {
    const data = {
      ...(paymentSucceeded.data as Record<string, unknown>),
      metadata: { attempt: 2, retried: true, order_id: "ord_1" },
    }
    const result = normalizePaymentPayload("evt_1", { ...paymentSucceeded, data })
    expect(result.ok && result.value).toMatchObject({
      metadata: { attempt: "2", retried: "true", order_id: "ord_1" },
    })
  })

  it("maps refund.succeeded with its refunded amount", () => {
    const result = normalizePaymentPayload("evt_3", asPayload(refundSucceeded))
    expect(result).toEqual({
      ok: true,
      value: {
        type: "refund.succeeded",
        eventId: "evt_3",
        paymentRef: "pay_8Jw3nQx1Ab",
        amount: inr(10000),
      },
    })
  })

  it("maps dispute.opened", () => {
    const result = normalizePaymentPayload("evt_4", asPayload(disputeOpened))
    expect(result).toEqual({
      ok: true,
      value: { type: "dispute.opened", eventId: "evt_4", paymentRef: "pay_8Jw3nQx1Ab" },
    })
  })

  it("ignores event types we do not act on", () => {
    const result = normalizePaymentPayload("evt_5", asPayload(subscriptionRenewed))
    expect(result).toEqual({
      ok: true,
      value: { type: "ignored", eventId: "evt_5", rawType: "subscription.renewed" },
    })
  })

  it.each([
    ["no type", { data: {} }],
    ["no data", { type: "payment.succeeded" }],
    ["data is not an object", { type: "payment.succeeded", data: "nope" }],
  ])("rejects an envelope with %s", (_label, payload) => {
    const result = normalizePaymentPayload("evt_x", payload as Record<string, unknown>)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("provider_error")
  })

  it.each([
    [
      "payment.succeeded missing payment_id",
      { type: "payment.succeeded", data: { total_amount: 100, currency: "INR" } },
    ],
    [
      "payment.succeeded in another currency",
      {
        type: "payment.succeeded",
        data: { payment_id: "pay_1", total_amount: 100, currency: "USD" },
      },
    ],
    [
      "payment.succeeded with a fractional amount",
      {
        type: "payment.succeeded",
        data: { payment_id: "pay_1", total_amount: 100.5, currency: "INR" },
      },
    ],
    ["payment.failed with a non-object metadata", { type: "payment.failed", data: { metadata: 7 } }],
    [
      "refund.succeeded without an amount",
      { type: "refund.succeeded", data: { payment_id: "pay_1", currency: "INR" } },
    ],
    [
      "refund.succeeded in another currency",
      { type: "refund.succeeded", data: { payment_id: "pay_1", amount: 10, currency: "EUR" } },
    ],
    ["dispute.opened without a payment_id", { type: "dispute.opened", data: { dispute_id: "d1" } }],
  ])("rejects a malformed %s", (_label, payload) => {
    const result = normalizePaymentPayload("evt_x", payload as Record<string, unknown>)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("provider_error")
      expect(result.error.message).toContain("malformed")
    }
  })
})
