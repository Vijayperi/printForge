import { describe, expect, it } from "vitest"

import { getAsset, getAssetByStorageKey, insertAsset } from "@/src/data/assets"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ assets: { rows, unique: ["id"] } })
}

describe("insertAsset", () => {
  it("inserts an asset with a generated ast_ id and maps all columns", async () => {
    const fake = db()
    const result = await insertAsset(fake, {
      type: "model_glb",
      storageKey: "models/abc.glb",
      checksumSha256: "deadbeef",
      bytes: 1024,
      mime: "model/gltf-binary",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("ast", result.value.id)).toBe(true)
      expect(result.value.type).toBe("model_glb")
      expect(result.value.storage_key).toBe("models/abc.glb")
      expect(result.value.checksum_sha256).toBe("deadbeef")
      expect(result.value.bytes).toBe(1024)
      expect(result.value.mime).toBe("model/gltf-binary")
      expect(result.value.source_asset_id).toBeNull()
    }
  })

  it("records a source asset id when a derived asset is inserted", async () => {
    const fake = db()
    const result = await insertAsset(fake, {
      type: "model_stl",
      storageKey: "models/abc.stl",
      checksumSha256: "cafe",
      bytes: 512,
      mime: "model/stl",
      sourceAssetId: "ast_source",
    })
    expect(result.ok && result.value.source_asset_id).toBe("ast_source")
  })
})

describe("getAsset", () => {
  it("returns an asset by id", async () => {
    const fake = db([
      { id: "ast_1", type: "thumbnail", storage_key: "t.png", checksum_sha256: "x", bytes: 1, mime: "image/png", source_asset_id: null },
    ])
    const result = await getAsset(fake, "ast_1")
    expect(result.ok && result.value?.id).toBe("ast_1")
  })

  it("returns null for an unknown id", async () => {
    const result = await getAsset(db(), "ast_missing")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("getAssetByStorageKey", () => {
  it("returns an asset by its storage key", async () => {
    const fake = db([
      { id: "ast_1", type: "gcode", storage_key: "gcode/a.gcode", checksum_sha256: "x", bytes: 9, mime: "text/plain", source_asset_id: null },
    ])
    const result = await getAssetByStorageKey(fake, "gcode/a.gcode")
    expect(result.ok && result.value?.id).toBe("ast_1")
  })

  it("returns null when no asset has that key", async () => {
    const result = await getAssetByStorageKey(db(), "nope")
    expect(result.ok && result.value).toBeNull()
  })
})
