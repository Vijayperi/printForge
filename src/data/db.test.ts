import { describe, expect, it } from "vitest"

import {
  insertReturning,
  maybeOneWhere,
  selectPage,
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

describe("selectPage", () => {
  function paged(count: number) {
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `r${String(i).padStart(2, "0")}`,
      user_id: "u1",
      name: `row ${i}`,
      created_at: `2026-01-${String(i + 1).padStart(2, "0")}`,
    }))
    return createFakeDb({ things: { rows, unique: ["id"] } })
  }

  it("returns exactly one page and reports that more exist", async () => {
    const result = await selectPage<TRow>(paged(10), "things", [], {
      orderBy: "created_at",
      page: 0,
      pageSize: 4,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.rows.map((r) => r.id)).toEqual(["r00", "r01", "r02", "r03"])
    expect(result.value.hasMore).toBe(true)
  })

  it("reports no more rows on the last page", async () => {
    const result = await selectPage<TRow>(paged(6), "things", [], {
      orderBy: "created_at",
      page: 1,
      pageSize: 4,
    })
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["r04", "r05"])
    expect(result.ok && result.value.hasMore).toBe(false)
  })

  it("orders descending when asked", async () => {
    const result = await selectPage<TRow>(paged(3), "things", [], {
      orderBy: "created_at",
      ascending: false,
      page: 0,
      pageSize: 3,
    })
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["r02", "r01", "r00"])
  })

  it("applies equality and range restrictions in the database", async () => {
    const result = await selectPage<TRow>(
      paged(10),
      "things",
      [
        ["user_id", "eq", "u1"],
        ["created_at", "lte", "2026-01-03"],
        ["created_at", "gte", "2026-01-02"],
      ],
      { orderBy: "created_at", page: 0, pageSize: 10 }
    )
    expect(result.ok && result.value.rows.map((r) => r.id)).toEqual(["r01", "r02"])
  })

  it("maps errors", async () => {
    const db = paged(3)
    db.failNext({ message: "boom" })
    const result = await selectPage<TRow>(db, "things", [], {
      orderBy: "created_at",
      page: 0,
      pageSize: 2,
    })
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})
