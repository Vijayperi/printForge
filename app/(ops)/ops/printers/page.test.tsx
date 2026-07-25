import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

import OpsPrintersPage from "@/app/(ops)/ops/printers/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }

function printer(over: Record<string, unknown> = {}) {
  return {
    id: "prn_1",
    name: "Bay 1",
    gateway_kind: "mock",
    capabilities_json: {},
    current_state: "idle",
    last_seen_at: "2026-07-26T09:30:00Z",
    created_at: "1",
    ...over,
  }
}

function job(over: Record<string, unknown> = {}) {
  return {
    id: "pj_1",
    order_id: "ord_1",
    printer_id: "prn_1",
    status: "printing",
    attempt: 1,
    gateway_job_ref: "gw-1",
    created_at: "1",
    ...over,
  }
}

function seed(printers: Record<string, unknown>[], jobs: Record<string, unknown>[] = []) {
  return createFakeDb({
    printers: { rows: printers, unique: ["id"] },
    print_jobs: { rows: jobs, unique: ["id"] },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed([printer()])
})

afterEach(() => vi.clearAllMocks())

describe("OpsPrintersPage", () => {
  it("404s anyone who is not an operator", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    await expect(OpsPrintersPage()).rejects.toThrow("not-found")
  })

  it("lists the fleet with what each machine last reported", async () => {
    render(await OpsPrintersPage())
    expect(screen.getByRole("heading", { name: "Printers" })).toBeInTheDocument()
    expect(screen.getByRole("rowheader", { name: "Bay 1" })).toBeInTheDocument()
    expect(screen.getByText("Idle")).toBeInTheDocument()
  })

  it("shows the job a machine is holding, from either holding state", async () => {
    db = seed(
      [printer({ current_state: "busy" }), printer({ id: "prn_2", name: "Bay 2", current_state: "busy" })],
      [job(), job({ id: "pj_2", order_id: "ord_2", printer_id: "prn_2", status: "released" })]
    )
    render(await OpsPrintersPage())

    expect(screen.getByRole("link", { name: /ord_1/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /ord_2/ })).toBeInTheDocument()
  })

  it("ignores jobs that are not on a machine", async () => {
    db = seed([printer()], [job({ status: "completed" }), job({ id: "pj_2", status: "pending" })])
    render(await OpsPrintersPage())
    expect(screen.getByText(/nothing loaded/i)).toBeInTheDocument()
  })

  it("renders an empty fleet rather than failing when the reads fail", async () => {
    db.failCall(1, { message: "db down" })
    db.failCall(2, { message: "db down" })
    render(await OpsPrintersPage())
    expect(screen.getByText(/no printers are configured/i)).toBeInTheDocument()
  })

  it("has no accessibility violations", async () => {
    db = seed([printer({ current_state: "error" })], [])
    const { container } = render(await OpsPrintersPage())
    await expect(axe(container)).resolves.toHaveNoViolations()
  })
})
