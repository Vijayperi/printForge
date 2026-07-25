import { describe, expect, it } from "vitest"

import {
  applyPaymentOutcome,
  getOrder,
  getOrderByPaymentRef,
  getOrderByQuoteId,
  getOrderOwned,
  insertOrder,
  listOrdersByUser,
  updateOrderPaymentStatus,
  updateOrderProviderSession,
  updateOrderStatus,
} from "@/src/data/orders"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ orders: { rows, unique: ["id"] } })
}

const base = {
  userId: "u1",
  quoteId: "qt_1",
  contactJson: { email: "a@b.com" },
  shippingAddressJson: { pincode: "560001" },
  frozenDvId: "dv_1",
  frozenConfigJson: { material: "PLA" },
}

describe("insertOrder", () => {
  it("inserts with a generated ord_ id and defaults", async () => {
    const fake = db()
    const result = await insertOrder(fake, base)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("ord", result.value.id)).toBe(true)
      expect(result.value.user_id).toBe("u1")
      expect(result.value.quote_id).toBe("qt_1")
      expect(result.value.status).toBe("pending_payment")
      expect(result.value.payment_status).toBe("unpaid")
      expect(result.value.frozen_dv_id).toBe("dv_1")
      expect(result.value.contact_json).toEqual({ email: "a@b.com" })
    }
  })

  it("honors explicit status and paymentStatus", async () => {
    const fake = db()
    const result = await insertOrder(fake, { ...base, status: "paid", paymentStatus: "paid" })
    expect(result.ok && result.value.status).toBe("paid")
    expect(result.ok && result.value.payment_status).toBe("paid")
  })
})

describe("getOrder / getOrderOwned / getOrderByQuoteId", () => {
  const rows = [
    { id: "ord_1", user_id: "u1", quote_id: "qt_1", created_at: "1" },
    { id: "ord_2", user_id: "u2", quote_id: "qt_2", created_at: "2" },
  ]

  it("getOrder returns by id", async () => {
    const result = await getOrder(db(rows), "ord_1")
    expect(result.ok && result.value?.id).toBe("ord_1")
  })

  it("getOrder returns null when absent", async () => {
    const result = await getOrder(db(rows), "ord_x")
    expect(result.ok && result.value).toBeNull()
  })

  it("getOrderOwned returns the order for its owner", async () => {
    const result = await getOrderOwned(db(rows), "u1", "ord_1")
    expect(result.ok && result.value?.id).toBe("ord_1")
  })

  it("getOrderOwned returns null for a non-owner", async () => {
    const result = await getOrderOwned(db(rows), "u1", "ord_2")
    expect(result.ok && result.value).toBeNull()
  })

  it("getOrderByQuoteId returns the order tied to a quote", async () => {
    const result = await getOrderByQuoteId(db(rows), "qt_2")
    expect(result.ok && result.value?.id).toBe("ord_2")
  })

  it("getOrderByQuoteId returns null when no order references the quote", async () => {
    const result = await getOrderByQuoteId(db(rows), "qt_none")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("listOrdersByUser", () => {
  it("returns the user's orders, newest first", async () => {
    const fake = db([
      { id: "ord_1", user_id: "u1", quote_id: "qt_1", created_at: "2026-01-01" },
      { id: "ord_2", user_id: "u1", quote_id: "qt_2", created_at: "2026-01-05" },
      { id: "ord_3", user_id: "u2", quote_id: "qt_3", created_at: "2026-01-09" },
    ])
    const result = await listOrdersByUser(fake, "u1")
    expect(result.ok && result.value.map((o) => o.id)).toEqual(["ord_2", "ord_1"])
  })
})

describe("updateOrderStatus / updateOrderPaymentStatus", () => {
  it("updates the fulfillment status", async () => {
    const fake = db([{ id: "ord_1", user_id: "u1", status: "pending_payment", created_at: "1" }])
    const result = await updateOrderStatus(fake, "ord_1", "paid")
    expect(result.ok && result.value.status).toBe("paid")
  })

  it("updates the payment status", async () => {
    const fake = db([{ id: "ord_1", user_id: "u1", payment_status: "unpaid", created_at: "1" }])
    const result = await updateOrderPaymentStatus(fake, "ord_1", "paid")
    expect(result.ok && result.value.payment_status).toBe("paid")
  })

  it("fails when the order is absent", async () => {
    const result = await updateOrderStatus(db(), "ord_missing", "paid")
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})

describe("updateOrderProviderSession", () => {
  it("records the provider checkout session id", async () => {
    const fake = db([{ id: "ord_1", user_id: "u1", provider_session_id: null, created_at: "1" }])
    const result = await updateOrderProviderSession(fake, "ord_1", "cks_abc")
    expect(result.ok && result.value.provider_session_id).toBe("cks_abc")
  })

  it("fails when the order is absent", async () => {
    const result = await updateOrderProviderSession(db(), "ord_missing", "cks_abc")
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})

describe("getOrderByPaymentRef", () => {
  const rows = [
    { id: "ord_1", user_id: "u1", payment_ref: "pay_1", created_at: "1" },
    { id: "ord_2", user_id: "u2", payment_ref: null, created_at: "2" },
  ]

  it("finds the order a payment belongs to", async () => {
    const result = await getOrderByPaymentRef(db(rows), "pay_1")
    expect(result.ok && result.value?.id).toBe("ord_1")
  })

  it("returns null for a payment reference we have never recorded", async () => {
    const result = await getOrderByPaymentRef(db(rows), "pay_unknown")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("applyPaymentOutcome", () => {
  function orderRow() {
    return db([
      {
        id: "ord_1",
        user_id: "u1",
        status: "pending_payment",
        payment_status: "unpaid",
        payment_ref: null,
        held_from_status: null,
        created_at: "1",
      },
    ])
  }

  it("writes status, payment status and payment ref in one update", async () => {
    const fake = orderRow()
    const result = await applyPaymentOutcome(fake, "ord_1", {
      status: "production_queued",
      paymentStatus: "paid",
      paymentRef: "pay_1",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe("production_queued")
      expect(result.value.payment_status).toBe("paid")
      expect(result.value.payment_ref).toBe("pay_1")
      expect(result.value.held_from_status).toBeNull()
    }
  })

  it("records where a hold came from", async () => {
    const fake = orderRow()
    const result = await applyPaymentOutcome(fake, "ord_1", {
      status: "on_hold",
      heldFromStatus: "paid",
    })
    expect(result.ok && result.value.held_from_status).toBe("paid")
    expect(result.ok && result.value.payment_status).toBe("unpaid")
  })

  it("clears held_from_status when passed null", async () => {
    const fake = db([
      { id: "ord_1", user_id: "u1", status: "on_hold", held_from_status: "paid", created_at: "1" },
    ])
    const result = await applyPaymentOutcome(fake, "ord_1", { heldFromStatus: null })
    expect(result.ok && result.value.held_from_status).toBeNull()
  })

  it("leaves omitted fields untouched", async () => {
    const fake = orderRow()
    const result = await applyPaymentOutcome(fake, "ord_1", { paymentStatus: "refunded" })
    expect(result.ok && result.value.status).toBe("pending_payment")
    expect(result.ok && result.value.payment_ref).toBeNull()
  })

  it("fails when the order is absent", async () => {
    const result = await applyPaymentOutcome(db(), "ord_missing", { status: "paid" })
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})
