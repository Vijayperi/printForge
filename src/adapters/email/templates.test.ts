import { describe, expect, it } from "vitest"

import { CUSTOMER_TEMPLATE_KEYS, OPS_TEMPLATE_KEYS, type TemplateKey } from "@/src/adapters/email"
import {
  escapeHtml,
  factValue,
  opsFacts,
  renderTemplate,
  type RenderedEmail,
} from "@/src/adapters/email/templates"

const ORDER_ID = "ord_01K0SNAPSHOT00000000000001"
const ORDER_URL = `https://printforge.test/orders/${ORDER_ID}`

/** One valid payload per template, used for the snapshots and the sweeps. */
const PAYLOADS = {
  order_receipt: { orderId: ORDER_ID, orderUrl: ORDER_URL, amountMinor: 249900 },
  review_hold: { orderId: ORDER_ID, orderUrl: ORDER_URL },
  production_milestone: { orderId: ORDER_ID, orderUrl: ORDER_URL, milestone: "started" },
  shipment: {
    orderId: ORDER_ID,
    orderUrl: ORDER_URL,
    carrier: "delhivery",
    trackingNumber: "DL123456789IN",
  },
  cancellation_refund: { orderId: ORDER_ID, orderUrl: ORDER_URL, refundAmountMinor: 249900 },
  ops_manual_review: { validationReportId: "vr_1", designVersionId: "dv_1" },
  ops_print_failure: {
    orderId: ORDER_ID,
    printJobId: "pj_1",
    printerId: "prn_1",
    attempt: 2,
    failureReason: "thermal runaway",
  },
  ops_order_review: { orderId: ORDER_ID, verdict: "manual_review" },
  ops_payment_unmatched: { paymentRef: "pay_1", amountMinor: 249900 },
  ops_late_payment: { orderId: ORDER_ID, paymentRef: "pay_1", amountMinor: 249900 },
  ops_refund_unmatched: { paymentRef: "pay_1", amountMinor: 100000 },
  ops_dispute_opened: { orderId: ORDER_ID, paymentRef: "pay_1", heldFrom: "production_queued" },
} satisfies Record<TemplateKey, Record<string, unknown>>

function render(template: TemplateKey, data: Record<string, unknown>): RenderedEmail {
  const result = renderTemplate(template, data)
  if (!result.ok) throw new Error(`expected ${template} to render: ${result.error.message}`)
  return result.value
}

describe("escapeHtml", () => {
  it("neutralises every character that could close a tag or attribute", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    )
  })

  it("escapes ampersands before the entities it introduces", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;")
  })

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Blue Dart")).toBe("Blue Dart")
  })
})

describe("factValue", () => {
  it.each([
    ["a string", "thermal runaway", "thermal runaway"],
    ["a number", 3, "3"],
    ["a boolean", false, "false"],
    ["null", null, "—"],
    ["undefined", undefined, "—"],
    ["an empty string", "", "—"],
  ] as const)("renders %s", (_label, input, expected) => {
    expect(factValue(input)).toBe(expected)
  })

  it("keeps a structured value readable as json", () => {
    expect(factValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe("opsFacts", () => {
  it("sorts by key so the same alert always renders identically", () => {
    expect(opsFacts({ zebra: 1, alpha: 2 })).toEqual([
      ["alpha", "2"],
      ["zebra", "1"],
    ])
  })

  it("drops the routing fields that are not facts", () => {
    expect(opsFacts({ template: "ops_late_payment", opsUrl: "https://x", paymentRef: "p1" })).toEqual(
      [["paymentRef", "p1"]]
    )
  })
})

describe("renderTemplate", () => {
  it.each(CUSTOMER_TEMPLATE_KEYS)("renders %s to a stable customer mail", (template) => {
    expect(render(template, PAYLOADS[template])).toMatchSnapshot()
  })

  it.each(OPS_TEMPLATE_KEYS)("renders %s to a stable ops alert", (template) => {
    expect(render(template, PAYLOADS[template])).toMatchSnapshot()
  })

  it("names the order in every customer subject", () => {
    for (const template of CUSTOMER_TEMPLATE_KEYS) {
      expect(render(template, PAYLOADS[template]).subject).toContain(ORDER_ID)
    }
  })

  it("renders the completed milestone differently from the started one", () => {
    const started = render("production_milestone", PAYLOADS.production_milestone)
    const completed = render("production_milestone", {
      ...PAYLOADS.production_milestone,
      milestone: "completed",
    })
    expect(completed.subject).not.toBe(started.subject)
    expect(completed.text).toContain("Off the printer")
  })

  it("formats money as rupees, never as paisa", () => {
    expect(render("order_receipt", PAYLOADS.order_receipt).text).toContain("₹2,499.00")
  })

  it("omits the refund line when no refund amount is known", () => {
    const mail = render("cancellation_refund", { orderId: ORDER_ID, orderUrl: ORDER_URL })
    expect(mail.text).not.toContain("Refund:")
  })

  it("shows the carrier's name, not its stored id", () => {
    const mail = render("shipment", PAYLOADS.shipment)
    expect(mail.text).toContain("Delhivery")
    expect(mail.text).not.toContain("delhivery")
  })

  it("falls back to the raw carrier id when it is not one we know", () => {
    const mail = render("shipment", { ...PAYLOADS.shipment, carrier: "porter" })
    expect(mail.text).toContain("porter")
  })

  it("links an ops alert into the dashboard when the flow supplied a url", () => {
    const mail = render("ops_print_failure", {
      ...PAYLOADS.ops_print_failure,
      opsUrl: "https://printforge.test/ops/orders/ord_1",
    })
    expect(mail.html).toContain('href="https://printforge.test/ops/orders/ord_1"')
    expect(mail.text).toContain("Open in ops")
  })

  it("renders an ops alert with no facts at all", () => {
    const mail = render("ops_late_payment", {})
    expect(mail.subject).toBe("Payment landed on a cancelled order")
    expect(mail.html).toContain("<table")
  })

  it.each([
    ["a missing field", "order_receipt", { orderId: ORDER_ID, orderUrl: ORDER_URL }],
    ["a url that is not one", "review_hold", { orderId: ORDER_ID, orderUrl: "not-a-url" }],
    ["an unknown milestone", "production_milestone", { orderId: ORDER_ID, orderUrl: ORDER_URL, milestone: "paused" }],
    ["a fractional amount", "order_receipt", { orderId: ORDER_ID, orderUrl: ORDER_URL, amountMinor: 1.5 }],
    ["an empty tracking number", "shipment", { orderId: ORDER_ID, orderUrl: ORDER_URL, carrier: "dtdc", trackingNumber: "" }],
  ] as const)("refuses to send a customer mail with %s", (_label, template, data) => {
    const result = renderTemplate(template, data)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("validation")
      expect(result.error.message).toContain(template)
    }
  })

  it("escapes operator-written text that reaches an ops alert", () => {
    const mail = render("ops_print_failure", {
      ...PAYLOADS.ops_print_failure,
      failureReason: '<img src=x onerror="alert(1)">',
    })
    expect(mail.html).not.toContain("<img")
    expect(mail.text).toContain('<img src=x onerror="alert(1)">')
  })
})
