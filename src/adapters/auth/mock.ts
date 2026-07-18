import { MIN_PASSWORD_LENGTH, type AuthGateway, type AuthUser, type Role } from "@/src/adapters/auth"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

interface MockUser extends AuthUser {
  password: string
}

/**
 * In-memory auth for development and tests. Session state is a single
 * current-user slot, mirroring one browser's cookie session.
 */
export class MockAuthGateway implements AuthGateway {
  private users = new Map<string, MockUser>()
  private currentUserId: string | null = null
  private nextId = 1

  /** Test/dev helper: seed a user without going through signUp. */
  seed(input: { email: string; password: string; name: string; role: Role }): AuthUser {
    const user: MockUser = {
      userId: `mock-user-${this.nextId}`,
      email: input.email,
      name: input.name,
      role: input.role,
      password: input.password,
    }
    this.nextId += 1
    this.users.set(user.email, user)
    return this.toPublic(user)
  }

  async signUp(input: { email: string; password: string; name: string }): Promise<Result<AuthUser>> {
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      return err(appError("validation", `password must be at least ${MIN_PASSWORD_LENGTH} characters`))
    }
    if (this.users.has(input.email)) {
      return err(appError("conflict", "an account with this email already exists"))
    }
    const user = this.seed({ ...input, role: "customer" })
    this.currentUserId = user.userId
    return ok(user)
  }

  async signInWithPassword(input: { email: string; password: string }): Promise<Result<AuthUser>> {
    const user = this.users.get(input.email)
    if (user === undefined || user.password !== input.password) {
      return err(appError("unauthorized", "invalid email or password"))
    }
    this.currentUserId = user.userId
    return ok(this.toPublic(user))
  }

  async signOut(): Promise<Result<void>> {
    this.currentUserId = null
    return ok(undefined)
  }

  async requestPasswordReset(email: string): Promise<Result<void>> {
    // Matches real-provider behavior: never reveal whether the email exists.
    void email
    return ok(undefined)
  }

  async updatePassword(newPassword: string): Promise<Result<void>> {
    if (this.currentUserId === null) {
      return err(appError("unauthorized", "not signed in"))
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return err(appError("validation", `password must be at least ${MIN_PASSWORD_LENGTH} characters`))
    }
    const user = [...this.users.values()].find((u) => u.userId === this.currentUserId)
    ;(user as MockUser).password = newPassword
    return ok(undefined)
  }

  async getUser(): Promise<Result<AuthUser | null>> {
    if (this.currentUserId === null) return ok(null)
    const user = [...this.users.values()].find((u) => u.userId === this.currentUserId) as MockUser
    return ok(this.toPublic(user))
  }

  private toPublic(user: MockUser): AuthUser {
    return { userId: user.userId, email: user.email, name: user.name, role: user.role }
  }
}
