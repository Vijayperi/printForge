import { describe, expect, it } from "vitest"

import { insertAuditEvent, listAuditEventsByEntity } from "@/src/data/auditEvents"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ audit_events: { rows, unique: ["id"] } })
}

describe("insertAuditEvent", () => {
  it("inserts a system event with defaults and an evt_ id", async () => {
    const result = await insertAuditEvent(db(), {
      actorKind: "system",
      entityType: "order",
      entityId: "ord_1",
      action: "auto_approved",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("evt", result.value.id)).toBe(true)
      expect(result.value.actor_id).toBeNull()
      expect(result.value.actor_kind).toBe("system")
      expect(result.value.metadata).toEqual({})
    }
  })

  it("inserts a user event with actor and metadata", async () => {
    const result = await insertAuditEvent(db(), {
      actorId: "user_1",
      actorKind: "user",
      entityType: "order",
      entityId: "ord_1",
      action: "approved",
      metadata: { reason: "looks good" },
    })
    expect(result.ok && result.value.actor_id).toBe("user_1")
    expect(result.ok && result.value.metadata).toEqual({ reason: "looks good" })
  })
})

describe("listAuditEventsByEntity", () => {
  it("lists an entity's events newest first", async () => {
    const fake = db([
      { id: "evt_1", actor_kind: "system", entity_type: "order", entity_id: "ord_1", action: "a", created_at: "2026-01-01" },
      { id: "evt_2", actor_kind: "system", entity_type: "order", entity_id: "ord_1", action: "b", created_at: "2026-01-02" },
      { id: "evt_3", actor_kind: "system", entity_type: "order", entity_id: "ord_2", action: "c", created_at: "2026-01-03" },
    ])
    const result = await listAuditEventsByEntity(fake, "order", "ord_1")
    expect(result.ok && result.value.map((e) => e.id)).toEqual(["evt_2", "evt_1"])
  })
})
