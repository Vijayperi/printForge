"use client"

import { useActionState } from "react"
import Link from "next/link"

import type { AuthFormState } from "@/app/(auth)/actions"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"

type FormAction = (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>

export function FieldError({ id, messages }: { id: string; messages?: string[] | undefined }) {
  if (messages === undefined || messages.length === 0) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {messages.join("; ")}
    </p>
  )
}

export function FormError({ message }: { message?: string | undefined }) {
  if (message === undefined) return null
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

function TextField({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  errors,
}: {
  label: string
  name: string
  type?: string
  autoComplete?: string
  defaultValue?: string
  errors?: string[] | undefined
}) {
  const errorId = `${name}-error`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={errors !== undefined && errors.length > 0 ? true : undefined}
        aria-describedby={errors !== undefined && errors.length > 0 ? errorId : undefined}
      />
      <FieldError id={errorId} messages={errors} />
    </div>
  )
}

export function LoginForm({ action, next }: { action: FormAction; next?: string | undefined }) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} className="space-y-4" aria-label="Log in">
      {next === undefined ? null : <input type="hidden" name="next" value={next} />}
      <FormError message={state.formError} />
      <TextField label="Email" name="email" type="email" autoComplete="email" errors={state.fieldErrors?.["email"]} />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.["password"]}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        Log in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/reset-password" className="hover:text-foreground">
          Forgot password?
        </Link>
        {" · "}
        <Link href="/sign-up" className="hover:text-foreground">
          Create an account
        </Link>
      </p>
    </form>
  )
}

export function SignUpForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} className="space-y-4" aria-label="Sign up">
      <FormError message={state.formError} />
      <TextField label="Name" name="name" autoComplete="name" errors={state.fieldErrors?.["name"]} />
      <TextField label="Email" name="email" type="email" autoComplete="email" errors={state.fieldErrors?.["email"]} />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.["password"]}
      />
      <TextField
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.["confirm"]}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="hover:text-foreground">
          Log in
        </Link>
      </p>
    </form>
  )
}

export function ResetRequestForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, {})
  if (state.done === true) {
    return (
      <p role="status" className="text-sm">
        If an account exists for that email, a reset link is on its way.
      </p>
    )
  }
  return (
    <form action={formAction} className="space-y-4" aria-label="Reset password">
      <TextField label="Email" name="email" type="email" autoComplete="email" errors={state.fieldErrors?.["email"]} />
      <Button type="submit" className="w-full" disabled={pending}>
        Send reset link
      </Button>
    </form>
  )
}

export function UpdatePasswordForm({ action }: { action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} className="space-y-4" aria-label="Set new password">
      <FormError message={state.formError} />
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.["password"]}
      />
      <TextField
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.["confirm"]}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        Update password
      </Button>
    </form>
  )
}

export function ProfileForm({ action, initialName }: { action: FormAction; initialName: string }) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} className="space-y-4" aria-label="Profile">
      <FormError message={state.formError} />
      {state.done === true ? (
        <p role="status" className="text-sm text-muted-foreground">
          Profile updated.
        </p>
      ) : null}
      <TextField
        label="Name"
        name="name"
        autoComplete="name"
        defaultValue={initialName}
        errors={state.fieldErrors?.["name"]}
      />
      <Button type="submit" disabled={pending}>
        Save changes
      </Button>
    </form>
  )
}

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  )
}
