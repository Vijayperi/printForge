import { z } from "zod"

import { MIN_PASSWORD_LENGTH } from "@/src/adapters/auth"

const emailField = z.email("enter a valid email address")
const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)

export const signUpSchema = z
  .object({
    name: z.string().trim().min(1, "enter your name").max(80, "name is too long"),
    email: emailField,
    password: passwordField,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "passwords do not match",
  })

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "enter your password"),
  next: z
    .string()
    .startsWith("/", "invalid redirect target")
    .refine((v) => !v.startsWith("//"), "invalid redirect target")
    .optional(),
})

export const resetRequestSchema = z.object({ email: emailField })

export const updatePasswordSchema = z
  .object({ password: passwordField, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "passwords do not match",
  })

export const profileSchema = z.object({
  name: z.string().trim().min(1, "enter your name").max(80, "name is too long"),
})

export type FieldErrors = Record<string, string[] | undefined>

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form")
    out[key] = [...(out[key] ?? []), issue.message]
  }
  return out
}
