/**
 * End-to-end generation flow against the LOCAL Supabase stack (plan §6-S5
 * "done when"). A customer enqueues a generation via the transactional
 * enqueue_generation RPC; the mock-provider worker then walks the design
 * version queued → creating → ready and hands off to asset ingestion.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1)
 */
import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { MockGenerationProvider } from "@/src/adapters/generation/mock"
import type { Db } from "@/src/data/db"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { runOnce, type WorkerDeps } from "@/src/jobs/worker"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { MockSlicer } from "@/src/adapters/slicer/mock"
import { MockGlbConverter } from "@/src/adapters/conversion/mock"
import { FixedClock } from "@/src/lib/clock"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const ANON =
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

const brief = {
  rawPrompt: "a friendly dinosaur",
  intendedUse: "gift",
  approxSizeMm: 80,
  style: "cute",
  durability: "display",
}

describe.skipIf(!RUN)("generation flow (Supabase)", () => {
  it("walks a generation queued → creating → ready via the mock worker", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 1. A customer signs in and creates a project.
    const customer = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const signIn = await customer.auth.signInWithPassword({
      email: "customer1@printforge.test",
      password: "printforge-dev-123",
    })
    expect(signIn.error).toBeNull()
    const userId = signIn.data.user?.id as string

    const projectId = `proj_gen_${tag}`
    const insertProject = await customer.from("projects").insert({ id: projectId, user_id: userId, title: "Gen" })
    expect(insertProject.error).toBeNull()

    // The worker below claims the next job of ANY handled type, so jobs left
    // pending by other integration files would be picked up instead of ours and
    // fail against unrelated data. Park everything already queued out of reach
    // first — this test owns the queue for its duration.
    const parking = createClient(URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await parking
      .from("jobs")
      .update({ run_at: new Date(Date.now() + 86_400_000).toISOString() })
      .eq("status", "pending")

    // 2. Enqueue via the transactional RPC (checks auth.uid()).
    const enqueue = await customer.rpc("enqueue_generation", {
      p_project_id: projectId,
      p_prompt: brief.rawPrompt,
      p_brief: brief,
      p_idempotency_key: `gen_${tag}`,
    })
    expect(enqueue.error).toBeNull()
    const dvId = (enqueue.data as Array<{ design_version_id: string }>)[0]!.design_version_id

    // 3. Run the worker with a service-role db, mock provider, and a clock we
    //    advance past the 10s poll delay each iteration. Start ahead of the
    //    DB clock so the submit job (run_at = db now) is claimable.
    const clock = new FixedClock(new Date(Date.now() + 60_000))
    const serviceDb = createClient(URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as Db
    const storage = new InMemoryStorage()
    const deps: WorkerDeps = {
      db: serviceDb,
      queue: new PostgresJobQueue(serviceDb, clock),
      provider: new MockGenerationProvider({ pollsUntilReady: 2 }),
      clock,
      workerId: `test-worker-${tag}`,
      storage,
      converter: new MockGlbConverter(),
      slicer: new MockSlicer(storage),
      appUrl: "http://localhost:3000",
    }

    let status = "queued"
    for (let i = 0; i < 8 && status !== "ready"; i += 1) {
      const outcome = await runOnce(deps)
      expect(outcome.outcome === "completed" || outcome.outcome === "idle").toBe(true)
      clock.advance(11_000)
      const read = await customer.from("design_versions").select("generation_status").eq("id", dvId).single()
      status = read.data?.generation_status as string
    }

    expect(status).toBe("ready")

    // The provider task id was recorded, and asset ingestion was queued for S7.
    const dvRead = await customer.from("design_versions").select("provider_task_id").eq("id", dvId).single()
    expect(dvRead.data?.provider_task_id).toBeTruthy()

    const ingest = await serviceDb
      .from<{ type: string; payload: { designVersionId: string } }>("jobs")
      .select("type, payload")
      .eq("idempotency_key", `ingest:${dvId}`)
      .maybeSingle()
    expect(ingest.data?.type).toBe("asset.ingest")
  })

  it("rejects enqueue_generation for a project the caller does not own", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const admin = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    await admin.auth.signInWithPassword({ email: "admin@printforge.test", password: "printforge-dev-123" })
    const adminId = (await admin.auth.getUser()).data.user?.id as string
    const projectId = `proj_owned_${tag}`
    await admin.from("projects").insert({ id: projectId, user_id: adminId, title: "Admin's" })

    // customer1 tries to enqueue against the admin's project.
    const customer = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    await customer.auth.signInWithPassword({ email: "customer1@printforge.test", password: "printforge-dev-123" })
    const enqueue = await customer.rpc("enqueue_generation", {
      p_project_id: projectId,
      p_prompt: brief.rawPrompt,
      p_brief: brief,
      p_idempotency_key: `gen_bad_${tag}`,
    })
    expect(enqueue.error).not.toBeNull()
  })
})
