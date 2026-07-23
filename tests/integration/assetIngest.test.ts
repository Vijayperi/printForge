/**
 * asset.ingest against the LOCAL Supabase stack + real private-bucket storage
 * (plan §6-S7 "done when": ingestion works, is idempotent, and only storage
 * keys are persisted). The provider GLB is served from a throwaway local HTTP
 * server so ingestFromUrl has a real source to fetch.
 *
 * Run with: npm run test:integration  (SUPABASE_INTEGRATION=1)
 */
import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { createClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { MockGlbConverter } from "@/src/adapters/conversion/mock"
import { SupabaseStorage, type MinimalStorageClient } from "@/src/adapters/storage/supabase"
import type { Db } from "@/src/data/db"
import { handleAssetIngest } from "@/src/jobs/handlers/ingestion"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"

const RUN = process.env["SUPABASE_INTEGRATION"] === "1"
const URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? "http://127.0.0.1:54321"
const SERVICE =
  process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const ADMIN_UID = "a0000000-0000-4000-8000-000000000001"

describe.skipIf(!RUN)("asset.ingest against Supabase storage", () => {
  let server: Server
  let appUrl: string

  beforeAll(async () => {
    const glb = readFileSync("public/samples/cube.glb")
    server = createServer((_req, res) => {
      res.setHeader("content-type", "model/gltf-binary")
      res.end(glb)
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
  })

  it("copies the GLB into private storage, derives assets, and is idempotent", async () => {
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const client = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
    const db = client as unknown as Db
    const storage = new SupabaseStorage(client as unknown as MinimalStorageClient)

    const projectId = `proj_ing_${tag}`
    const dvId = `dv_ing_${tag}`
    await client.from("projects").insert({ id: projectId, user_id: ADMIN_UID, title: "Ingest" })
    await client.from("design_versions").insert({
      id: dvId,
      project_id: projectId,
      source: "generated",
      version_no: 1,
      generation_status: "ready",
      glb_asset_id: null,
    })

    const deps = {
      db,
      storage,
      converter: new MockGlbConverter(),
      appUrl,
      queue: new PostgresJobQueue(db, new SystemClock()),
    }
    const result = await handleAssetIngest(deps, { designVersionId: dvId, glbUrl: "/cube.glb" })
    expect(result.ok).toBe(true)

    // The design version now references three private assets.
    const dv = await client
      .from("design_versions")
      .select("glb_asset_id, stl_asset_id, thumbnail_asset_id")
      .eq("id", dvId)
      .single()
    expect(dv.data?.glb_asset_id).toBeTruthy()
    expect(dv.data?.stl_asset_id).toBeTruthy()
    expect(dv.data?.thumbnail_asset_id).toBeTruthy()

    // The GLB asset holds a storage key (never the provider URL) and is signable.
    const glbAsset = await client.from("assets").select("storage_key, type").eq("id", dv.data!.glb_asset_id).single()
    expect(glbAsset.data?.type).toBe("model_glb")
    expect(String(glbAsset.data?.storage_key).startsWith("models/")).toBe(true)
    const signed = await storage.getSignedUrl(glbAsset.data!.storage_key as string, 600)
    expect(signed.ok).toBe(true)

    // Idempotent: a second run attaches nothing new.
    const again = await handleAssetIngest(deps, { designVersionId: dvId, glbUrl: "/cube.glb" })
    expect(again.ok).toBe(true)
    const assets = await client.from("assets").select("id").eq("id", dv.data!.glb_asset_id)
    expect(assets.data).toHaveLength(1)
  })
})
