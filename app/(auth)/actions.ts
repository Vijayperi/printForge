"use server"

import { headers } from "next/headers"
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
import { authContent } from "@/src/config/content"
import { getServiceDb } from "@/src/data/supabaseClients"
import { SystemClock } from "@/src/lib/clock"
import { clientIpFrom } from "@/src/lib/clientIp"
import { enforceRateLimit } from "@/src/lib/rateLimit"

export interface AuthFormState {
  formError?: string
  fieldErrors?: FieldErrors
  done?: boolean
}

/**
 * Throttle the three unauthenticated auth entry points (plan §6-S16 step 2).
 *
 * Two buckets, because one cannot do both jobs: a tight per-account limit stops
 * someone guessing their way into a particular person's account, and a loose
 * per-network one bounds spraying across many accounts without punishing every
 * household behind a shared address.
 *
 * Returns the form state to show, or null when the caller may proceed.
 */
async function authThrottle(email: string): Promise<AuthFormState | null> {
  const db = getServiceDb()
  const clock = new SystemClock()
  const subjects = [
    ["auth", email.toLowerCase()],
    ["authNetwork", clientIpFrom(await headers())],
  ] as const

  for (const [scope, subject] of subjects) {
    const rate = await enforceRateLimit(db, clock, scope, subject)
    if (!rate.ok) return { formError: rate.error.message }
    if (!rate.value.allowed) return { formError: authContent.rateLimited }
  }
  return null
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) }
  }
  const throttled = await authThrottle(parsed.data.email)
  if (throttled !== null) return throttled

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
  const throttled = await authThrottle(parsed.data.email)
  if (throttled !== null) return throttled

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
  const throttled = await authThrottle(parsed.data.email)
  if (throttled !== null) return throttled

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
