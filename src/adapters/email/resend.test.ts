import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { notifierContract } from "@/src/adapters/email/contract.spec-factory"
import { ResendNotifier } from "@/src/adapters/email/resend"
import { server } from "@/tests/msw/server"

const SEND_URL = "https://api.resend.com/emails"

interface Captured {
  to: string
  subject: string
  html: string
  text: string
  from: string
  authorization: string
}

/** Stand in for Resend, recording exactly what the notifier put on the wire. */
function acceptingResend(captured: Captured[]) {
  return http.post(SEND_URL, async ({ request }) => {
    const body = (await request.json()) as {
      to: string[]
      subject: string
      html: string
      text: string
      from: string
    }
    captured.push({
      to: body.to[0] ?? "",
      subject: body.subject,
      html: body.html,
      text: body.text,
      from: body.from,
      authorization: request.headers.get("authorization") ?? "",
    })
    return HttpResponse.json({ id: `re_${captured.length}` })
  })
}

function makeNotifier(): ResendNotifier {
  return new ResendNotifier({ apiKey: "re_test_key", from: "PrintForge <orders@printforge.test>" })
}

notifierContract(() => {
  const captured: Captured[] = []
  server.use(acceptingResend(captured))
  return { notifier: makeNotifier(), delivered: () => Promise.resolve(captured) }
})

describe("ResendNotifier", () => {
  let captured: Captured[]

  beforeEach(() => {
    captured = []
    server.use(acceptingResend(captured))
  })

  it("returns the provider's id as the message reference", async () => {
    const sent = await makeNotifier().send({
      to: "buyer@example.com",
      template: "ops_manual_review",
      data: { validationReportId: "vr_1" },
    })
    expect(sent.ok && sent.value.messageRef).toBe("re_1")
  })

  it("sends the configured identity and the api key", async () => {
    await makeNotifier().send({ to: "buyer@example.com", template: "ops_order_review", data: {} })
    expect(captured[0]?.from).toBe("PrintForge <orders@printforge.test>")
    expect(captured[0]?.authorization).toBe("Bearer re_test_key")
  })

  it("sends both an html and a plain-text part", async () => {
    await makeNotifier().send({
      to: "buyer@example.com",
      template: "shipment",
      data: {
        orderId: "ord_1",
        orderUrl: "https://printforge.test/orders/ord_1",
        carrier: "blue_dart",
        trackingNumber: "BD1",
      },
    })
    expect(captured[0]?.html).toContain("<h1>")
    expect(captured[0]?.text).toContain("Blue Dart")
    expect(captured[0]?.text).not.toContain("<h1>")
  })

  it("reports a rejected send as a provider error", async () => {
    server.use(http.post(SEND_URL, () => new HttpResponse(null, { status: 422 })))
    const sent = await makeNotifier().send({ to: "bad", template: "ops_late_payment", data: {} })

    expect(sent.ok).toBe(false)
    if (!sent.ok) {
      expect(sent.error.code).toBe("provider_error")
      expect(sent.error.message).toContain("422")
    }
  })

  it("reports a transport failure as a provider error", async () => {
    server.use(http.post(SEND_URL, () => HttpResponse.error()))
    const sent = await makeNotifier().send({ to: "a@example.com", template: "ops_late_payment", data: {} })

    expect(sent.ok).toBe(false)
    if (!sent.ok) expect(sent.error.code).toBe("provider_error")
  })

  it("survives a transport that rejects with something that is not an Error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue("socket vanished")
    const sent = await makeNotifier().send({ to: "a@example.com", template: "ops_late_payment", data: {} })
    fetchSpy.mockRestore()

    expect(sent.ok).toBe(false)
    if (!sent.ok) expect(sent.error.message).toContain("unknown transport failure")
  })

  it("refuses to claim success when the provider returns no id", async () => {
    server.use(http.post(SEND_URL, () => HttpResponse.json({})))
    const sent = await makeNotifier().send({ to: "a@example.com", template: "ops_late_payment", data: {} })

    expect(sent.ok).toBe(false)
    if (!sent.ok) expect(sent.error.message).toContain("no id")
  })

  it("refuses to claim success when the provider returns a body it cannot parse", async () => {
    server.use(http.post(SEND_URL, () => new HttpResponse("not json", { status: 200 })))
    const sent = await makeNotifier().send({ to: "a@example.com", template: "ops_late_payment", data: {} })

    expect(sent.ok).toBe(false)
    if (!sent.ok) expect(sent.error.message).toContain("no id")
  })

  it("never calls the transport when the template cannot render", async () => {
    const sent = await makeNotifier().send({
      to: "a@example.com",
      template: "order_receipt",
      data: {},
    })

    expect(sent.ok).toBe(false)
    expect(captured).toHaveLength(0)
  })
})
