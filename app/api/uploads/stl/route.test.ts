/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"
import { createFakeDb, FakeDb } from "@/tests/helpers/fakeDb"

const getUser = vi.fn()
vi.mock("@/src/adapters/auth/factory", () => ({ getAuthGateway: vi.fn(async () => ({ getUser })) }))

let db: FakeDb
vi.mock("@/src/data/supabaseClients", () => ({
  getRequestDb: vi.fn(async () => db),
  getServiceDb: vi.fn(() => db),
}))

const put = vi.fn()
vi.mock("@/src/adapters/storage/factory", () => ({ getAssetStorage: vi.fn(() => ({ put })) }))

const scan = vi.fn()
vi.mock("@/src/adapters/scanner/factory", () => ({ getUploadScanner: vi.fn(() => ({ scan })) }))

const toThumbnail = vi.fn()
vi.mock("@/src/adapters/conversion/factory", () => ({ getGlbConverter: vi.fn(() => ({ toThumbnail })) }))

const convert = vi.fn()
vi.mock("@/src/adapters/conversion/stlToGlb", () => ({ convertStlToGlb: (...a: unknown[]) => convert(...a) }))

import { POST, validateUploadFile } from "@/app/api/uploads/stl/route"

const USER = { userId: "u1", email: "a@b.com", name: "A", role: "customer" as const }

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0]
function validStl(): Uint8Array {
  const bytes = new Uint8Array(84 + 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, 1, true)
  for (let v = 0; v < 9; v += 1) view.setFloat32(84 + 12 + v * 4, TRI[v] as number, true)
  return bytes
}

function upload(bytes: Uint8Array, name = "model.stl", projectId: string | null = "proj_1"): Request {
  const form = new FormData()
  form.set("file", new File([bytes as unknown as BlobPart], name, { type: "model/stl" }))
  if (projectId !== null) form.set("projectId", projectId)
  return new Request("http://test/api/uploads/stl", { method: "POST", body: form })
}

beforeEach(() => {
  getUser.mockResolvedValue(ok(USER))
  scan.mockResolvedValue(ok({ clean: true }))
  convert.mockResolvedValue(ok(new Uint8Array([0x67, 0x6c, 0x54, 0x46])))
  toThumbnail.mockResolvedValue(ok(new Uint8Array([137, 80, 78, 71])))
  let n = 0
  put.mockImplementation(async (_bytes: Uint8Array, o: { keyPrefix: string; mime: string }) => {
    n += 1
    return ok({ storageKey: `${o.keyPrefix}/ast_${n}`, checksumSha256: `c${n}`, bytes: 4, mime: o.mime })
  })
  db = createFakeDb({
    projects: { rows: [{ id: "proj_1", user_id: "u1", title: "T", status: "active" }] },
    design_versions: { rows: [], unique: ["id"] },
    assets: { rows: [], unique: ["id", "storage_key"] },
    jobs: { rows: [], unique: ["id", "idempotency_key"] },
  })
})

afterEach(() => vi.clearAllMocks())

describe("validateUploadFile", () => {
  it("accepts a .stl within the size limit", () => {
    expect(validateUploadFile({ name: "Model.STL", size: 100 }).ok).toBe(true)
  })
  it("rejects a non-stl extension", () => {
    const r = validateUploadFile({ name: "model.txt", size: 100 })
    expect(!r.ok && r.error.code).toBe("validation")
  })
  it("rejects an oversized file", () => {
    const r = validateUploadFile({ name: "model.stl", size: 60 * 1024 * 1024 })
    expect(!r.ok && r.error.code).toBe("validation")
  })
})

describe("POST /api/uploads/stl", () => {
  it("401 without a session", async () => {
    getUser.mockResolvedValue(ok(null))
    expect((await POST(upload(validStl()))).status).toBe(401)
  })

  it("400 when the body is not a multipart form", async () => {
    const req = new Request("http://test/api/uploads/stl", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
      headers: { "content-type": "application/json" },
    })
    expect((await POST(req)).status).toBe(400)
  })

  it("400 when file or projectId is missing", async () => {
    expect((await POST(upload(validStl(), "model.stl", null))).status).toBe(400)
  })

  it("400 for a non-stl file", async () => {
    expect((await POST(upload(validStl(), "model.txt"))).status).toBe(400)
  })

  it("400 when the scanner flags a threat", async () => {
    scan.mockResolvedValue(ok({ clean: false, threat: "x" }))
    expect((await POST(upload(validStl()))).status).toBe(400)
  })

  it("502 when the scanner errors", async () => {
    scan.mockResolvedValue(err(appError("provider_error", "scanner down")))
    expect((await POST(upload(validStl()))).status).toBe(502)
  })

  it("400 for an unparseable STL", async () => {
    expect((await POST(upload(new Uint8Array([1, 2, 3])))).status).toBe(400)
  })

  it("404 when the project is not owned", async () => {
    db = createFakeDb({ projects: { rows: [] } })
    expect((await POST(upload(validStl()))).status).toBe(404)
  })

  it("502 when the ownership lookup errors", async () => {
    db.failNext({ message: "db down" })
    expect((await POST(upload(validStl()))).status).toBe(502)
  })

  it("500 when GLB conversion fails", async () => {
    convert.mockResolvedValue(err(appError("internal", "convert boom")))
    expect((await POST(upload(validStl()))).status).toBe(500)
  })

  it("502 when the thumbnail conversion fails", async () => {
    toThumbnail.mockResolvedValue(err(appError("provider_error", "thumb boom")))
    expect((await POST(upload(validStl()))).status).toBe(502)
  })

  it("502 when a storage put fails", async () => {
    put.mockResolvedValue(err(appError("provider_error", "put boom")))
    expect((await POST(upload(validStl()))).status).toBe(502)
  })

  it.each([
    ["version lookup", 2],
    ["design version insert", 3],
    ["stl asset insert", 4],
    ["glb asset insert", 5],
    ["thumbnail asset insert", 6],
    ["attach", 7],
    ["validation enqueue", 8],
  ])("502 when the %s db op fails", async (_label, callIndex) => {
    db.failCall(callIndex, { message: "db op boom" })
    expect((await POST(upload(validStl()))).status).toBe(502)
  })

  it("201 creating an uploaded design version with assets and a validation job", async () => {
    const res = await POST(upload(validStl()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.designVersionId).toMatch(/^dv_/)

    const dv = db.rows("design_versions")[0]!
    expect(dv["source"]).toBe("uploaded")
    expect(dv["prompt"]).toBeNull()
    expect(dv["generation_status"]).toBe("ready")
    expect(dv["glb_asset_id"]).not.toBeNull()

    expect(db.rows("assets").map((a) => a["type"]).sort()).toEqual(["model_glb", "model_stl", "thumbnail"])
    const job = db.rows("jobs")[0]!
    expect(job["type"]).toBe("validation.run")
  })
})

describe("FakeDb import guard", () => {
  it("constructs", () => {
    expect(new FakeDb()).toBeInstanceOf(FakeDb)
  })
})
