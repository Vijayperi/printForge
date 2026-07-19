"use server"

import { redirect } from "next/navigation"

import {
  fieldErrorsOf,
  loginSchema,
  profileSchema,
  resetRequestSchema,
  signUpSchema,
  updatePasswordSchema,
  type FieldErrors,
} from "@/app/(auth)/schemas"
import { getAuthGateway } from "@/src/adapters/auth/factory"

export interface AuthFormState {
  formError?: string
  fieldErrors?: FieldErrors
  done?: boolean
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const gateway = await getAuthGateway()
  const result = await gateway.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    name: parsed.data.name,
  })
  if (!result.ok) {
    return { formError: result.error.message }
  }
  redirect("/projects")
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const gateway = await getAuthGateway()
  const result = await gateway.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })
  if (!result.ok) {
    return { formError: result.error.message }
  }
  redirect(parsed.data.next ?? "/projects")
}

export async function signOutAction(): Promise<void> {
  const gateway = await getAuthGateway()
  await gateway.signOut()
  redirect("/")
}

export async function resetRequestAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const gateway = await getAuthGateway()
  await gateway.requestPasswordReset(parsed.data.email)
  return { done: true }
}

export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const gateway = await getAuthGateway()
  const result = await gateway.updatePassword(parsed.data.password)
  if (!result.ok) {
    return { formError: result.error.message }
  }
  redirect("/profile")
}

export async function updateProfileAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = profileSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const gateway = await getAuthGateway()
  const result = await gateway.updateName(parsed.data.name)
  if (!result.ok) {
    return { formError: result.error.message }
  }
  return { done: true }
}
