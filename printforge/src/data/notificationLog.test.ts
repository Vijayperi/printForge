import { describe, expect, it } from "vitest"

import { insertNotification, listNotificationsByOrder } from "@/src/data/notificationLog"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ notification_log: { rows, unique: ["id"] } })
}

describe("insertNotification", () => {
  it("inserts with a generated ntf_ id and nulls optional fields", async () => {
    const fake = db()
    const result = await insertNotification(fake, {
      toEmail: "a@b.com",
      template: "order_receipt",
      status: "sent",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("ntf", result.value.id)).toBe(true)
      expect(result.value.order_id).toBeNull()
      expect(result.value.to_email).toBe("a@b.com")
      expect(result.value.template).toBe("order_receipt")
      expect(result.value.status).toBe("sent")
      expect(result.value.message_ref).toBeNull()
      expect(result.value.error).toBeNull()
    }
  })

  it("stores orderId, messageRef, and error when provided", async () => {
    const fake = db()
    const result = await insertNotification(fake, {
      orderId: "ord_1",
      toEmail: "a@b.com",
      template: "shipment",
      status: "failed",
      messageRef: "msg_1",
      error: "bounced",
    })
    expect(result.ok && result.value.order_id).toBe("ord_1")
    expect(result.ok && result.value.message_ref).toBe("msg_1")
    expect(result.ok && result.value.error).toBe("bounced")
  })
})

describe("listNotificationsByOrder", () => {
  it("returns notifications for an order, newest first", async () => {
    const fake = db([
      { id: "ntf_1", order_id: "ord_1", to_email: "a@b.com", template: "t", status: "sent", created_at: "2026-01-01" },
      { id: "ntf_2", order_id: "ord_1", to_email: "a@b.com", template: "t", status: "sent", created_at: "2026-01-05" },
      { id: "ntf_3", order_id: "ord_2", to_email: "a@b.com", template: "t", status: "sent", created_at: "2026-01-09" },
    ])
    const result = await listNotificationsByOrder(fake, "ord_1")
    expect(result.ok && result.value.map((n) => n.id)).toEqual(["ntf_2", "ntf_1"])
  })
})
