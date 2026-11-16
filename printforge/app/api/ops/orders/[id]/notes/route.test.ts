import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, type FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import { ORDER_NOTE_ACTION, POST } from "@/app/api/ops/orders/[id]/notes/route"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "ord_1" }) }

function seed(orders: Record<string, unknown>[] = [{ id: "ord_1", user_id: "u1", created_at: "1" }]) {
  return createFakeDb({
    orders: { rows: orders, unique: ["id"] },
    audit_events: { rows: [], unique: ["id"] },
  })
}

function post(body: unknown): Request {
  return new Request("http://test/api/ops/orders/ord_1/notes", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("POST …/notes", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    expect((await POST(post({ note: "hi" }), ctx)).status).toBe(404)
    expect(db.rows("audit_events")).toHaveLength(0)
  })

  it("appends an attributed note to the audit trail", async () => {
    const response = await POST(post({ note: "  customer called  " }), ctx)
    expect(response.status).toBe(201)
    expect(db.rows("audit_events")[0]).toMatchObject({
      actor_id: "op1",
      actor_kind: "user",
      entity_type: "order",
      entity_id: "ord_1",
      action: ORDER_NOTE_ACTION,
      metadata: { note: "customer called", authorEmail: "op@x.com" },
    })
  })

  it("400s a non-json body", async () => {
    const request = new Request("http://test/api/ops/orders/ord_1/notes", {
      method: "POST",
      body: "{",
    })
    expect((await POST(request, ctx)).status).toBe(400)
  })

  it.each([
    ["an empty note", { note: "   " }],
    ["a missing note", {}],
    ["an over-long note", { note: "x".repeat(2001) }],
    ["an extra key", { note: "ok", pinned: true }],
  ])("400s %s", async (_label, body) => {
    expect((await POST(post(body), ctx)).status).toBe(400)
  })

  it("404s an order that does not exist", async () => {
    db = seed([])
    expect((await POST(post({ note: "hi" }), ctx)).status).toBe(404)
  })

  it("502s when the order lookup fails", async () => {
    db.failNext({ message: "boom" })
    expect((await POST(post({ note: "hi" }), ctx)).status).toBe(502)
  })

  it("502s when the note cannot be written", async () => {
    db.failCall(2, { message: "boom" })
    expect((await POST(post({ note: "hi" }), ctx)).status).toBe(502)
  })
})
