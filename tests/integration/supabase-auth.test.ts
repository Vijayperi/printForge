/**
 * Integration tests against the LOCAL Supabase stack (`supabase start`).
 * Run with: npm run test:integration
 * Skipped unless SUPABASE_INTEGRATION=1 so plain `npm test` and CI stay green
 * without Docker.
 */
import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { authGatewayContract } from "@/src/adapters/auth/contract.spec-factory"
import { SupabaseAuthGateway, type MinimalSupabase } from "@/src/adapters/auth/supabase"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
// The well-known supabase-demo anon JWT used by every local stack.
const ANON =
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

function freshClient() {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe.skipIf(!RUN)("SupabaseAuthGateway against local Supabase", () => {
  authGatewayContract(() => {
    return new SupabaseAuthGateway(freshClient() as unknown as MinimalSupabase, "http://localhost:3000")
  })

  it("seeded users can sign in with their roles", async () => {
    const gateway = new SupabaseAuthGateway(
      freshClient() as unknown as MinimalSupabase,
      "http://localhost:3000"
    )
    const result = await gateway.signInWithPassword({
      email: "operator@printforge.test",
      password: "printforge-dev-123",
    })
    expect(result.ok && result.value.role).toBe("operator")
  })

  it("a seeded customer cannot change their own role (RLS with-check)", async () => {
    const client = freshClient()
    await client.auth.signInWithPassword({
      email: "customer1@printforge.test",
      password: "printforge-dev-123",
    })
    const { data: me } = await client.auth.getUser()
    const { data, error } = await client
      .from("profiles")
      .update({ role: "admin" })
      .eq("user_id", me.user?.id ?? "")
      .select("role")
    // The with-check policy rejects the role change: either an error or zero
    // rows updated. Confirm the role is unchanged via a fresh read.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    const { data: after } = await client
      .from("profiles")
      .select("role")
      .eq("user_id", me.user?.id ?? "")
      .maybeSingle()
    expect(after?.role).toBe("customer")
  })
})

describe.skipIf(!RUN)("profiles RLS isolation", () => {
  async function signedInClient(email: string) {
    const client = freshClient()
    const { error } = await client.auth.signInWithPassword({ email, password: "printforge-dev-123" })
    expect(error).toBeNull()
    return client
  }

  it("a customer cannot read another customer's profile row", async () => {
    const customer1 = await signedInClient("customer1@printforge.test")
    const customer2 = await signedInClient("customer2@printforge.test")

    const { data: c2 } = await customer2.auth.getUser()
    const otherUserId = c2.user?.id ?? ""

    // customer1 queries customer2's row explicitly; RLS returns zero rows.
    const { data, error } = await customer1
      .from("profiles")
      .select("user_id, email")
      .eq("user_id", otherUserId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("a customer reading all profiles sees only their own", async () => {
    const customer1 = await signedInClient("customer1@printforge.test")
    const { data } = await customer1.from("profiles").select("email")
    expect(data).toEqual([{ email: "customer1@printforge.test" }])
  })
})
