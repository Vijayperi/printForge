import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found")
  }),
}))

import AuthLayout from "@/app/(auth)/layout"
import LoginPage from "@/app/(auth)/login/page"
import ResetPasswordPage from "@/app/(auth)/reset-password/page"
import UpdatePasswordPage from "@/app/(auth)/reset-password/update/page"
import SignUpPage from "@/app/(auth)/sign-up/page"

describe("AuthLayout", () => {
  it("wraps children in the centered card with a home link", () => {
    render(
      <AuthLayout>
        <p>inside</p>
      </AuthLayout>
    )
    expect(screen.getByRole("link", { name: "PrintForge" })).toHaveAttribute("href", "/")
    expect(screen.getByText("inside")).toBeInTheDocument()
  })
})

describe("LoginPage", () => {
  it("renders the login form and passes a string next param through", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ next: "/projects/p1" }) }))
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument()
    const form = screen.getByRole("form", { name: "Log in" })
    expect(form.querySelector('input[name="next"]')).toHaveValue("/projects/p1")
  })

  it("ignores a non-string next param", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ next: ["a", "b"] }) }))
    expect(screen.getByRole("form", { name: "Log in" }).querySelector('input[name="next"]')).toBeNull()
  })
})

describe("static auth pages", () => {
  it("SignUpPage renders the sign-up form", () => {
    render(<SignUpPage />)
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "Sign up" })).toBeInTheDocument()
  })

  it("ResetPasswordPage renders the request form", () => {
    render(<ResetPasswordPage />)
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "Reset password" })).toBeInTheDocument()
  })

  it("UpdatePasswordPage renders the update form", () => {
    render(<UpdatePasswordPage />)
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "Set new password" })).toBeInTheDocument()
  })
})
