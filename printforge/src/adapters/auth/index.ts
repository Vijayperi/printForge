import type { Result } from "@/src/lib/result"

export type Role = "customer" | "operator" | "admin"

export interface AuthUser {
  userId: string
  email: string
  name: string
  role: Role
}

export interface AuthGateway {
  signUp(input: { email: string; password: string; name: string }): Promise<Result<AuthUser>>
  signInWithPassword(input: { email: string; password: string }): Promise<Result<AuthUser>>
  signOut(): Promise<Result<void>>
  requestPasswordReset(email: string): Promise<Result<void>>
  updatePassword(newPassword: string): Promise<Result<void>>
  /** Update the signed-in user's display name. */
  updateName(name: string): Promise<Result<AuthUser>>
  /** The currently signed-in user, or null when no session exists. */
  getUser(): Promise<Result<AuthUser | null>>
}

export const MIN_PASSWORD_LENGTH = 8
