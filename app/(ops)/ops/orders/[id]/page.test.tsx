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

vi.mock("@/src/components/ops/review-actions", () => ({
  ReviewActions: (props: { orderId: string; state: string; heldFrom: string | null }) => (
    <div data-testid="review" data-state={props.state} data-held={props.heldFrom ?? ""} />
  ),
}))

vi.mock("@/src/components/ops/notes-thread", () => ({
  NotesThread: (props: { notes: { id: string; note: string }[] }) => (
    <div data-testid="notes" data-count={props.notes.length}>
      {props.notes.map((n) => (
        <span key={n.id}>{n.note}</span>
      ))}
    </div>
  ),
}))

import OpsOrderDetailPage from "@/app/(ops)/ops/orders/[id]/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const OPERATOR = { userId: "op1", email: "op@x.com", name: "Op", role: "operator" as const }
const ctx = { params: Promise.resolve({ id: "ord_1" }) }

const FROZEN = {
  configurationId: "cfg_1",
  materialId: "petg",
  colorId: "petg-black",
  dimensionsMm: { x: 10, y: 10, z: 10 },
  scaleFactor: 1,
  qualityId: "standard",
  strengthId: "everyday",
  shippingSpeed: "standard",
  specialInstructions: "",
}

function seed(
  opts: {
    order?: Record<string, unknown>
    reports?: Record<string, unknown>[]
    audits?: Record<string, unknown>[]
    notifications?: Record<string, unknown>[]
    quotes?: Record<string, unknown>[]
  } = {}
) {
  return createFakeDb({
    orders: {
      rows: [
        {
          id: "ord_1",
          user_id: "u1",
          quote_id: "qt_1",
          status: "design_review",
          payment_status: "paid",
          payment_ref: "pay_mock_ord_1",
          held_from_status: null,
          frozen_dv_id: "dv_1",
          frozen_config_json: FROZEN,
          contact_json: { name: "Asha Rao", email: "asha@example.com" },
          shipping_address_json: { city: "Bengaluru", state: "Karnataka", pincode: "560025" },
          created_at: "2026-01-01",
          ...opts.order,
        },
      ],
      unique: ["id"],
    },
    quotes: {
      rows: opts.quotes ?? [
        {
          id: "qt_1",
          amount_minor: 24360,
          breakdown_json: [],
          slice_json: { materialGrams: 20, durationMinutes: 90 },
          created_at: "1",
        },
      ],
      unique: ["id"],
    },
    design_versions: {
      rows: [{ id: "dv_1", project_id: "proj_1", thumbnail_asset_id: null }],
      unique: ["id"],
    },
    validation_reports: {
      rows: opts.reports ?? [
        {
          id: "vr_1",
          design_version_id: "dv_1",
          status: "warning",
          findings_json: [{ kind: "thin_wall", severity: "warning", detail: "0.6mm rib" }],
          created_at: "2026-01-02",
        },
      ],
      unique: ["id"],
    },
    audit_events: { rows: opts.audits ?? [], unique: ["id"] },
    notification_log: { rows: opts.notifications ?? [], unique: ["id"] },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(OPERATOR))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("OpsOrderDetailPage — access", () => {
  it("404s a customer", async () => {
    getUser.mockResolvedValue(ok({ ...OPERATOR, role: "customer" }))
    await expect(OpsOrderDetailPage(ctx)).rejects.toThrow("not-found")
  })

  it("404s an order that does not exist", async () => {
    db = createFakeDb({ orders: { rows: [], unique: ["id"] } })
    await expect(OpsOrderDetailPage(ctx)).rejects.toThrow("not-found")
  })

  it("404s when the order lookup fails", async () => {
    db.failNext({ message: "boom" })
    await expect(OpsOrderDetailPage(ctx)).rejects.toThrow("not-found")
  })
})

describe("OpsOrderDetailPage — operator view", () => {
  it("heads with the order, customer and current status", async () => {
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByRole("heading", { name: "ord_1" })).toBeInTheDocument()
    expect(screen.getByText(/asha@example.com · Design review/)).toBeInTheDocument()
  })

  it("shows the RAW findings an operator needs, not just the verdict", async () => {
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("thin_wall")).toBeInTheDocument()
    expect(screen.getByText("(warning)")).toBeInTheDocument()
    expect(screen.getByText("0.6mm rib")).toBeInTheDocument()
  })

  it("says so when a report has no findings", async () => {
    db = seed({
      reports: [{ id: "vr_1", design_version_id: "dv_1", status: "pass", findings_json: [], created_at: "1" }],
    })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("No findings recorded.")).toBeInTheDocument()
  })

  it("renders slice metadata from the quote", async () => {
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("materialGrams")).toBeInTheDocument()
    expect(screen.getByText("90")).toBeInTheDocument()
  })

  it("says so when there is no slice", async () => {
    db = seed({ quotes: [{ id: "qt_1", amount_minor: 0, breakdown_json: [], slice_json: null, created_at: "1" }] })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("No slice recorded.")).toBeInTheDocument()
  })

  it("shows the payment axis and reference", async () => {
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("paid")).toBeInTheDocument()
    expect(screen.getByText("pay_mock_ord_1")).toBeInTheDocument()
  })

  it("hands the review controls the current state and hold origin", async () => {
    db = seed({ order: { status: "on_hold", held_from_status: "printing" } })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByTestId("review")).toHaveAttribute("data-state", "on_hold")
    expect(screen.getByTestId("review")).toHaveAttribute("data-held", "printing")
  })

  it("passes only note audit rows into the thread, oldest first", async () => {
    db = seed({
      audits: [
        // listAuditEventsByEntity returns newest first; the thread reverses it.
        { id: "evt_3", entity_type: "order", entity_id: "ord_1", action: "order.note", metadata: { note: "second", authorEmail: "op@x.com" }, created_at: "2026-01-03" },
        { id: "evt_2", entity_type: "order", entity_id: "ord_1", action: "order.review.hold", metadata: { reason: "not a note" }, created_at: "2026-01-02" },
        { id: "evt_1", entity_type: "order", entity_id: "ord_1", action: "order.note", metadata: { note: "first", authorEmail: "op@x.com" }, created_at: "2026-01-01" },
      ],
    })
    render(await OpsOrderDetailPage(ctx))
    const notes = screen.getByTestId("notes")
    expect(notes).toHaveAttribute("data-count", "2")
    expect(notes.textContent).toBe("firstsecond")
  })

  it("shows a placeholder when no payment reference has been recorded", async () => {
    db = seed({ order: { payment_ref: null } })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("—")).toBeInTheDocument()
  })

  it("renders a finding that carries no detail line", async () => {
    db = seed({
      reports: [
        {
          id: "vr_1",
          design_version_id: "dv_1",
          status: "manual_review",
          findings_json: [{ kind: "self_intersection", severity: "blocking" }],
          created_at: "1",
        },
      ],
    })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("self_intersection")).toBeInTheDocument()
  })

  it("falls back for a note row with no stored text or author", async () => {
    db = seed({
      audits: [
        {
          id: "evt_1",
          entity_type: "order",
          entity_id: "ord_1",
          action: "order.note",
          metadata: {},
          created_at: "2026-01-01",
        },
      ],
    })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByTestId("notes")).toHaveAttribute("data-count", "1")
  })

  it("lists the notifications sent for the order", async () => {
    db = seed({
      notifications: [
        { id: "ntf_1", order_id: "ord_1", template: "order_receipt", status: "sent", created_at: "1" },
      ],
    })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("order_receipt")).toBeInTheDocument()
    expect(screen.getByText("sent")).toBeInTheDocument()
  })

  it("says so when nothing has been sent", async () => {
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByText("Nothing sent yet.")).toBeInTheDocument()
  })

  it("still renders when the side queries fail", async () => {
    db.failCall(2, { message: "boom" })
    db.failCall(3, { message: "boom" })
    db.failCall(4, { message: "boom" })
    db.failCall(5, { message: "boom" })
    db.failCall(6, { message: "boom" })
    render(await OpsOrderDetailPage(ctx))
    expect(screen.getByRole("heading", { name: "ord_1" })).toBeInTheDocument()
    expect(screen.getByTestId("notes")).toHaveAttribute("data-count", "0")
  })
})
