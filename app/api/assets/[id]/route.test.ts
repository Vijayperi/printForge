import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: vi.fn(async () => db),
  getServiceDb: vi.fn(() => db),
}))

const getSignedUrl = vi.fn()
vi.mock("@/src/adapters/storage/factory", () => ({ getAssetStorage: vi.fn(() => ({ getSignedUrl })) }))

import { cacheControlFor, GET } from "@/app/api/assets/[id]/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }
const ctx = { params: Promise.resolve({ id: "ast_1" }) }
const req = new Request("http://test/api/assets/ast_1")

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  getSignedUrl.mockResolvedValue(ok("https://storage.test/signed-url"))
  db = createFakeDb({
    design_versions: { rows: [{ id: "dv_1", project_id: "proj_1", glb_asset_id: "ast_1" }] },
    assets: { rows: [{ id: "ast_1", type: "model_glb", storage_key: "models/dv_1/ast_1", mime: "model/gltf-binary" }] },
  })
})

afterEach(() => vi.clearAllMocks())

describe("GET asset", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await GET(req, ctx)).status).toBe(401)
  })

  it("404 when the caller does not own a design version referencing the asset", async () => {
    db = createFakeDb({ design_versions: { rows: [] } })
    expect((await GET(req, ctx)).status).toBe(404)
  })

  it("502 when the ownership lookup errors", async () => {
    db.failNext({ message: "db down" })
    expect((await GET(req, ctx)).status).toBe(502)
  })

  it("404 when the asset row is missing", async () => {
    db = createFakeDb({
      design_versions: { rows: [{ id: "dv_1", project_id: "proj_1", glb_asset_id: "ast_1" }] },
      assets: { rows: [] },
    })
    expect((await GET(req, ctx)).status).toBe(404)
  })

  it("502 when the asset lookup errors", async () => {
    db.failCall(2, { message: "asset boom" }) // op1 ownership query, op2 asset lookup
    expect((await GET(req, ctx)).status).toBe(502)
  })

  it("maps a signing failure to its status", async () => {
    const { err } = await import("@/src/lib/result")
    const { appError } = await import("@/src/lib/errors")
    getSignedUrl.mockResolvedValue(err(appError("not_found", "gone")))
    expect((await GET(req, ctx)).status).toBe(404)
  })

  it("redirects to a signed URL for an owned asset", async () => {
    const res = await GET(req, ctx)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("https://storage.test/signed-url")
    expect(getSignedUrl).toHaveBeenCalledWith("models/dv_1/ast_1", 600)
  })

  it("lets a browser reuse a thumbnail redirect, but not a model one", async () => {
    expect((await GET(req, ctx)).headers.get("cache-control")).toBe("private, no-store")

    db = createFakeDb({
      design_versions: { rows: [{ id: "dv_1", project_id: "proj_1", thumbnail_asset_id: "ast_1" }] },
      assets: { rows: [{ id: "ast_1", type: "thumbnail", storage_key: "thumbnails/dv_1/ast_1" }] },
    })
    expect((await GET(req, ctx)).headers.get("cache-control")).toBe(
      "private, max-age=540, immutable"
    )
  })
})

describe("cacheControlFor", () => {
  it("never lets a cached redirect outlive the signed URL it points at", () => {
    const maxAge = Number(/max-age=(\d+)/.exec(cacheControlFor("thumbnail"))?.[1] ?? "0")
    expect(maxAge).toBeGreaterThan(0)
    expect(maxAge).toBeLessThan(600)
  })

  it.each(["model_glb", "model_stl", "gcode", "reference_image"])(
    "refuses to cache a %s redirect",
    (assetType) => {
      expect(cacheControlFor(assetType)).toBe("private, no-store")
    }
  )
})

describe("FakeDb import guard", () => {
  it("constructs", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
  })
})
