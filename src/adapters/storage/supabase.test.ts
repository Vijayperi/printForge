import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"

import { assetStorageContract } from "@/src/adapters/storage/contract.spec-factory"
import {
  bucketOf,
  pathOf,
  SupabaseStorage,
  type MinimalStorageClient,
} from "@/src/adapters/storage/supabase"
import { server } from "@/tests/msw/server"

const GLB_MAGIC = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4])

type BucketApi = ReturnType<MinimalStorageClient["storage"]["from"]>

/** In-memory fake of the narrow Supabase Storage client. */
function fakeClient(
  overrides: Partial<{
    upload: BucketApi["upload"]
    createSignedUrl: BucketApi["createSignedUrl"]
    download: BucketApi["download"]
  }> = {}
): MinimalStorageClient {
  const buckets = new Map<string, Map<string, Uint8Array>>()
  const store = (bucket: string): Map<string, Uint8Array> => {
    const existing = buckets.get(bucket)
    if (existing !== undefined) return existing
    const created = new Map<string, Uint8Array>()
    buckets.set(bucket, created)
    return created
  }
  return {
    storage: {
      from(bucket: string) {
        const objects = store(bucket)
        return {
          upload:
            overrides.upload ??
            (async (path, body) => {
              objects.set(path, new Uint8Array(body))
              return { data: { path }, error: null }
            }),
          createSignedUrl:
            overrides.createSignedUrl ??
            (async (path, expiresIn) => {
              if (!objects.has(path)) return { data: null, error: { message: "not found" } }
              return { data: { signedUrl: `https://signed.test/${bucket}/${path}?ttl=${expiresIn}` }, error: null }
            }),
          download:
            overrides.download ??
            (async (path) => {
              const bytes = objects.get(path)
              if (bytes === undefined) return { data: null, error: { message: "not found" } }
              return { data: new Blob([bytes as BlobPart]), error: null }
            }),
        }
      },
    },
  }
}

assetStorageContract(() => new SupabaseStorage(fakeClient()))

describe("storage key helpers", () => {
  it("splits bucket and path", () => {
    expect(bucketOf("models/dv_1/ast_x")).toBe("models")
    expect(pathOf("models/dv_1/ast_x")).toBe("dv_1/ast_x")
  })

  it("handles a bucket-only key", () => {
    expect(bucketOf("models")).toBe("models")
    expect(pathOf("models")).toBe("")
  })
})

describe("SupabaseStorage error branches", () => {
  it("uploads a bucket-only keyPrefix (no sub-path)", async () => {
    const storage = new SupabaseStorage(fakeClient())
    const put = await storage.put(new Uint8Array([1]), { keyPrefix: "models", mime: "x" })
    expect(put.ok && put.value.storageKey.startsWith("models/")).toBe(true)
  })

  it("maps an upload error to provider_error", async () => {
    const storage = new SupabaseStorage(
      fakeClient({ upload: async () => ({ data: null, error: { message: "quota exceeded" } }) })
    )
    const result = await storage.put(new Uint8Array([1]), { keyPrefix: "models/dv", mime: "x" })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("treats a null signed-url payload as not_found", async () => {
    const storage = new SupabaseStorage(
      fakeClient({ createSignedUrl: async () => ({ data: null, error: null }) })
    )
    expect((await storage.getSignedUrl("models/x", 60)).ok).toBe(false)
  })

  it("treats a null download payload as not_found", async () => {
    const storage = new SupabaseStorage(fakeClient({ download: async () => ({ data: null, error: null }) }))
    expect((await storage.read("models/x")).ok).toBe(false)
  })

  it("maps a network failure to provider_error", async () => {
    server.use(http.get("https://provider.test/boom.glb", () => HttpResponse.error()))
    const result = await new SupabaseStorage(fakeClient()).ingestFromUrl("https://provider.test/boom.glb", {
      keyPrefix: "models/dv",
      expectedMime: "model/gltf-binary",
      maxBytes: 1000,
    })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("ingests a non-GLB mime without magic sniffing", async () => {
    server.use(
      http.get("https://provider.test/thumb.png", () =>
        HttpResponse.arrayBuffer(new Uint8Array([137, 80, 78, 71]).buffer)
      )
    )
    const result = await new SupabaseStorage(fakeClient()).ingestFromUrl("https://provider.test/thumb.png", {
      keyPrefix: "thumbnails/dv",
      expectedMime: "image/png",
      maxBytes: 1000,
    })
    expect(result.ok && result.value.mime).toBe("image/png")
    void GLB_MAGIC
  })
})
