import type {
  Db,
  DbError,
  DbResponse,
  FilterBuilder,
  TableBuilder,
} from "@/src/data/db"

type Row = Record<string, unknown>

interface TableState {
  rows: Row[]
  unique: string[]
}

/**
 * In-memory, PostgREST-shaped fake implementing the `Db` interface for
 * repository unit tests (plan §6-S4). Supports the exact chain operations the
 * db.ts helpers use: insert().select().single(), select().eq().order().limit(),
 * select().eq().maybeSingle(), update().eq().select().single(), delete().eq(),
 * and (S14) select().eq/lte/gte().order().range() for the paged ops board.
 *
 * `eq` also understands PostgREST's `column->>key` JSON path, so a view column
 * can be filtered the same way in tests as it is in Postgres.
 */
export type RpcHandler = (args: Record<string, unknown>) => DbResponse<unknown>

export class FakeDb implements Db {
  private tables = new Map<string, TableState>()
  private pendingError: DbError | null = null
  private rpcHandlers = new Map<string, RpcHandler>()

  constructor(config?: Record<string, { rows?: Row[]; unique?: string[] }>) {
    if (config !== undefined) {
      for (const [name, cfg] of Object.entries(config)) {
        this.tables.set(name, {
          rows: (cfg.rows ?? []).map((r) => ({ ...r })),
          unique: cfg.unique ?? ["id"],
        })
      }
    }
  }

  /** Ensure a table exists (default unique key: id). */
  ensure(table: string, unique: string[] = ["id"]): void {
    if (!this.tables.has(table)) this.tables.set(table, { rows: [], unique })
  }

  /** Seed rows directly, bypassing insert semantics. */
  seed(table: string, ...rows: Row[]): void {
    this.ensure(table)
    const state = this.tables.get(table) as TableState
    for (const r of rows) state.rows.push({ ...r })
  }

  /** Snapshot of a table's rows. */
  rows(table: string): Row[] {
    return (this.tables.get(table)?.rows ?? []).map((r) => ({ ...r }))
  }

  private opCount = 0
  private scheduledFailures = new Map<number, DbError>()

  /** Make the next terminal operation resolve with this error, then clear. */
  failNext(error: DbError): void {
    this.pendingError = error
  }

  /**
   * Fail the Nth terminal operation (1-based across all from()/rpc() calls),
   * letting earlier ones succeed. Useful for multi-step flows.
   */
  failCall(callIndex: number, error: DbError): void {
    this.scheduledFailures.set(callIndex, error)
  }

  private takeError(): DbError | null {
    this.opCount += 1
    const scheduled = this.scheduledFailures.get(this.opCount)
    if (scheduled !== undefined) {
      this.scheduledFailures.delete(this.opCount)
      return scheduled
    }
    const e = this.pendingError
    this.pendingError = null
    return e
  }

  from<R = Row>(table: string): TableBuilder<R> {
    this.ensure(table)
    return new FakeBuilder<R>(this.tables.get(table) as TableState, () => this.takeError()) as unknown as TableBuilder<R>
  }

  /** Register a handler for `rpc(name, args)`. */
  onRpc(name: string, handler: RpcHandler): void {
    this.rpcHandlers.set(name, handler)
  }

  rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): PromiseLike<DbResponse<T>> {
    const error = this.takeError()
    if (error !== null) return Promise.resolve({ data: null as T, error })
    const handler = this.rpcHandlers.get(fn)
    if (handler === undefined) {
      return Promise.resolve({ data: null as T, error: { message: `no rpc handler for ${fn}` } })
    }
    return Promise.resolve(handler(args) as DbResponse<T>)
  }
}

type Op = "select" | "insert" | "update" | "delete"
type Comparison = "eq" | "lte" | "gte"

/** Read a column, resolving PostgREST's `column->>key` JSON path form. */
function readColumn(row: Row, column: string): unknown {
  const arrow = column.indexOf("->>")
  if (arrow === -1) return row[column]
  const container = row[column.slice(0, arrow)]
  if (typeof container !== "object" || container === null) return undefined
  return (container as Record<string, unknown>)[column.slice(arrow + 3)]
}

