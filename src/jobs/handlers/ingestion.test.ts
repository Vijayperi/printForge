import { describe, expect, it } from "vitest"

import type { GlbConverter } from "@/src/adapters/conversion"
import type { AssetStorage } from "@/src/adapters/storage"
import { handleAssetIngest, type IngestionDeps } from "@/src/jobs/handlers/ingestion"
import type { EnqueueInput, JobQueue } from "@/src/jobs/queue"
import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4])

/** A real GLB with pretty-printed JSON, so the optimizer has something to save. */
function shrinkableGlb(): Uint8Array {
  const json = new TextEncoder().encode(
    JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [0] }] }, null, 4)
  )
  const pad = (4 - (json.byteLength % 4)) % 4
  const out = new Uint8Array(12 + 8 + json.byteLength + pad)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.byteLength, true)
  view.setUint32(12, json.byteLength + pad, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(json, 20)
  out.fill(0x20, 20 + json.byteLength)
  return out
}

function storageStub(over: Partial<AssetStorage> = {}): AssetStorage {
  return {
    ingestFromUrl:
      over.ingestFromUrl ??
      (async () => ok({ storageKey: "models/dv_1/glb", checksumSha256: "aaa", bytes: 8, mime: "model/gltf-binary" })),
    put: over.put ?? (async (_bytes, o) => ok({ storageKey: `${o.keyPrefix}/x`, checksumSha256: "bbb", bytes: 84, mime: o.mime })),
    read: over.read ?? (async () => ok(GLB)),
    getSignedUrl: over.getSignedUrl ?? (async () => ok("signed://x")),
  }
}

function converterStub(over: Partial<GlbConverter> = {}): GlbConverter {
  return {
    toStl: over.toStl ?? (async () => ok(new Uint8Array(84))),
    toThumbnail: over.toThumbnail ?? (async () => ok(new Uint8Array([137, 80, 78, 71]))),
  }
}

function dvRow(over: Record<string, unknown> = {}) {
  return {
    id: "dv_1",
    project_id: "proj_1",
    source: "generated",
    version_no: 1,
    generation_status: "ready",
    glb_asset_id: null,
    stl_asset_id: null,
    thumbnail_asset_id: null,
    ...over,
  }
}

function queueStub(over: Partial<JobQueue> = {}): { queue: JobQueue; enqueued: EnqueueInput[] } {
  const enqueued: EnqueueInput[] = []
  const queue: JobQueue = {
    enqueue:
      over.enqueue ??
      (async (input) => {
        enqueued.push(input)
        return ok({ jobId: "job_1", deduped: false })
      }),
    claimNext: async () => ok(null),
    complete: async () => ok(undefined),
    fail: async () => ok(undefined),
    heartbeat: async () => ok(undefined),
    reapStale: async () => ok(0),
  }
  return { queue, enqueued }
}

function makeDeps(
  rows: Record<string, unknown>[],
  storage = storageStub(),
  converter = converterStub(),
  queue = queueStub().queue
) {
  const db = createFakeDb({
    design_versions: { rows, unique: ["id"] },
    assets: { rows: [], unique: ["id", "storage_key"] },
  })
  const deps: IngestionDeps = { db, storage, converter, appUrl: "http://localhost:3000", queue }
  return { db, deps }
}

const payload = { designVersionId: "dv_1", glbUrl: "/samples/cube.glb", stlUrl: null }

