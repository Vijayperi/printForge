import { describe, expect, it } from "vitest"

import {
  insertReturning,
  maybeOneWhere,
  selectWhere,
  updateReturning,
  type Db,
} from "@/src/data/db"
import { createFakeDb } from "@/tests/helpers/fakeDb"

interface TRow {
  id: string
  user_id: string
  name: string
  created_at: string
}

function seededDb() {
  const db = createFakeDb({ things: { rows: [], unique: ["id"] } })
  return db
}

describe("insertReturning", () => {
  it("inserts and returns the row", async () => {
    const db = seededDb()
    const result = await insertReturning<TRow>(db, "things", {
      id: "t1",
      user_id: "u1",
      name: "A",
      created_at: "2026-01-01",
    })
    expect(result.ok && result.value.name).toBe("A")
    expect(db.rows("things")).toHaveLength(1)
  })

  it("maps a unique violation to a conflict error", async () => {
    const db = seededDb()
    const row: TRow = { id: "t1", user_id: "u1", name: "A", created_at: "2026-01-01" }
    await insertReturning<TRow>(db, "things", row)
    const again = await insertReturning<TRow>(db, "things", row)
    expect(!again.ok && again.error.code).toBe("conflict")
  })

  it("maps a generic db error to provider_error", async () => {
    const db = seededDb()
    db.failNext({ message: "connection reset" })
    const result = await insertReturning<TRow>(db, "things", {
      id: "t2",
      user_id: "u1",
      name: "B",
      created_at: "2026-01-01",
    })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("errors when insert returns no row", async () => {
    const stub: Db = {
      from: () =>
        ({
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
        }) as never,
      rpc: <T,>() => Promise.resolve({ data: null as T, error: null }),
    }
    const result = await insertReturning<TRow>(stub, "things", {} as TRow)
    expect(!result.ok && result.error.code).toBe("internal")
  })
})

describe("selectWhere", () => {
  it("returns matching rows ordered descending", async () => {
    const db = createFakeDb({
      things: {
        rows: [
          { id: "a", user_id: "u1", name: "first", created_at: "2026-01-01" },
          { id: "b", user_id: "u1", name: "second", created_at: "2026-01-02" },
          { id: "c", user_id: "u2", name: "other", created_at: "2026-01-03" },
        ],
      },
    })
    const result = await selectWhere<TRow>(db, "things", [["user_id", "u1"]], {
      orderBy: "created_at",
      ascending: false,
    })
    expect(result.ok && result.value.map((r) => r.id)).toEqual(["b", "a"])
  })

  it("defaults ordering to ascending when unspecified", async () => {
    const db = createFakeDb({
      things: {
        rows: [
          { id: "b", user_id: "u1", name: "2", created_at: "2026-01-02" },
          { id: "a", user_id: "u1", name: "1", created_at: "2026-01-01" },
        ],
      },
    })
    const result = await selectWhere<TRow>(db, "things", [["user_id", "u1"]], { orderBy: "created_at" })
    expect(result.ok && result.value.map((r) => r.id)).toEqual(["a", "b"])
  })

  it("returns rows unordered when no orderBy is given", async () => {
    const db = createFakeDb({ things: { rows: [{ id: "a", user_id: "u1", name: "x", created_at: "1" }] } })
    const result = await selectWhere<TRow>(db, "things", [["user_id", "u1"]])
    expect(result.ok && result.value).toHaveLength(1)
  })

  it("maps errors", async () => {
    const db = seededDb()
    db.failNext({ message: "boom" })
    const result = await selectWhere<TRow>(db, "things", [["user_id", "u1"]])
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("maybeOneWhere", () => {
  it("returns the single match", async () => {
    const db = createFakeDb({
      things: { rows: [{ id: "a", user_id: "u1", name: "x", created_at: "1" }] },
    })
    const result = await maybeOneWhere<TRow>(db, "things", [
      ["id", "a"],
      ["user_id", "u1"],
    ])
    expect(result.ok && result.value?.id).toBe("a")
  })

  it("returns null when nothing matches", async () => {
    const db = seededDb()
    const result = await maybeOneWhere<TRow>(db, "things", [["id", "missing"]])
    expect(result.ok && result.value).toBeNull()
  })

  it("maps errors", async () => {
    const db = seededDb()
    db.failNext({ message: "boom" })
    const result = await maybeOneWhere<TRow>(db, "things", [["id", "a"]])
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("updateReturning", () => {
  it("updates and returns the row", async () => {
    const db = createFakeDb({
      things: { rows: [{ id: "a", user_id: "u1", name: "old", created_at: "1" }] },
    })
    const result = await updateReturning<TRow>(db, "things", { name: "new" }, [
      ["id", "a"],
      ["user_id", "u1"],
    ])
    expect(result.ok && result.value.name).toBe("new")
    expect(db.rows("things")[0]?.["name"]).toBe("new")
  })

  it("returns not_found when no row matches", async () => {
    const db = seededDb()
    const result = await updateReturning<TRow>(db, "things", { name: "x" }, [["id", "missing"]])
    expect(!result.ok && result.error.code).toBe("not_found")
  })

  it("maps errors", async () => {
    const db = seededDb()
    db.failNext({ message: "boom" })
    const result = await updateReturning<TRow>(db, "things", { name: "x" }, [["id", "a"]])
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})
