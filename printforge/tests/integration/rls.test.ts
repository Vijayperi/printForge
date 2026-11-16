/**
 * RLS policy harness (plan §6-S4, step 2) against the LOCAL Supabase stack.
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1)
 * Skipped otherwise so plain `npm test` / CI stay green without Docker.
 *
 * Proves the §4.5 access matrix: customers reach only their own rows through
 * the ownership chain; server-managed tables are unreachable by customers;
 * staff (operator/admin) get read-all.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { beforeAll, describe, expect, it } from "vitest"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const ANON =
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

const PASSWORD = "printforge-dev-123"
const STAMP = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

function freshClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signIn(email: string): Promise<{ client: SupabaseClient; uid: string }> {
  const client = freshClient()
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  expect(error).toBeNull()
  const { data } = await client.auth.getUser()
  return { client, uid: data.user?.id ?? "" }
}

/** A denied read surfaces as either a permission error or zero visible rows. */
function isDeniedOrEmpty(result: { data: unknown[] | null; error: unknown }): boolean {
  return result.error !== null || (result.data ?? []).length === 0
}

describe.skipIf(!RUN)("RLS access matrix", () => {
  let c1: SupabaseClient
  let c1Uid: string
  let c2: SupabaseClient
  let c2Uid: string
  let op: SupabaseClient

  const projA = `proj_rls_${STAMP}_A` // owned by customer1
  const projForOp = `proj_rls_${STAMP}_OP` // owned by customer1, read by operator
  const dvA = `dv_rls_${STAMP}_A`

  beforeAll(async () => {
    ;({ client: c1, uid: c1Uid } = await signIn("customer1@printforge.test"))
    ;({ client: c2, uid: c2Uid } = await signIn("customer2@printforge.test"))
    ;({ client: op } = await signIn("operator@printforge.test"))
  })

  it("1. a customer inserts and reads back their own project", async () => {
    const { error: insErr } = await c1
      .from("projects")
      .insert({ id: projA, user_id: c1Uid, title: "RLS A" })
    expect(insErr).toBeNull()

    const { data, error } = await c1.from("projects").select("id").eq("id", projA)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: projA }])
  })

  it("2. another customer cannot see that project", async () => {
    const { data, error } = await c2.from("projects").select("id").eq("id", projA)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("3. a customer cannot insert a project owned by someone else (with-check)", async () => {
    const { error } = await c1
      .from("projects")
      .insert({ id: `proj_rls_${STAMP}_forged`, user_id: c2Uid, title: "forged" })
    expect(error).not.toBeNull()
  })

  it("4. a customer updates only their own project", async () => {
    const { error: ownErr } = await c1
      .from("projects")
      .update({ title: "RLS A renamed" })
      .eq("id", projA)
    expect(ownErr).toBeNull()

    // customer2 attempts to rename customer1's project → no row is affected.
    await c2.from("projects").update({ title: "hijacked" }).eq("id", projA)
    const { data } = await c1.from("projects").select("title").eq("id", projA).maybeSingle()
    expect(data?.["title"]).toBe("RLS A renamed")
  })

  it("5. design versions inherit project ownership", async () => {
    const { error: insErr } = await c1
      .from("design_versions")
      .insert({ id: dvA, project_id: projA, source: "generated", version_no: 1 })
    expect(insErr).toBeNull()

    const { data: mine } = await c1.from("design_versions").select("id").eq("id", dvA)
    expect(mine).toEqual([{ id: dvA }])

    const { data: theirs, error } = await c2.from("design_versions").select("id").eq("id", dvA)
    expect(error).toBeNull()
    expect(theirs).toEqual([])
  })

  it("6. server-only tables are unreachable by customers", async () => {
    for (const table of ["jobs", "webhook_events", "rate_limits"]) {
      const result = await c1.from(table).select("*")
      expect(isDeniedOrEmpty(result), `${table} should be denied/empty`).toBe(true)
    }
  })

  it("7. staff-only read tables return nothing to customers", async () => {
    for (const table of ["printers", "assets"]) {
      const result = await c1.from(table).select("*")
      expect(isDeniedOrEmpty(result), `${table} should be denied/empty`).toBe(true)
    }
  })

  it("8. staff can read any customer's project", async () => {
    const { error: insErr } = await c1
      .from("projects")
      .insert({ id: projForOp, user_id: c1Uid, title: "for operator" })
    expect(insErr).toBeNull()

    const { data, error } = await op.from("projects").select("id, title").eq("id", projForOp)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: projForOp, title: "for operator" }])
  })

  it("9. a customer cannot insert an order directly", async () => {
    const { error } = await c1.from("orders").insert({
      id: `ord_rls_${STAMP}`,
      user_id: c1Uid,
      quote_id: `qt_rls_${STAMP}`,
      contact_json: {},
      shipping_address_json: {},
      frozen_dv_id: dvA,
      frozen_config_json: {},
    })
    expect(error).not.toBeNull()
  })
})
