import { describe, expect, it } from "vitest"

import {
  readSignatureHeaders,
  signStandardWebhook,
  verifyStandardWebhook,
} from "@/src/adapters/payments/standardWebhook"
import { FixedClock } from "@/src/lib/clock"

const SECRET = "cHJpbnRmb3JnZS10ZXN0LXNlY3JldC12YWx1ZQ=="
const BODY = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_1" } })

// `standardwebhooks` runs its own ±5 min check against the system clock, so
// payloads are always signed at real "now"; only the injected Clock moves, which
// is what our own tolerance rule (WEBHOOK_TOLERANCE_MS) is measured against.
// Floored to a whole second so the signed header and AT are the same instant,
// which makes the ±5 min boundary cases exact rather than off by a few ms.
const AT = new Date(Math.floor(Date.now() / 1000) * 1000)

function sign(body = BODY, at = AT, eventId = "evt_1", secret = SECRET) {
  return signStandardWebhook(secret, eventId, at, body)
}

/** A clock offset from the signing instant, in ms. */
const clockAt = (offsetMs: number) => new FixedClock(new Date(AT.getTime() + offsetMs))

describe("readSignatureHeaders", () => {
  it("reads the three standard-webhooks headers", () => {
    const result = readSignatureHeaders({
      "webhook-id": "evt_1",
      "webhook-timestamp": "1753437600",
      "webhook-signature": "v1,abc",
    })
    expect(result).toEqual({
      ok: true,
      value: { id: "evt_1", timestamp: "1753437600", signature: "v1,abc" },
    })
  })

  it("is case-insensitive", () => {
    const result = readSignatureHeaders({
      "Webhook-Id": "evt_1",
      "WEBHOOK-TIMESTAMP": "1753437600",
      "webhook-Signature": "v1,abc",
    })
    expect(result.ok && result.value.id).toBe("evt_1")
  })

  it.each([
    ["id", { "webhook-timestamp": "1", "webhook-signature": "v1,abc" }],
    ["timestamp", { "webhook-id": "evt_1", "webhook-signature": "v1,abc" }],
    ["signature", { "webhook-id": "evt_1", "webhook-timestamp": "1" }],
    ["everything", {}],
  ])("rejects a request missing the %s header", (_label, headers) => {
    const result = readSignatureHeaders(headers)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("unauthorized")
  })
})

describe("verifyStandardWebhook", () => {
  it("verifies a correctly signed body and returns the parsed payload", () => {
    const result = verifyStandardWebhook(SECRET, BODY, sign(), clockAt(0))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.eventId).toBe("evt_1")
      expect(result.value.payload["type"]).toBe("payment.succeeded")
    }
  })

  it("rejects a body signed with a different secret", () => {
    const headers = sign(BODY, AT, "evt_1", "b3RoZXItc2VjcmV0LXZhbHVlLWhlcmU=")
    const result = verifyStandardWebhook(SECRET, BODY, headers, clockAt(0))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("unauthorized")
  })

  it("rejects a tampered body", () => {
    const result = verifyStandardWebhook(
      SECRET,
      BODY.replace("pay_1", "pay_2"),
      sign(),
      clockAt(0)
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("unauthorized")
  })

  it("rejects missing headers before touching the signature", () => {
    const result = verifyStandardWebhook(SECRET, BODY, {}, clockAt(0))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("missing")
  })

  it.each([
    ["6 minutes old", 6 * 60 * 1000],
    ["6 minutes in the future", -6 * 60 * 1000],
  ])("rejects a timestamp %s", (_label, offsetMs) => {
    const result = verifyStandardWebhook(SECRET, BODY, sign(), clockAt(offsetMs))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("timestamp")
  })

  it.each([
    ["4 minutes old", 4 * 60 * 1000],
    ["exactly 5 minutes old", 5 * 60 * 1000],
    ["4 minutes in the future", -4 * 60 * 1000],
  ])("accepts a timestamp %s", (_label, offsetMs) => {
    expect(verifyStandardWebhook(SECRET, BODY, sign(), clockAt(offsetMs)).ok).toBe(true)
  })

  it("rejects a non-numeric timestamp header", () => {
    const result = verifyStandardWebhook(
      SECRET,
      BODY,
      { ...sign(), "webhook-timestamp": "yesterday" },
      clockAt(0)
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("timestamp")
  })

  it("rejects a correctly signed body that is not json", () => {
    const body = "not json at all"
    const result = verifyStandardWebhook(SECRET, body, sign(body), clockAt(0))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("validation")
  })

  it.each([
    ["an array", "[1,2,3]"],
    ["a bare number", "42"],
    ["null", "null"],
  ])("rejects a signed body that is %s rather than an object", (_label, body) => {
    const result = verifyStandardWebhook(SECRET, body, sign(body), clockAt(0))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("json object")
  })
})

describe("signStandardWebhook", () => {
  it("emits the three headers with a unix-seconds timestamp", () => {
    const headers = sign()
    expect(headers["webhook-id"]).toBe("evt_1")
    expect(headers["webhook-timestamp"]).toBe(String(Math.floor(AT.getTime() / 1000)))
    expect(headers["webhook-signature"]).toMatch(/^v1,/)
  })

  it("produces signatures that round-trip through verification", () => {
    const body = JSON.stringify({ type: "dispute.opened", data: {} })
    const result = verifyStandardWebhook(SECRET, body, sign(body), clockAt(0))
    expect(result.ok).toBe(true)
  })
})