class FakeBuilder<R> implements FilterBuilder<R>, TableBuilder<R> {
  private op: Op = "select"
  private insertRow: Row | null = null
  private updateValues: Row | null = null
  private filters: Array<[string, Comparison, unknown]> = []
  private orderBy: string | null = null
  private ascending = true
  private limitN: number | null = null
  private rangeFrom: number | null = null
  private rangeTo = 0

  constructor(
    private readonly state: TableState,
    private readonly takeError: () => DbError | null
  ) {}

  select(): FilterBuilder<R> {
    return this
  }

  insert(values: R): FilterBuilder<R> {
    this.op = "insert"
    this.insertRow = values as unknown as Row
    return this
  }

  update(values: Partial<R>): FilterBuilder<R> {
    this.op = "update"
    this.updateValues = values as unknown as Row
    return this
  }

  delete(): FilterBuilder<R> {
    this.op = "delete"
    return this
  }

  eq(column: string, value: unknown): FilterBuilder<R> {
    this.filters.push([column, "eq", value])
    return this
  }

  lte(column: string, value: unknown): FilterBuilder<R> {
    this.filters.push([column, "lte", value])
    return this
  }

  gte(column: string, value: unknown): FilterBuilder<R> {
    this.filters.push([column, "gte", value])
    return this
  }

  range(from: number, to: number): FilterBuilder<R> {
    this.rangeFrom = from
    this.rangeTo = to
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): FilterBuilder<R> {
    this.orderBy = column
    this.ascending = opts?.ascending ?? true
    return this
  }

  limit(count: number): FilterBuilder<R> {
    this.limitN = count
    return this
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, op, value]) => {
      const actual = readColumn(row, column)
      if (op === "eq") return actual === value
      if (actual === null || actual === undefined) return false
      return op === "lte"
        ? (actual as never) <= (value as never)
        : (actual as never) >= (value as never)
    })
  }

  private execute(): { rows: Row[]; error: DbError | null } {
    const error = this.takeError()
    if (error !== null) return { rows: [], error }

    if (this.op === "insert") {
      const row = this.insertRow as Row
      for (const key of this.state.unique) {
        if (this.state.rows.some((existing) => existing[key] === row[key])) {
          return { rows: [], error: { message: `duplicate key value: ${key}`, code: "23505" } }
        }
      }
      const stored = { ...row }
      this.state.rows.push(stored)
      return { rows: [{ ...stored }], error: null }
    }

    if (this.op === "update") {
      const updated: Row[] = []
      for (const row of this.state.rows) {
        if (this.matches(row)) {
          Object.assign(row, this.updateValues)
          updated.push({ ...row })
        }
      }
      return { rows: updated, error: null }
    }

    if (this.op === "delete") {
      const kept: Row[] = []
      const removed: Row[] = []
      for (const row of this.state.rows) {
        if (this.matches(row)) removed.push({ ...row })
        else kept.push(row)
      }
      this.state.rows = kept
      return { rows: removed, error: null }
    }

    // select
    let result = this.state.rows.filter((row) => this.matches(row)).map((r) => ({ ...r }))
    if (this.orderBy !== null) {
      const key = this.orderBy
      const dir = this.ascending ? 1 : -1
      result = result.sort((a, b) => {
        const av = a[key]
        const bv = b[key]
        if (av === bv) return 0
        return (av! < bv! ? -1 : 1) * dir
      })
    }
    if (this.rangeFrom !== null) result = result.slice(this.rangeFrom, this.rangeTo + 1)
    if (this.limitN !== null) result = result.slice(0, this.limitN)
    return { rows: result, error: null }
  }

  single(): PromiseLike<DbResponse<R | null>> {
    const { rows, error } = this.execute()
    const data = (rows[0] ?? null) as R | null
    return Promise.resolve({ data, error })
  }

  maybeSingle(): PromiseLike<DbResponse<R | null>> {
    return this.single()
  }

  then<TResult1 = DbResponse<R[]>, TResult2 = never>(
    onfulfilled?: ((value: DbResponse<R[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const { rows, error } = this.execute()
    return Promise.resolve({ data: rows as R[], error }).then(onfulfilled, onrejected)
  }
}

export function createFakeDb(
  config?: Record<string, { rows?: Row[]; unique?: string[] }>
): FakeDb {
  return new FakeDb(config)
}
