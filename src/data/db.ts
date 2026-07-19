import "server-only"

import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * A narrow, PostgREST-shaped database interface satisfied by both the real
 * Supabase client (via a structural cast at the route boundary) and the
 * in-memory `fakeDb` test harness. Repositories depend ONLY on this — never on
 * @supabase/* directly (enforced by ESLint no-restricted-imports).
 */
export interface DbError {
  message: string
  code?: string
}

export type DbResponse<T> = { data: T; error: DbError | null }

export interface FilterBuilder<Row>
  extends PromiseLike<DbResponse<Row[]>> {
  eq(column: string, value: unknown): FilterBuilder<Row>
  order(column: string, opts?: { ascending?: boolean }): FilterBuilder<Row>
  limit(count: number): FilterBuilder<Row>
  select(columns?: string): FilterBuilder<Row>
  single(): PromiseLike<DbResponse<Row | null>>
  maybeSingle(): PromiseLike<DbResponse<Row | null>>
}

export interface TableBuilder<Row> {
  select(columns?: string): FilterBuilder<Row>
  insert(values: Row): FilterBuilder<Row>
  update(values: Partial<Row>): FilterBuilder<Row>
  delete(): FilterBuilder<Row>
}

export interface Db {
  from<Row = Record<string, unknown>>(table: string): TableBuilder<Row>
}

function toAppError(error: DbError) {
  // Postgres unique-violation → conflict; everything else → provider_error.
  if (error.code === "23505") return appError("conflict", error.message)
  return appError("provider_error", `database error: ${error.message}`)
}

/** Insert one row and return it. */
export async function insertReturning<Row>(
  db: Db,
  table: string,
  row: Row
): Promise<Result<Row>> {
  const { data, error } = await db.from<Row>(table).insert(row).select().single()
  if (error !== null) return err(toAppError(error))
  if (data === null) return err(appError("internal", `insert into ${table} returned no row`))
  return ok(data)
}

/** Select rows matching all equality filters, optionally ordered. */
export async function selectWhere<Row>(
  db: Db,
  table: string,
  filters: ReadonlyArray<readonly [string, unknown]>,
  opts?: { orderBy?: string; ascending?: boolean }
): Promise<Result<Row[]>> {
  let query = db.from<Row>(table).select()
  for (const [column, value] of filters) query = query.eq(column, value)
  if (opts?.orderBy !== undefined) {
    query = query.order(opts.orderBy, { ascending: opts.ascending ?? true })
  }
  const { data, error } = await query
  if (error !== null) return err(toAppError(error))
  return ok(data)
}

/** Select a single row matching all filters, or null when none match. */
export async function maybeOneWhere<Row>(
  db: Db,
  table: string,
  filters: ReadonlyArray<readonly [string, unknown]>
): Promise<Result<Row | null>> {
  let query = db.from<Row>(table).select()
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query.maybeSingle()
  if (error !== null) return err(toAppError(error))
  return ok(data)
}

/** Update rows matching all filters and return the updated row. */
export async function updateReturning<Row>(
  db: Db,
  table: string,
  values: Partial<Row>,
  filters: ReadonlyArray<readonly [string, unknown]>
): Promise<Result<Row>> {
  let query = db.from<Row>(table).update(values)
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query.select().single()
  if (error !== null) return err(toAppError(error))
  if (data === null) return err(appError("not_found", `no row in ${table} matched the update`))
  return ok(data)
}
