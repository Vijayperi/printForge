import "server-only"

import { insertReturning, maybeOneWhere, selectWhere, updateReturning, type Db } from "@/src/data/db"
import type { PrintJobRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "print_jobs"

export function insertPrintJob(
  db: Db,
  input: { orderId: string; printerId?: string; status?: string; gcodeAssetId?: string }
): Promise<Result<PrintJobRow>> {
  return insertReturning<PrintJobRow>(db, TABLE, {
    id: newId("pj"),
    order_id: input.orderId,
    printer_id: input.printerId ?? null,
    status: input.status ?? "pending",
    gcode_asset_id: input.gcodeAssetId ?? null,
  } as PrintJobRow)
}

export function getPrintJob(db: Db, id: string): Promise<Result<PrintJobRow | null>> {
  return maybeOneWhere<PrintJobRow>(db, TABLE, [["id", id]])
}

export function listPrintJobsByOrder(db: Db, orderId: string): Promise<Result<PrintJobRow[]>> {
  return selectWhere<PrintJobRow>(db, TABLE, [["order_id", orderId]], {
    orderBy: "created_at",
    ascending: false,
  })
}

export function updatePrintJobStatus(
  db: Db,
  id: string,
  status: string,
  opts?: { failureReason?: string }
): Promise<Result<PrintJobRow>> {
  const values: Partial<PrintJobRow> = { status }
  if (opts?.failureReason !== undefined) values.failure_reason = opts.failureReason
  return updateReturning<PrintJobRow>(db, TABLE, values, [["id", id]])
}

export function assignPrinter(db: Db, id: string, printerId: string): Promise<Result<PrintJobRow>> {
  return updateReturning<PrintJobRow>(db, TABLE, { printer_id: printerId }, [["id", id]])
}
