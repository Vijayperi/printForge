import { describe, expect, it } from "vitest"

import type { Notifier } from "@/src/adapters/email"
import { MockNotifier } from "@/src/adapters/email/mock"
import {
  customerOrderUrl,
  handleNotificationSend,
  opsOrderUrl,
  type NotificationDeps,
} from "@/src/jobs/handlers/notification"
import { appError } from "@/src/lib/errors"
import { err } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const APP_URL = "https://printforge.test"
const OPS_EMAIL = "ops@printforge.test"

function seed(over: { order?: Record<string, unknown>; quotes?: Record<string, unknown>[] } = {}) {
  return createFakeDb({
    orders: {
      rows: [
        {
          id: "ord_1",
          quote_id: "qt_1",
          user_id: "u_1",
          status: "production_queued",
          payment_status: "paid",
          contact_json: { name: "Asha", email: "asha@example.com", phone: "+919876543210" },
          created_at: "1",
          ...over.order,
        },
      ],
      unique: ["id"],
    },
    quotes: {
      rows: over.quotes ?? [{ id: "qt_1", amount_minor: 249900, status: "consumed", created_at: "1" }],
      unique: ["id"],
    },
    notification_log: { rows: [], unique: ["id"] },
  })
}

function makeDeps(db: FakeDb, notifier: Notifier = new MockNotifier()): NotificationDeps {
  return { db, notifier, appUrl: APP_URL, opsEmail: OPS_EMAIL }
}

function logRows(db: FakeDb): Record<string, unknown>[] {
  return db.rows("notification_log")
}

/** A notifier whose transport always refuses, to drive the failure paths. */
const refusingNotifier: Notifier = {
  send: () => Promise.resolve(err(appError("provider_error", "resend send failed with status 500"))),
}

describe("customerOrderUrl", () => {
  it("points at the customer's order page", () => {
    expect(customerOrderUrl(APP_URL, "ord_1")).toBe("https://printforge.test/orders/ord_1")
  })
})

describe("opsOrderUrl", () => {
  it("points at the operator's order page", () => {
    expect(opsOrderUrl(APP_URL, "ord_1")).toBe("https://printforge.test/ops/orders/ord_1")
  })
})

describe("handleNotificationSend", () => {
  it("mails the customer at the address frozen on the order", async () => {
    const db = seed()
    const notifier = new MockNotifier()
    const result = await handleNotificationSend(makeDeps(db, notifier), {
      template: "order_receipt",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(true)
    expect(notifier.sent()[0]?.to).toBe("asha@example.com")
  })

  it("bills the receipt from the quote, not from the payload", async () => {
    const db = seed()
    const notifier = new MockNotifier()
    await handleNotificationSend(makeDeps(db, notifier), {
      template: "order_receipt",
      orderId: "ord_1",
      amountMinor: 1,
    })

    expect(notifier.sent()[0]?.text).toContain("₹2,499.00")
  })

  it("logs a sent notification against its order", async () => {
    const db = seed()
    await handleNotificationSend(makeDeps(db), { template: "order_receipt", orderId: "ord_1" })

    const [row] = logRows(db)
    expect(row?.status).toBe("sent")
    expect(row?.order_id).toBe("ord_1")
    expect(row?.template).toBe("order_receipt")
    expect(row?.to_email).toBe("asha@example.com")
    expect(row?.message_ref).toMatch(/^mock_/)
  })

  it("passes the flow's own fields through to the template", async () => {
    const db = seed()
    const notifier = new MockNotifier()
    const result = await handleNotificationSend(makeDeps(db, notifier), {
      template: "shipment",
      orderId: "ord_1",
      carrier: "blue_dart",
      trackingNumber: "BD1234",
    })

    expect(result.ok).toBe(true)
    expect(notifier.sent()[0]?.text).toContain("Blue Dart")
    expect(notifier.sent()[0]?.text).toContain("BD1234")
  })

  it("sends an ops alert to the ops inbox and links it into the dashboard", async () => {
    const db = seed()
    const notifier = new MockNotifier()
    await handleNotificationSend(makeDeps(db, notifier), {
      template: "ops_print_failure",
      orderId: "ord_1",
      printJobId: "pj_1",
      failureReason: "thermal runaway",
    })

    const [mail] = notifier.sent()
    expect(mail?.to).toBe(OPS_EMAIL)
    expect(mail?.text).toContain("thermal runaway")
    expect(mail?.text).toContain("https://printforge.test/ops/orders/ord_1")
  })

  it("sends an ops alert that belongs to no order at all", async () => {
    const db = seed()
    const notifier = new MockNotifier()
    const result = await handleNotificationSend(makeDeps(db, notifier), {
      template: "ops_payment_unmatched",
      paymentRef: "pay_1",
    })

    expect(result.ok).toBe(true)
    expect(notifier.sent()[0]?.text).toContain("pay_1")
    expect(logRows(db)[0]?.order_id).toBeNull()
  })

  it("refuses a payload with no template", async () => {
    const result = await handleNotificationSend(makeDeps(seed()), { orderId: "ord_1" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("validation")
  })

  it("refuses a template we do not render", async () => {
    const result = await handleNotificationSend(makeDeps(seed()), { template: "order_delivered" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("order_delivered")
  })

  it("refuses a customer template with no order to address", async () => {
    const result = await handleNotificationSend(makeDeps(seed()), { template: "review_hold" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("validation")
  })

  it("refuses when the order has gone missing", async () => {
    const result = await handleNotificationSend(makeDeps(seed()), {
      template: "review_hold",
      orderId: "ord_missing",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("not_found")
  })

  it("refuses when the order carries no contact email", async () => {
    const db = seed({ order: { contact_json: { name: "Asha" } } })
    const result = await handleNotificationSend(makeDeps(db), {
      template: "review_hold",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("contact email")
  })

  it("refuses a receipt for an order whose quote has gone missing", async () => {
    const db = seed({ quotes: [] })
    const result = await handleNotificationSend(makeDeps(db), {
      template: "order_receipt",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("not_found")
  })

  it("records a refused send and reports the failure so the job retries", async () => {
    const db = seed()
    const result = await handleNotificationSend(makeDeps(db, refusingNotifier), {
      template: "order_receipt",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("provider_error")

    const [row] = logRows(db)
    expect(row?.status).toBe("failed")
    expect(row?.error).toContain("status 500")
    expect(row?.message_ref).toBeNull()
  })

  it("reports a failure reading the order", async () => {
    const db = seed()
    db.failNext({ message: "orders unavailable", code: "08000" })
    const result = await handleNotificationSend(makeDeps(db), {
      template: "review_hold",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(false)
  })

  it("reports a failure reading the quote", async () => {
    const db = seed()
    // 1 = read the order, 2 = read the quote it bills from.
    db.failCall(2, { message: "quotes unavailable", code: "08000" })
    const result = await handleNotificationSend(makeDeps(db), {
      template: "order_receipt",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(false)
  })

  it("reports a failure writing the log rather than swallowing it", async () => {
    const db = seed()
    // 1 = read the order, 2 = write the notification log row.
    db.failCall(2, { message: "log unavailable", code: "08000" })
    const result = await handleNotificationSend(makeDeps(db), {
      template: "review_hold",
      orderId: "ord_1",
    })

    expect(result.ok).toBe(false)
  })
})
