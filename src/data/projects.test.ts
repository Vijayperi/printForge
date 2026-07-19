import { describe, expect, it } from "vitest"

import {
  createProject,
  getProjectOwned,
  listProjectsByUser,
  renameProject,
  setProjectStatus,
} from "@/src/data/projects"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ projects: { rows, unique: ["id"] } })
}

describe("createProject", () => {
  it("inserts a project with a generated proj_ id and active status", async () => {
    const fake = db()
    const result = await createProject(fake, { userId: "u1", title: "My thing" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("proj", result.value.id)).toBe(true)
      expect(result.value.user_id).toBe("u1")
      expect(result.value.title).toBe("My thing")
      expect(result.value.status).toBe("active")
    }
  })
})

describe("listProjectsByUser", () => {
  it("returns only the user's projects, newest first", async () => {
    const fake = db([
      { id: "proj_1", user_id: "u1", title: "old", status: "active", created_at: "2026-01-01" },
      { id: "proj_2", user_id: "u1", title: "new", status: "active", created_at: "2026-01-05" },
      { id: "proj_3", user_id: "u2", title: "other", status: "active", created_at: "2026-01-09" },
    ])
    const result = await listProjectsByUser(fake, "u1")
    expect(result.ok && result.value.map((p) => p.id)).toEqual(["proj_2", "proj_1"])
  })
})

describe("getProjectOwned", () => {
  it("returns the project when owned", async () => {
    const fake = db([{ id: "proj_1", user_id: "u1", title: "t", status: "active", created_at: "1" }])
    const result = await getProjectOwned(fake, "u1", "proj_1")
    expect(result.ok && result.value?.id).toBe("proj_1")
  })

  it("returns null when the project belongs to another user", async () => {
    const fake = db([{ id: "proj_1", user_id: "u2", title: "t", status: "active", created_at: "1" }])
    const result = await getProjectOwned(fake, "u1", "proj_1")
    expect(result.ok && result.value).toBeNull()
  })
})

describe("renameProject", () => {
  it("renames an owned project", async () => {
    const fake = db([{ id: "proj_1", user_id: "u1", title: "old", status: "active", created_at: "1" }])
    const result = await renameProject(fake, "u1", "proj_1", "renamed")
    expect(result.ok && result.value.title).toBe("renamed")
  })

  it("fails for a project the user does not own", async () => {
    const fake = db([{ id: "proj_1", user_id: "u2", title: "old", status: "active", created_at: "1" }])
    const result = await renameProject(fake, "u1", "proj_1", "hijack")
    expect(!result.ok && result.error.code).toBe("not_found")
  })
})

describe("setProjectStatus", () => {
  it("archives an owned project", async () => {
    const fake = db([{ id: "proj_1", user_id: "u1", title: "t", status: "active", created_at: "1" }])
    const result = await setProjectStatus(fake, "u1", "proj_1", "archived")
    expect(result.ok && result.value.status).toBe("archived")
  })
})
