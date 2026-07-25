import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({
  getAuthGateway: vi.fn(async () => ({ getUser })),
}))

import StudioLayout from "@/app/(studio)/layout"
import ProfilePage from "@/app/(studio)/profile/page"
import { ok, err } from "@/src/lib/result"
import { appError } from "@/src/lib/errors"

const USER = { userId: "u1", email: "me@example.com", name: "Me", role: "customer" as const }

afterEach(() => vi.clearAllMocks())

describe("StudioLayout", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(StudioLayout({ children: <p>child</p> })).rejects.toThrow("redirect:/login")
  })

  it("redirects to login when the gateway fails", async () => {
    getUser.mockResolvedValue(err(appError("provider_error", "down")))
    await expect(StudioLayout({ children: <p>child</p> })).rejects.toThrow("redirect:/login")
  })

  it("renders the shell with the user's email and children", async () => {
    getUser.mockResolvedValue(ok(USER))
    render(await StudioLayout({ children: <p>the child content</p> }))
    expect(screen.getByRole("link", { name: "me@example.com" })).toHaveAttribute("href", "/profile")
    expect(screen.getByRole("link", { name: "My projects" })).toHaveAttribute("href", "/projects")
    expect(screen.getByRole("link", { name: "My orders" })).toHaveAttribute("href", "/orders")
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument()
    expect(screen.getByText("the child content")).toBeInTheDocument()
  })
})

// ProjectsPage is covered by app/(studio)/projects/page.test.tsx.

describe("ProfilePage", () => {
  it("redirects to login without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    await expect(ProfilePage()).rejects.toThrow("redirect:/login")
  })

  it("redirects to login when the gateway fails", async () => {
    getUser.mockResolvedValue(err(appError("provider_error", "down")))
    await expect(ProfilePage()).rejects.toThrow("redirect:/login")
  })

  it("renders email, role badge, and prefilled name form", async () => {
    getUser.mockResolvedValue(ok(USER))
    render(await ProfilePage())
    expect(screen.getByText("me@example.com")).toBeInTheDocument()
    expect(screen.getByText("customer")).toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toHaveValue("Me")
    expect(screen.getByRole("link", { name: "Change password" })).toHaveAttribute(
      "href",
      "/reset-password/update"
    )
  })
})
