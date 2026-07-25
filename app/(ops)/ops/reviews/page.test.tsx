import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: vi.fn(() => db) }))

vi.mock("@/src/components/ops/review-decision", () => ({
  ReviewDecision: (props: { reportId: string }) => (
    <div data-testid="decision" data-report={props.reportId} />
  ),
}))

import OpsReviewsPage from "@/app/(ops)/ops/reviews/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }

function report(over: Record<string, unknown> = {}) {
  return {
    id: "vr_1",
    design_version_id: "dv_1",
    printer_profile_id: "generic-fdm",
    status: "manual_review",
    findings_json: [{ kind: "thin_wall", severity: "warning" }],
    created_at: "2026-01-05T00:00:00.000Z",
    ...over,
  }
}

function seed(rows: Record<string, unknown>[]) {
  return createFakeDb({ validation_reports: { rows, unique: ["id"] } })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed([report()])
})

afterEach(() => vi.clearAllMocks())

describe("OpsReviewsPage", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    await expect(OpsReviewsPage()).rejects.toThrow("not-found")
  })

  it("lists only reports awaiting a decision", async () => {
    db = seed([report(), report({ id: "vr_pass", status: "pass" })])
    render(await OpsReviewsPage())
    expect(screen.getAllByTestId("decision")).toHaveLength(1)
    expect(screen.getByTestId("decision")).toHaveAttribute("data-report", "vr_1")
  })

  it("shows the design version, profile and findings for triage", async () => {
    render(await OpsReviewsPage())
    expect(screen.getByText("dv_1")).toBeInTheDocument()
    expect(screen.getByText(/generic-fdm · 2026-01-05/)).toBeInTheDocument()
    expect(screen.getByText("thin_wall")).toBeInTheDocument()
  })

  it("says so when a queued report has no findings", async () => {
    db = seed([report({ findings_json: [] })])
    render(await OpsReviewsPage())
    expect(screen.getByText("No findings recorded.")).toBeInTheDocument()
  })

  it("works the queue oldest first", async () => {
    db = seed([
      report({ id: "vr_new", design_version_id: "dv_new", created_at: "2026-02-01T00:00:00.000Z" }),
      report({ id: "vr_old", design_version_id: "dv_old", created_at: "2026-01-01T00:00:00.000Z" }),
    ])
    render(await OpsReviewsPage())
    const ids = screen.getAllByTestId("decision").map((el) => el.getAttribute("data-report"))
    expect(ids).toEqual(["vr_old", "vr_new"])
  })

  it("celebrates an empty queue", async () => {
    db = seed([])
    render(await OpsReviewsPage())
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument()
  })

  it("shows an empty queue rather than crashing when the query fails", async () => {
    db.failNext({ message: "boom" })
    render(await OpsReviewsPage())
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument()
  })
})
