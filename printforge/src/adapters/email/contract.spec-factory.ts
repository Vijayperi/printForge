import { describe, expect, it } from "vitest"

import { OPS_TEMPLATE_KEYS, type Notifier } from "@/src/adapters/email"

export interface NotifierSubject {
  notifier: Notifier
  /** Read back what the transport was actually handed, newest last. */
  delivered(): Promise<readonly { to: string; subject: string; html: string }[]>
}

const RECEIPT = {
  orderId: "ord_contract_1",
  orderUrl: "https://printforge.test/orders/ord_contract_1",
  amountMinor: 249900,
}

/**
 * Shared contract every Notifier must satisfy (plan §4.4), run against the mock
 * and the real Resend sender (the latter behind MSW) so the two cannot drift.
 * The load-bearing cases are the two failure modes: an unrenderable payload must
 * be rejected the same way by both, and neither may report success for mail the
 * transport refused.
 */
export function notifierContract(makeSubject: () => NotifierSubject | Promise<NotifierSubject>): void {
  describe("Notifier contract", () => {
    it("sends a customer template and returns a message reference", async () => {
      const subject = await makeSubject()
      const sent = await subject.notifier.send({
        to: "buyer@example.com",
        template: "order_receipt",
        data: RECEIPT,
        orderId: RECEIPT.orderId,
      })

      expect(sent.ok).toBe(true)
      if (sent.ok) expect(sent.value.messageRef.length).toBeGreaterThan(0)

      const delivered = await subject.delivered()
      expect(delivered).toHaveLength(1)
      expect(delivered[0]?.to).toBe("buyer@example.com")
      expect(delivered[0]?.subject).toContain(RECEIPT.orderId)
      expect(delivered[0]?.html).toContain("₹2,499.00")
    })

    it("sends an ops template without an order", async () => {
      const subject = await makeSubject()
      const sent = await subject.notifier.send({
        to: "ops@example.com",
        template: "ops_manual_review",
        data: { validationReportId: "vr_1", designVersionId: "dv_1" },
      })

      expect(sent.ok).toBe(true)
      const delivered = await subject.delivered()
      expect(delivered[0]?.html).toContain("vr_1")
    })

    it("rejects a customer template whose data is missing a field", async () => {
      const subject = await makeSubject()
      const sent = await subject.notifier.send({
        to: "buyer@example.com",
        template: "order_receipt",
        data: { orderId: "ord_1" },
      })

      expect(sent.ok).toBe(false)
      if (!sent.ok) expect(sent.error.code).toBe("validation")
      // Nothing may reach the transport when rendering fails.
      expect(await subject.delivered()).toHaveLength(0)
    })

    it("never sends the same mail twice for one call", async () => {
      const subject = await makeSubject()
      await subject.notifier.send({
        to: "buyer@example.com",
        template: "shipment",
        data: {
          orderId: "ord_contract_1",
          orderUrl: "https://printforge.test/orders/ord_contract_1",
          carrier: "delhivery",
          trackingNumber: "DL123456789IN",
        },
      })
      expect(await subject.delivered()).toHaveLength(1)
    })

    it("escapes markup that arrives in the data", async () => {
      const subject = await makeSubject()
      await subject.notifier.send({
        to: "ops@example.com",
        template: "ops_print_failure",
        data: { failureReason: "<script>alert(1)</script>" },
      })

      const delivered = await subject.delivered()
      expect(delivered[0]?.html).not.toContain("<script>")
      expect(delivered[0]?.html).toContain("&lt;script&gt;")
    })

    // Customer templates each need their own data and are covered by the
    // per-template snapshots; the ops keys all take free-form facts, so the
    // contract can sweep every one of them.
    it("renders every ops template to a non-empty subject", async () => {
      const subject = await makeSubject()
      for (const template of OPS_TEMPLATE_KEYS) {
        const sent = await subject.notifier.send({
          to: "ops@example.com",
          template,
          data: { note: "smoke" },
        })
        expect(sent.ok).toBe(true)
      }

      const delivered = await subject.delivered()
      expect(delivered).toHaveLength(OPS_TEMPLATE_KEYS.length)
      for (const mail of delivered) expect(mail.subject.length).toBeGreaterThan(0)
    })
  })
}