describe("handleAssetIngest", () => {
  it("rejects an invalid payload", async () => {
    const { deps } = makeDeps([])
    const result = await handleAssetIngest(deps, { nope: true })
    expect(!result.ok && result.error.code).toBe("validation")
  })

  it("fails when the design version is missing", async () => {
    const { deps } = makeDeps([])
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("propagates a design-version read error", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failNext({ message: "read boom" })
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("is a no-op when the GLB asset is already attached", async () => {
    const { deps, db } = makeDeps([dvRow({ glb_asset_id: "ast_existing" })])
    const result = await handleAssetIngest(deps, payload)
    expect(result.ok).toBe(true)
    expect(db.rows("assets")).toHaveLength(0)
  })

  it("ingests the GLB, derives STL + thumbnail, and attaches all three", async () => {
    const { deps, db } = makeDeps([dvRow()])
    const result = await handleAssetIngest(deps, payload)
    expect(result.ok).toBe(true)

    const assets = db.rows("assets")
    expect(assets.map((a) => a["type"]).sort()).toEqual(["model_glb", "model_stl", "thumbnail"])
    // No provider URL is ever stored — only storage keys.
    expect(assets.every((a) => !String(a["storage_key"]).includes("samples/cube.glb"))).toBe(true)

    const dv = db.rows("design_versions")[0]!
    expect(dv["glb_asset_id"]).not.toBeNull()
    expect(dv["stl_asset_id"]).not.toBeNull()
    expect(dv["thumbnail_asset_id"]).not.toBeNull()
  })

  it("stores a shrunk copy of the GLB for the viewer to download", async () => {
    const source = shrinkableGlb()
    let stored: Uint8Array | null = null
    const storage = storageStub({
      read: async () => ok(source),
      // Distinct keys per mime: the optimized GLB and the derived STL now share
      // a key prefix, and the assets table treats storage_key as unique.
      put: async (bytes, o) => {
        if (o.mime === "model/gltf-binary") stored = bytes
        return ok({
          storageKey: `${o.keyPrefix}/${o.mime.replace("/", "-")}`,
          checksumSha256: `c-${o.mime}`,
          bytes: bytes.byteLength,
          mime: o.mime,
        })
      },
    })
    const { deps, db } = makeDeps([dvRow()], storage)

    expect((await handleAssetIngest(deps, payload)).ok).toBe(true)
    expect(stored).not.toBeNull()
    expect((stored as unknown as Uint8Array).byteLength).toBeLessThan(source.byteLength)

    // Exactly one GLB asset row, and it is the optimized one.
    const glbAssets = db.rows("assets").filter((a) => a["type"] === "model_glb")
    expect(glbAssets).toHaveLength(1)
    expect(glbAssets[0]?.["bytes"]).toBe((stored as unknown as Uint8Array).byteLength)
  })

  it("keeps a GLB it cannot parse exactly as it arrived", async () => {
    const { deps, db } = makeDeps([dvRow()])
    expect((await handleAssetIngest(deps, payload)).ok).toBe(true)

    // GLB is 8 bytes of nonsense; the ingested asset row is kept verbatim.
    const glbAsset = db.rows("assets").find((a) => a["type"] === "model_glb")
    expect(glbAsset?.["storage_key"]).toBe("models/dv_1/glb")
    expect(glbAsset?.["checksum_sha256"]).toBe("aaa")
  })

  it("propagates a failure storing the optimized GLB", async () => {
    const storage = storageStub({
      read: async () => ok(shrinkableGlb()),
      put: async (_bytes, o) =>
        o.mime === "model/gltf-binary"
          ? err(appError("provider_error", "put boom"))
          : ok({ storageKey: `${o.keyPrefix}/${o.mime}`, checksumSha256: "b", bytes: 1, mime: o.mime }),
    })
    const { deps } = makeDeps([dvRow()], storage)
    expect((await handleAssetIngest(deps, payload)).ok).toBe(false)
  })

  it("resolves a relative glbUrl against APP_URL for real ingestion", async () => {
    let ingestedUrl = ""
    const storage = storageStub({
      ingestFromUrl: async (url) => {
        ingestedUrl = url
        return ok({ storageKey: "models/dv_1/glb", checksumSha256: "a", bytes: 8, mime: "model/gltf-binary" })
      },
    })
    const { deps } = makeDeps([dvRow()], storage)
    await handleAssetIngest(deps, payload)
    expect(ingestedUrl).toBe("http://localhost:3000/samples/cube.glb")
  })

  it("passes an absolute glbUrl through unchanged", async () => {
    let ingestedUrl = ""
    const storage = storageStub({
      ingestFromUrl: async (url) => {
        ingestedUrl = url
        return ok({ storageKey: "models/dv_1/glb", checksumSha256: "a", bytes: 8, mime: "model/gltf-binary" })
      },
    })
    const { deps } = makeDeps([dvRow()], storage)
    await handleAssetIngest(deps, { ...payload, glbUrl: "https://cdn.test/model.glb" })
    expect(ingestedUrl).toBe("https://cdn.test/model.glb")
  })

  it("propagates a GLB ingest failure", async () => {
    const storage = storageStub({ ingestFromUrl: async () => err(appError("provider_error", "fetch failed")) })
    const { deps } = makeDeps([dvRow()], storage)
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates a GLB asset insert failure", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failCall(2, { message: "insert boom" }) // op1 select, op2 glb insert
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates a storage read failure", async () => {
    const storage = storageStub({ read: async () => err(appError("not_found", "gone")) })
    const { deps } = makeDeps([dvRow()], storage)
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("propagates an STL conversion failure", async () => {
    const converter = converterStub({ toStl: async () => err(appError("internal", "stl failed")) })
    const { deps } = makeDeps([dvRow()], storageStub(), converter)
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("internal")
  })

  it("propagates a derived-asset storage put failure", async () => {
    const storage = storageStub({ put: async () => err(appError("provider_error", "put failed")) })
    const { deps } = makeDeps([dvRow()], storage)
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates an STL asset insert failure", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failCall(3, { message: "stl insert boom" }) // op3 = stl insert
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates a thumbnail conversion failure", async () => {
    const converter = converterStub({ toThumbnail: async () => err(appError("internal", "thumb failed")) })
    const { deps } = makeDeps([dvRow()], storageStub(), converter)
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("internal")
  })

  it("propagates a thumbnail asset insert failure", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failCall(4, { message: "thumb insert boom" }) // op4 = thumbnail insert
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("propagates an attach failure", async () => {
    const { deps, db } = makeDeps([dvRow()])
    db.failCall(5, { message: "attach boom" }) // op5 = attachAssets update
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("enqueues validation.run for the newly-ingested design version", async () => {
    const { queue, enqueued } = queueStub()
    const { deps } = makeDeps([dvRow()], storageStub(), converterStub(), queue)
    const result = await handleAssetIngest(deps, payload)
    expect(result.ok).toBe(true)
    expect(enqueued).toEqual([
      { type: "validation.run", payload: { designVersionId: "dv_1" }, idempotencyKey: "validate:dv_1" },
    ])
  })

  it("does not enqueue validation when the GLB is already ingested", async () => {
    const { queue, enqueued } = queueStub()
    const { deps } = makeDeps([dvRow({ glb_asset_id: "ast_existing" })], storageStub(), converterStub(), queue)
    await handleAssetIngest(deps, payload)
    expect(enqueued).toHaveLength(0)
  })

  it("propagates a validation.run enqueue failure", async () => {
    const { queue } = queueStub({ enqueue: async () => err(appError("internal", "enqueue boom")) })
    const { deps } = makeDeps([dvRow()], storageStub(), converterStub(), queue)
    const result = await handleAssetIngest(deps, payload)
    expect(!result.ok && result.error.code).toBe("internal")
  })
})

describe("FakeDb import guard", () => {
  it("constructs", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
  })
})
