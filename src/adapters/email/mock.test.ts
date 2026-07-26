import { describe, expect, it } from "vitest"

import { notifierContract } from "@/src/adapters/email/contract.spec-factory"
import { MockNotifier } from "@/src/adapters/email/mock"

notifierContract(() => {
  const notifier = new MockNotifier()
  return {
    notifier,
    delivered: () => Promise.resolve(notifier.sent()),
  }
})

describe("MockNotifier", () => {
  it("records the rendered mail, its recipient and its order", async () => {
    const notifier = new MockNotifier()
    const sent = await notifier.send({
      to: "buyer@example.com",
      template: "review_hold",
      data: { orderId: "ord_1", orderUrl: "https://printforge.test/orders/ord_1" },
      orderId: "ord_1",
    })

    expect(sent.ok).toBe(true)
    const [mail] = notifier.sent()
    expect(mail?.to).toBe("buyer@example.com")
    expect(mail?.template).toBe("review_hold")
    expect(mail?.orderId).toBe("ord_1")
    expect(mail?.text).toContain("We’ve paused your order")
  })

  it("records no order when the mail is not about one", async () => {
    const notifier = new MockNotifier()
    await notifier.send({ to: "ops@example.com", template: "ops_late_payment", data: {} })
    expect(notifier.sent()[0]?.orderId).toBeNull()
  })

  it("issues a distinct provider-shaped reference per send", async () => {
    const notifier = new MockNotifier()
    const first = await notifier.send({ to: "a@example.com", template: "ops_dispute_opened", data: {} })
    const second = await notifier.send({ to: "b@example.com", template: "ops_dispute_opened", data: {} })

    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.value.messageRef).toMatch(/^mock_/)
      expect(first.value.messageRef).not.toBe(second.value.messageRef)
    }
  })

  it("empties the outbox on clear", async () => {
    const notifier = new MockNotifier()
    await notifier.send({ to: "ops@example.com", template: "ops_order_review", data: {} })
    notifier.clear()
    expect(notifier.sent()).toHaveLength(0)
  })
})
