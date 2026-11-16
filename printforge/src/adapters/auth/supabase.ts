import "server-only"

import { MIN_PASSWORD_LENGTH, type AuthGateway, type AuthUser, type Role } from "@/src/adapters/auth"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

interface AuthApiError {
  message: string
  status?: number
  code?: string
}

interface AuthUserPayload {
  data: { user: { id: string; email?: string } | null }
  error: AuthApiError | null
}

interface ProfileRow {
  user_id: string
  role: Role
  name: string
  email: string
}

/** The narrow structural slice of a Supabase client this gateway uses. */
export interface MinimalSupabase {
  auth: {
    signUp(input: {
      email: string
      password: string
      options?: { data?: Record<string, unknown> }
    }): Promise<AuthUserPayload>
    signInWithPassword(input: { email: string; password: string }): Promise<AuthUserPayload>
    signOut(): Promise<{ error: AuthApiError | null }>
    resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ error: AuthApiError | null }>
    updateUser(attrs: { password?: string }): Promise<AuthUserPayload>
    getUser(): Promise<AuthUserPayload>
  }
  from(table: "profiles"): {
    select(columns: string): {
      eq(
        column: "user_id",
        value: string
      ): {
        maybeSingle(): Promise<{ data: ProfileRow | null; error: AuthApiError | null }>
      }
    }
    update(values: { name: string }): {
      eq(
        column: "user_id",
        value: string
      ): {
        select(columns: string): {
          maybeSingle(): Promise<{ data: ProfileRow | null; error: AuthApiError | null }>
        }
      }
    }
  }
}

function isDuplicateSignUp(error: AuthApiError): boolean {
  return error.code === "user_already_exists" || /already registered/i.test(error.message)
}

function isAuthnFailure(error: AuthApiError): boolean {
  return error.code === "invalid_credentials" || error.status === 400 || error.status === 401 || error.status === 403
}

export class SupabaseAuthGateway implements AuthGateway {
  constructor(
    private readonly client: MinimalSupabase,
    private readonly appUrl: string
  ) {}

  async signUp(input: { email: string; password: string; name: string }): Promise<Result<AuthUser>> {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return err(appError("validation", `password must be at least ${MIN_PASSWORD_LENGTH} characters`))
    }
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name } },
    })
    if (error !== null) {
      if (isDuplicateSignUp(error)) {
        return err(appError("conflict", "an account with this email already exists"))
      }
      return err(appError("provider_error", `sign-up failed: ${error.message}`))
    }
    if (data.user === null) {
      return err(appError("provider_error", "sign-up did not return a user"))
    }
    return this.loadProfile(data.user.id)
  }

  async signInWithPassword(input: { email: string; password: string }): Promise<Result<AuthUser>> {
    const { data, error } = await this.client.auth.signInWithPassword(input)
    if (error !== null) {
      if (isAuthnFailure(error)) {
        return err(appError("unauthorized", "invalid email or password"))
      }
      return err(appError("provider_error", `sign-in failed: ${error.message}`))
    }
    if (data.user === null) {
      return err(appError("provider_error", "sign-in did not return a user"))
    }
    return this.loadProfile(data.user.id)
  }

  async signOut(): Promise<Result<void>> {
    const { error } = await this.client.auth.signOut()
    if (error !== null) {
      return err(appError("provider_error", `sign-out failed: ${error.message}`))
    }
    return ok(undefined)
  }

  async requestPasswordReset(email: string): Promise<Result<void>> {
    // Fire and report success regardless: never reveal whether the email exists.
    await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${this.appUrl}/reset-password/update`,
    })
    return ok(undefined)
  }

  async updatePassword(newPassword: string): Promise<Result<void>> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return err(appError("validation", `password must be at least ${MIN_PASSWORD_LENGTH} characters`))
    }
    const current = await this.client.auth.getUser()
    if (current.error !== null || current.data.user === null) {
      return err(appError("unauthorized", "not signed in"))
    }
    const { error } = await this.client.auth.updateUser({ password: newPassword })
    if (error !== null) {
      if (isAuthnFailure(error)) {
        return err(appError("unauthorized", "not signed in"))
      }
      return err(appError("provider_error", `password update failed: ${error.message}`))
    }
    return ok(undefined)
  }

  async updateName(name: string): Promise<Result<AuthUser>> {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      return err(appError("validation", "name must not be empty"))
    }
    const current = await this.client.auth.getUser()
    if (current.error !== null || current.data.user === null) {
      return err(appError("unauthorized", "not signed in"))
    }
    const { data, error } = await this.client
      .from("profiles")
      .update({ name: trimmed })
      .eq("user_id", current.data.user.id)
      .select("user_id, role, name, email")
      .maybeSingle()
    if (error !== null || data === null) {
      return err(appError("provider_error", "profile update failed"))
    }
    return ok({ userId: data.user_id, email: data.email, name: data.name, role: data.role })
  }

  async getUser(): Promise<Result<AuthUser | null>> {
    const { data, error } = await this.client.auth.getUser()
    if (error !== null || data.user === null) {
      return ok(null)
    }
    return this.loadProfile(data.user.id)
  }

  private async loadProfile(userId: string): Promise<Result<AuthUser>> {
    const { data, error } = await this.client
      .from("profiles")
      .select("user_id, role, name, email")
      .eq("user_id", userId)
      .maybeSingle()
    if (error !== null || data === null) {
      return err(appError("provider_error", "profile row missing for authenticated user"))
    }
    return ok({ userId: data.user_id, email: data.email, name: data.name, role: data.role })
  }
}
