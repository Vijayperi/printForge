import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import { assetStorageContract } from "@/src/adapters/storage/contract.spec-factory"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { server } from "@/tests/msw/server"

assetStorageContract(() => new InMemoryStorage())

describe("InMemoryStorage extras", () => {
  it("signed URL encodes the key and ttl", async () => {
    const storage = new InMemoryStorage()
    const put = await storage.put(new Uint8Array([1]), { keyPrefix: "models/dv", mime: "x" })
    if (!put.ok) throw new Error("put failed")
    const signed = await storage.getSignedUrl(put.value.storageKey, 900)
    expect(signed.ok && signed.value).toBe(`memory://${put.value.storageKey}?ttl=900`)
  })

  it("maps a network failure to provider_error", async () => {
    server.use(
      http.get("https://provider.test/boom.glb", () => {
        throw new Error("network down")
      })
    )
    const result = await new InMemoryStorage().ingestFromUrl("https://provider.test/boom.glb", {
      keyPrefix: "models/dv",
      expectedMime: "model/gltf-binary",
      maxBytes: 1000,
    })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("ingests non-GLB mimes without magic sniffing", async () => {
    server.use(
      http.get("https://provider.test/thumb.png", () =>
        HttpResponse.arrayBuffer(new Uint8Array([137, 80, 78, 71]).buffer)
      )
    )
    const result = await new InMemoryStorage().ingestFromUrl("https://provider.test/thumb.png", {
      keyPrefix: "thumbnails/dv",
      expectedMime: "image/png",
      maxBytes: 1000,
    })
    expect(result.ok && result.value.mime).toBe("image/png")
  })
})
