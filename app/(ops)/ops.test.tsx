import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({
  getAuthGateway: vi.fn(async () => ({ getUser })),
}))

import OpsLayout from "@/app/(ops)/layout"
import { err, ok } from "@/src/lib/result"
import { appError } from "@/src/lib/errors"

afterEach(() => vi.clearAllMocks())

describe("OpsLayout", () => {
  it("404s for anonymous visitors", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(OpsLayout({ children: <p>ops</p> })).rejects.toThrow("not-found")
  })

  it("404s when the gateway fails", async () => {
    getUser.mockResolvedValue(err(appError("provider_error", "down")))
    await expect(OpsLayout({ children: <p>ops</p> })).rejects.toThrow("not-found")
  })

  it("404s for customers", async () => {
    getUser.mockResolvedValue(ok({ userId: "u", email: "c@x.com", name: "C", role: "customer" }))
    await expect(OpsLayout({ children: <p>ops</p> })).rejects.toThrow("not-found")
  })

  it.each([["operator"], ["admin"]] as const)("renders for %s", async (role) => {
    getUser.mockResolvedValue(ok({ userId: "u", email: `${role}@x.com`, name: "O", role }))
    render(await OpsLayout({ children: <p>ops content</p> }))
    expect(screen.getByText(new RegExp(`${role}@x.com \\(${role}\\)`))).toBeInTheDocument()
    expect(screen.getByText("ops content")).toBeInTheDocument()
  })
})
