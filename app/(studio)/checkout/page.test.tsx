import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: import("@/tests/helpers/fakeDb").FakeDb
vi.mock("@/src/data/supabaseClients", () => ({ getRequestDb: vi.fn(async () => db) }))

vi.mock("@/src/components/checkout/checkout-form", () => ({
  CheckoutForm: (props: { quoteId: string }) => (
    <div data-testid="form" data-quote={props.quoteId} />
  ),
}))

import CheckoutPage from "@/app/(studio)/checkout/page"
import { ok } from "@/src/lib/result"
import { createFakeDb } from "@/tests/helpers/fakeDb"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = (params: { quoteId?: string } = { quoteId: "qt_1" }) => ({
  searchParams: Promise.resolve(params),
})

const CONFIG = {
  id: "cfg_1",
  design_version_id: "dv_1",
  material_id: "pla",
  color_id: "pla-white",
  dimensions_mm: { x: 10, y: 10, z: 10 },
  scale_factor: 1,
  quality_id: "standard",
  strength_id: "everyday",
  shipping_speed: "standard",
  special_instructions: "",
  created_at: "1",
}

function seed(
  opts: {
    quotes?: Record<string, unknown>[]
    configs?: Record<string, unknown>[]
    dvs?: Record<string, unknown>[]
  } = {}
) {
  return createFakeDb({
    quotes: {
      rows: opts.quotes ?? [
        {
          id: "qt_1",
          configuration_id: "cfg_1",
          status: "active",
          amount_minor: 24360,
          currency: "INR",
          breakdown_json: [
            { key: "material", label: "Material", amount: { amountMinor: 6000, currency: "INR" } },
          ],
          expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "1",
        },
      ],
      unique: ["id"],
    },
    print_configurations: { rows: opts.configs ?? [CONFIG], unique: ["id"] },
    design_versions: {
      rows: opts.dvs ?? [{ id: "dv_1", project_id: "proj_1", thumbnail_asset_id: "ast_thumb" }],
      unique: ["id"],
    },
  })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  db = seed()
})

afterEach(() => vi.clearAllMocks())

describe("CheckoutPage", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(CheckoutPage(ctx())).rejects.toThrow("redirect:/login")
  })

  it("404s without a quote id", async () => {
    await expect(CheckoutPage(ctx({}))).rejects.toThrow("not-found")
  })

  it("404s for a quote that is not ours to see", async () => {
    db = seed({ quotes: [] })
    await expect(CheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the quote lookup fails", async () => {
    db.failNext({ message: "boom" })
    await expect(CheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the configuration is gone", async () => {
    db = seed({ configs: [] })
    await expect(CheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the configuration lookup fails", async () => {
    db.failCall(2, { message: "boom" })
    await expect(CheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the design version is gone", async () => {
    db = seed({ dvs: [] })
    await expect(CheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("404s when the design version lookup fails", async () => {
    db.failCall(3, { message: "boom" })
    await expect(CheckoutPage(ctx())).rejects.toThrow("not-found")
  })

  it("shows the frozen review panel and the payment form", async () => {
    render(await CheckoutPage(ctx()))
    expect(screen.getByTestId("form")).toHaveAttribute("data-quote", "qt_1")
    expect(screen.getByText("PLA")).toBeInTheDocument()
    expect(screen.getByText("₹243.60")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Model thumbnail" })).toBeInTheDocument()
  })

  it("refuses to show the form for a consumed quote", async () => {
    db = seed({
      quotes: [
        {
          id: "qt_1",
          configuration_id: "cfg_1",
          status: "consumed",
          amount_minor: 24360,
          currency: "INR",
          breakdown_json: [],
          expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "1",
        },
      ],
    })
    render(await CheckoutPage(ctx()))
    expect(screen.queryByTestId("form")).not.toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("can no longer be paid")
  })

  it("refuses to show the form for an expired quote", async () => {
    db = seed({
      quotes: [
        {
          id: "qt_1",
          configuration_id: "cfg_1",
          status: "active",
          amount_minor: 24360,
          currency: "INR",
          breakdown_json: [],
          expires_at: "2000-01-01T00:00:00.000Z",
          created_at: "1",
        },
      ],
    })
    render(await CheckoutPage(ctx()))
    expect(screen.queryByTestId("form")).not.toBeInTheDocument()
  })
})
