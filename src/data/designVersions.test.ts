import { describe, expect, it } from "vitest"

import {
  attachAssets,
  createDesignVersion,
  getDesignVersion,
  listDesignVersionsByProject,
  nextVersionNo,
  updateGenerationStatus,
} from "@/src/data/designVersions"
import { isId } from "@/src/lib/ids"
import type { StructuredBrief } from "@/src/domain/types"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ design_versions: { rows, unique: ["id"] } })
}

const brief: StructuredBrief = {
  intendedUse: "gift",
  approxSizeMm: 80,
  style: "geometric",
  durability: "everyday",
  rawPrompt: "a small vase",
}

describe("createDesignVersion", () => {
  it("inserts with a generated dv_ id, defaults nullable fields, and defaults status to queued", async () => {
    const result = await createDesignVersion(db(), {
      projectId: "proj_1",
      source: "generated",
      versionNo: 1,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("dv", result.value.id)).toBe(true)
      expect(result.value.project_id).toBe("proj_1")
      expect(result.value.source).toBe("generated")
      expect(result.value.version_no).toBe(1)
      expect(result.value.prompt).toBeNull()
      expect(result.value.brief_json).toBeNull()
      expect(result.value.provider_task_id).toBeNull()
      expect(result.value.generation_status).toBe("queued")
    }
  })

  it("stores prompt, brief, provider task id, and explicit status when provided", async () => {
    const result = await createDesignVersion(db(), {
      projectId: "proj_1",
      source: "uploaded",
      versionNo: 2,
      prompt: "hello",
      briefJson: brief,
      providerTaskId: "task_9",
      generationStatus: "ready",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.prompt).toBe("hello")
      expect(result.value.brief_json).toEqual(brief)
      expect(result.value.provider_task_id).toBe("task_9")
      expect(result.value.generation_status).toBe("ready")
      expect(result.value.source).toBe("uploaded")
    }
  })
})

describe("getDesignVersion", () => {
  it("returns a design version by id", async () => {
    const fake = db([{ id: "dv_1", project_id: "proj_1", source: "generated", version_no: 1, generation_status: "ready" }])
    const result = await getDesignVersion(fake, "dv_1")
    expect(result.ok && result.value?.id).toBe("dv_1")
  })

  it("returns null when not found", async () => {
    const result = await getDesignVersion(db(), "dv_missing")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("listDesignVersionsByProject", () => {
  it("returns the project's versions, newest version_no first", async () => {
    const fake = db([
      { id: "dv_1", project_id: "proj_1", source: "generated", version_no: 1, generation_status: "ready" },
      { id: "dv_2", project_id: "proj_1", source: "generated", version_no: 3, generation_status: "ready" },
      { id: "dv_3", project_id: "proj_1", source: "generated", version_no: 2, generation_status: "ready" },
      { id: "dv_x", project_id: "proj_2", source: "generated", version_no: 9, generation_status: "ready" },
    ])
    const result = await listDesignVersionsByProject(fake, "proj_1")
    expect(result.ok && result.value.map((v) => v.id)).toEqual(["dv_2", "dv_3", "dv_1"])
  })
})

describe("nextVersionNo", () => {
  it("returns 1 for a project with no versions", async () => {
    const result = await nextVersionNo(db(), "proj_empty")
    expect(result.ok && result.value).toBe(1)
  })

  it("returns max(version_no)+1 across the project's versions", async () => {
    const fake = db([
      { id: "dv_1", project_id: "proj_1", source: "generated", version_no: 1, generation_status: "ready" },
      { id: "dv_2", project_id: "proj_1", source: "generated", version_no: 4, generation_status: "ready" },
      { id: "dv_x", project_id: "proj_2", source: "generated", version_no: 99, generation_status: "ready" },
    ])
    const result = await nextVersionNo(fake, "proj_1")
    expect(result.ok && result.value).toBe(5)
  })

  it("propagates a db error", async () => {
    const fake = db()
    fake.failNext({ message: "boom" })
    const result = await nextVersionNo(fake, "proj_1")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("updateGenerationStatus", () => {
  it("updates the generation status", async () => {
    const fake = db([{ id: "dv_1", project_id: "proj_1", source: "generated", version_no: 1, generation_status: "queued" }])
    const result = await updateGenerationStatus(fake, "dv_1", "creating")
    expect(result.ok && result.value.generation_status).toBe("creating")
  })

  it("fails when the version does not exist", async () => {
    const result = await updateGenerationStatus(db(), "dv_missing", "creating")
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})

describe("attachAssets", () => {
  it("attaches all three asset ids", async () => {
    const fake = db([{ id: "dv_1", project_id: "proj_1", source: "generated", version_no: 1, generation_status: "ready" }])
    const result = await attachAssets(fake, "dv_1", {
      glbAssetId: "ast_glb",
      stlAssetId: "ast_stl",
      thumbnailAssetId: "ast_thumb",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.glb_asset_id).toBe("ast_glb")
      expect(result.value.stl_asset_id).toBe("ast_stl")
      expect(result.value.thumbnail_asset_id).toBe("ast_thumb")
    }
  })

  it("attaches only the provided asset id, leaving others untouched", async () => {
    const fake = db([
      {
        id: "dv_1",
        project_id: "proj_1",
        source: "generated",
        version_no: 1,
        generation_status: "creating",
        glb_asset_id: null,
        stl_asset_id: "ast_existing",
        thumbnail_asset_id: null,
      },
    ])
    const result = await attachAssets(fake, "dv_1", { glbAssetId: "ast_glb_only" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.glb_asset_id).toBe("ast_glb_only")
      expect(result.value.stl_asset_id).toBe("ast_existing")
      expect(result.value.thumbnail_asset_id).toBeNull()
    }
  })

  it("attaches the stl and thumbnail ids independently", async () => {
    const fake = db([{ id: "dv_1", project_id: "proj_1", source: "generated", version_no: 1, generation_status: "creating" }])
    const result = await attachAssets(fake, "dv_1", { stlAssetId: "ast_s", thumbnailAssetId: "ast_t" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.stl_asset_id).toBe("ast_s")
      expect(result.value.thumbnail_asset_id).toBe("ast_t")
    }
  })
})
