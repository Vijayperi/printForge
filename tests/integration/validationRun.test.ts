/**
 * validation.run against the LOCAL Supabase stack + real private-bucket storage
 * (plan §6-S9 step 4). Seeds a design version with an uploaded STL in real
 * storage, runs the handler, and asserts a validation report is persisted with
 * findings + measurements and is replaced (not duplicated) on re-run.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1, `supabase start`).
 */
import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { SupabaseStorage, type MinimalStorageClient } from "@/src/adapters/storage/supabase"
import type { Db } from "@/src/data/db"
import { handleValidationRun } from "@/src/jobs/handlers/validation"
import { binaryStl, box } from "@/tests/helpers/geometry"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const ADMIN_UID = "a0000000-0000-4000-8000-000000000001"

describe.skipIf(!RUN)("validation.run against Supabase", () => {
  it("analyzes a stored STL and persists (then replaces) a report", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const client = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
    const db = client as unknown as Db
    const storage = new SupabaseStorage(client as unknown as MinimalStorageClient)

    const projectId = `proj_val_${tag}`
    const dvId = `dv_val_${tag}`
    await client.from("projects").insert({ id: projectId, user_id: ADMIN_UID, title: "Validate" })

    // Store a clean cube STL and attach it to the design version.
    const stored = await storage.put(binaryStl(box([10, 10, 10])), {
      keyPrefix: `models/${dvId}`,
      mime: "model/stl",
    })
    expect(stored.ok).toBe(true)
    if (!stored.ok) return

    const stlAssetId = `ast_val_${tag}`
    await client.from("assets").insert({
      id: stlAssetId,
      type: "model_stl",
      storage_key: stored.value.storageKey,
      checksum_sha256: stored.value.checksumSha256,
      bytes: stored.value.bytes,
      mime: "model/stl",
    })
    await client.from("design_versions").insert({
      id: dvId,
      project_id: projectId,
      source: "uploaded",
      version_no: 1,
      generation_status: "ready",
      stl_asset_id: stlAssetId,
    })

    const first = await handleValidationRun({ db, storage }, { designVersionId: dvId })
    expect(first.ok).toBe(true)

    const reports = await client
      .from("validation_reports")
      .select("id, status, findings_json, measurements_json")
      .eq("design_version_id", dvId)
    expect(reports.data).toHaveLength(1)
    expect(reports.data![0]!.status).toBe("pass")
    expect(reports.data![0]!.findings_json).toEqual([])
    expect(reports.data![0]!.measurements_json.volumeCm3).toBeCloseTo(1, 5)

    // Idempotent re-run replaces the report in place (same natural key).
    const again = await handleValidationRun({ db, storage }, { designVersionId: dvId })
    expect(again.ok).toBe(true)
    const after = await client.from("validation_reports").select("id").eq("design_version_id", dvId)
    expect(after.data).toHaveLength(1)
    expect(after.data![0]!.id).toBe(reports.data![0]!.id)
  })
})
