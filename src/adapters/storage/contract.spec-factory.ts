import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import type { AssetStorage } from "@/src/adapters/storage"
import { server } from "@/tests/msw/server"

const GLB_MAGIC = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4])

/**
 * Shared contract every AssetStorage implementation must satisfy. `ingestFromUrl`
 * is exercised through MSW so both mock and real impls use the same fake source.
 */
export function assetStorageContract(makeStorage: () => AssetStorage): void {
  describe("AssetStorage contract", () => {
    it("stores bytes and reads them back", async () => {
      const storage = makeStorage()
      const put = await storage.put(new Uint8Array([1, 2, 3]), { keyPrefix: "models/x", mime: "model/stl" })
      expect(put.ok).toBe(true)
      if (!put.ok) return
      const read = await storage.read(put.value.storageKey)
      expect(read.ok && [...read.value]).toEqual([1, 2, 3])
    })

    it("produces a stable checksum for identical bytes", async () => {
      const storage = makeStorage()
      const a = await storage.put(new Uint8Array([9, 9, 9]), { keyPrefix: "t", mime: "x" })
      const b = await storage.put(new Uint8Array([9, 9, 9]), { keyPrefix: "t", mime: "x" })
      expect(a.ok && b.ok && a.value.checksumSha256).toBe(b.ok ? b.value.checksumSha256 : "")
      // Distinct locations though.
      expect(a.ok && b.ok && a.value.storageKey !== b.value.storageKey).toBe(true)
    })

    it("issues a signed URL for a stored object", async () => {
      const storage = makeStorage()
      const put = await storage.put(new Uint8Array([1]), { keyPrefix: "t", mime: "x" })
      if (!put.ok) throw new Error("put failed")
      const signed = await storage.getSignedUrl(put.value.storageKey, 600)
      expect(signed.ok && signed.value.length).toBeGreaterThan(0)
    })

    it("fails to sign or read a missing object", async () => {
      const storage = makeStorage()
      expect((await storage.getSignedUrl("nope/missing", 60)).ok).toBe(false)
      expect((await storage.read("nope/missing")).ok).toBe(false)
    })

    it("ingests a GLB from a URL", async () => {
      server.use(
        http.get("https://provider.test/model.glb", () =>
          HttpResponse.arrayBuffer(GLB_MAGIC.buffer, { headers: { "content-type": "model/gltf-binary" } })
        )
      )
      const storage = makeStorage()
      const result = await storage.ingestFromUrl("https://provider.test/model.glb", {
        keyPrefix: "models/dv",
        expectedMime: "model/gltf-binary",
        maxBytes: 1000,
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        const read = await storage.read(result.value.storageKey)
        expect(read.ok).toBe(true)
      }
    })

    it("rejects a non-GLB payload", async () => {
      server.use(
        http.get("https://provider.test/bad.glb", () =>
          HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer)
        )
      )
      const result = await makeStorage().ingestFromUrl("https://provider.test/bad.glb", {
        keyPrefix: "models/dv",
        expectedMime: "model/gltf-binary",
        maxBytes: 1000,
      })
      expect(!result.ok && result.error.code).toBe("validation")
    })

    it("rejects an oversized payload", async () => {
      server.use(
        http.get("https://provider.test/big.glb", () =>
          HttpResponse.arrayBuffer(GLB_MAGIC.buffer, { headers: { "content-type": "model/gltf-binary" } })
        )
      )
      const result = await makeStorage().ingestFromUrl("https://provider.test/big.glb", {
        keyPrefix: "models/dv",
        expectedMime: "model/gltf-binary",
        maxBytes: 4,
      })
      expect(!result.ok && result.error.code).toBe("validation")
    })

    it("fails when the source URL errors", async () => {
      server.use(http.get("https://provider.test/500.glb", () => new HttpResponse(null, { status: 500 })))
      const result = await makeStorage().ingestFromUrl("https://provider.test/500.glb", {
        keyPrefix: "models/dv",
        expectedMime: "model/gltf-binary",
        maxBytes: 1000,
      })
      expect(!result.ok && result.error.code).toBe("provider_error")
    })
  })
}
