import "server-only"

import { insertReturning, maybeOneWhere, selectWhere, updateReturning, type Db } from "@/src/data/db"
import { HOLDING_PRINT_JOB_STATES } from "@/src/domain/stateMachines/printJob"
import type { PrintJobRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import { ok, type Result } from "@/src/lib/result"

const TABLE = "print_jobs"

export function insertPrintJob(
  db: Db,
  input: {
    orderId: string
    printerId?: string
    status?: string
    gcodeAssetId?: string
    /** Which print of this order this is; a fresh job is the first attempt. */
    attempt?: number
  }
): Promise<Result<PrintJobRow>> {
  return insertReturning<PrintJobRow>(db, TABLE, {
    id: newId("pj"),
    order_id: input.orderId,
    printer_id: input.printerId ?? null,
    status: input.status ?? "pending",
    gcode_asset_id: input.gcodeAssetId ?? null,
    attempt: input.attempt ?? 1,
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
  opts?: { failureReason?: string | null; attempt?: number; gatewayJobRef?: string | null }
): Promise<Result<PrintJobRow>> {
  const values: Partial<PrintJobRow> = { status }
  if (opts?.failureReason !== undefined) values.failure_reason = opts.failureReason
  if (opts?.attempt !== undefined) values.attempt = opts.attempt
  if (opts?.gatewayJobRef !== undefined) values.gateway_job_ref = opts.gatewayJobRef
  return updateReturning<PrintJobRow>(db, TABLE, values, [["id", id]])
}

/**
 * Every job a machine is currently holding, newest first (the `/ops/printers`
 * fleet view). The `Db` interface has no `in` filter, so this is one query per
 * holding state — there are only two of them.
 */
export async function listHeldPrintJobs(db: Db): Promise<Result<PrintJobRow[]>> {
  const rows: PrintJobRow[] = []
  for (const status of HOLDING_PRINT_JOB_STATES) {
    const page = await selectWhere<PrintJobRow>(db, TABLE, [["status", status]], {
      orderBy: "created_at",
      ascending: false,
    })
    if (!page.ok) return page
    rows.push(...page.value)
  }
  return ok(rows)
}

export function assignPrinter(db: Db, id: string, printerId: string): Promise<Result<PrintJobRow>> {
  return updateReturning<PrintJobRow>(db, TABLE, { printer_id: printerId }, [["id", id]])
}
