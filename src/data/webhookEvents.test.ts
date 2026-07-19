import { describe, expect, it } from "vitest"

import { getWebhookEvent, recordWebhookEvent } from "@/src/data/webhookEvents"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ webhook_events: { rows, unique: ["provider", "event_id"] } })
}

describe("recordWebhookEvent", () => {
  it("records a new event with a wh_ id", async () => {
    const result = await recordWebhookEvent(db(), {
      provider: "dodo",
      eventId: "evt_123",
      payload: { type: "payment.succeeded" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("wh", result.value.id)).toBe(true)
      expect(result.value.provider).toBe("dodo")
      expect(result.value.event_id).toBe("evt_123")
    }
  })

  it("surfaces a duplicate (provider,event_id) as a conflict", async () => {
    const fake = db()
    const input = { provider: "dodo", eventId: "evt_123", payload: {} }
    const first = await recordWebhookEvent(fake, input)
    expect(first.ok).toBe(true)
    const second = await recordWebhookEvent(fake, input)
    expect(!second.ok && second.error.code).toBe("conflict")
  })
})

describe("getWebhookEvent", () => {
  it("finds an event by provider and event id", async () => {
    const fake = db([
      { id: "wh_1", provider: "dodo", event_id: "evt_a", payload: {}, received_at: "1", created_at: "1" },
    ])
    const found = await getWebhookEvent(fake, "dodo", "evt_a")
    expect(found.ok && found.value?.id).toBe("wh_1")
  })

  it("returns null when absent", async () => {
    const result = await getWebhookEvent(db(), "dodo", "nope")
    expect(result.ok && result.value).toBeNull()
  })
})
