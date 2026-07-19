import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import type { AuthFormState } from "@/app/(auth)/actions"
import {
  FieldError,
  FormError,
  LoginForm,
  ProfileForm,
  ResetRequestForm,
  SignOutButton,
  SignUpForm,
  UpdatePasswordForm,
} from "@/src/components/auth/forms"

const idle = async (): Promise<AuthFormState> => ({})

describe("FieldError / FormError", () => {
  it("render nothing without messages", () => {
    const { container } = render(
      <>
        <FieldError id="x" messages={undefined} />
        <FieldError id="y" messages={[]} />
        <FormError message={undefined} />
      </>
    )
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(0)
  })

  it("render alerts with messages", () => {
    render(
      <>
        <FieldError id="x" messages={["too short", "required"]} />
        <FormError message="something failed" />
      </>
    )
    expect(screen.getByText("too short; required")).toHaveAttribute("role", "alert")
    expect(screen.getByText("something failed")).toHaveAttribute("role", "alert")
  })
})

describe("LoginForm", () => {
  it("renders email, password, links, and hidden next", () => {
    render(<LoginForm action={idle} next="/projects/p1" />)
    expect(screen.getByLabelText("Email")).toBeInTheDocument()
    expect(screen.getByLabelText("Password")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/reset-password")
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up")
    const form = screen.getByRole("form", { name: "Log in" })
    expect(form.querySelector('input[name="next"]')).toHaveValue("/projects/p1")
  })

  it("omits the hidden next field when absent", () => {
    render(<LoginForm action={idle} />)
    expect(screen.getByRole("form", { name: "Log in" }).querySelector('input[name="next"]')).toBeNull()
  })

  it("shows a form error returned by the action", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (): Promise<AuthFormState> => ({ formError: "invalid email or password" }))
    render(<LoginForm action={action} />)
    await user.click(screen.getByRole("button", { name: "Log in" }))
    await waitFor(() => expect(screen.getByText("invalid email or password")).toBeInTheDocument())
    expect(action).toHaveBeenCalledOnce()
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<LoginForm action={idle} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("SignUpForm", () => {
  it("renders all fields and the login link", () => {
    render(<SignUpForm action={idle} />)
    for (const label of ["Name", "Email", "Password", "Confirm password"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login")
  })

  it("shows field errors returned by the action", async () => {
    const user = userEvent.setup()
    const action = vi.fn(
      async (): Promise<AuthFormState> => ({ fieldErrors: { confirm: ["passwords do not match"] } })
    )
    render(<SignUpForm action={action} />)
    await user.click(screen.getByRole("button", { name: "Create account" }))
    await waitFor(() => expect(screen.getByText("passwords do not match")).toBeInTheDocument())
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-invalid", "true")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(<SignUpForm action={idle} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("ResetRequestForm", () => {
  it("switches to the done message after submission", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (): Promise<AuthFormState> => ({ done: true }))
    render(<ResetRequestForm action={action} />)
    await user.type(screen.getByLabelText("Email"), "a@b.com")
    await user.click(screen.getByRole("button", { name: "Send reset link" }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/reset link is on its way/))
    expect(screen.queryByRole("button", { name: "Send reset link" })).not.toBeInTheDocument()
  })
})

describe("UpdatePasswordForm", () => {
  it("renders both password fields", () => {
    render(<UpdatePasswordForm action={idle} />)
    expect(screen.getByLabelText("New password")).toBeInTheDocument()
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument()
  })

  it("shows a form error from the action", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (): Promise<AuthFormState> => ({ formError: "not signed in" }))
    render(<UpdatePasswordForm action={action} />)
    await user.click(screen.getByRole("button", { name: "Update password" }))
    await waitFor(() => expect(screen.getByText("not signed in")).toBeInTheDocument())
  })
})

describe("ProfileForm", () => {
  it("prefills the current name", () => {
    render(<ProfileForm action={idle} initialName="Vijay" />)
    expect(screen.getByLabelText("Name")).toHaveValue("Vijay")
  })

  it("shows the saved confirmation", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (): Promise<AuthFormState> => ({ done: true }))
    render(<ProfileForm action={action} initialName="V" />)
    await user.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profile updated."))
  })
})

describe("SignOutButton", () => {
  it("invokes the action on click", async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => {})
    render(<SignOutButton action={action} />)
    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await waitFor(() => expect(action).toHaveBeenCalledOnce())
  })
})
