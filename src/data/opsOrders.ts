import "server-only"

import { maybeOneWhere, selectPage, type Db, type Page, type Restriction } from "@/src/data/db"
import {
  endOfDay,
  OPS_PAGE_SIZE,
  paidAtCutoffForDue,
  type OpsOrderFilter,
} from "@/src/domain/ops/board"
import type { OpsOrderRow } from "@/src/domain/types"
import type { Result } from "@/src/lib/result"

const VIEW = "ops_orders"

/**
 * One page of the operations board (plan §6-S14 step 1). Every filter is a
 * restriction on the `ops_orders` view, so narrowing happens in Postgres.
 *
 * `dueBefore` is translated into a bound on `paid_at`: the due date is a derived
 * value with no column of its own, and its definition (the commerce SLA) lives
 * in one place.
 */
export function listOpsOrders(
  db: Db,
  filter: OpsOrderFilter
): Promise<Result<Page<OpsOrderRow>>> {
  const restrictions: Restriction[] = []
  if (filter.status !== undefined) restrictions.push(["status", "eq", filter.status])
  if (filter.printerId !== undefined) restrictions.push(["printer_id", "eq", filter.printerId])
  if (filter.materialId !== undefined) restrictions.push(["material_id", "eq", filter.materialId])
  if (filter.exception !== undefined) {
    restrictions.push(["exception_reason", "eq", filter.exception])
  }
  if (filter.dueBefore !== undefined) {
    restrictions.push([
      "paid_at",
      "lte",
      paidAtCutoffForDue(endOfDay(filter.dueBefore)).toISOString(),
    ])
  }

  return selectPage<OpsOrderRow>(db, VIEW, restrictions, {
    orderBy: "created_at",
    ascending: false,
    page: filter.page,
    pageSize: OPS_PAGE_SIZE,
  })
}

/** One board row by id — the detail page's header data. */
export function getOpsOrder(db: Db, id: string): Promise<Result<OpsOrderRow | null>> {
  return maybeOneWhere<OpsOrderRow>(db, VIEW, [["id", id]])
}
