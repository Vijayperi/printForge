import "server-only"

import { insertReturning, maybeOneWhere, selectWhere, updateReturning, type Db } from "@/src/data/db"
import type { PrinterRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "printers"

export function insertPrinter(
  db: Db,
  input: {
    name: string
    gatewayKind: string
    capabilitiesJson?: Record<string, unknown>
    currentState?: string
  }
): Promise<Result<PrinterRow>> {
  return insertReturning<PrinterRow>(db, TABLE, {
    id: newId("prn"),
    name: input.name,
    gateway_kind: input.gatewayKind,
    capabilities_json: input.capabilitiesJson ?? {},
    current_state: input.currentState ?? "idle",
  } as PrinterRow)
}

export function listPrinters(db: Db): Promise<Result<PrinterRow[]>> {
  return selectWhere<PrinterRow>(db, TABLE, [], { orderBy: "name", ascending: true })
}

export function getPrinter(db: Db, id: string): Promise<Result<PrinterRow | null>> {
  return maybeOneWhere<PrinterRow>(db, TABLE, [["id", id]])
}

export function updatePrinterState(
  db: Db,
  id: string,
  currentState: string,
  lastSeenAt?: string
): Promise<Result<PrinterRow>> {
  const values: Partial<PrinterRow> = { current_state: currentState }
  if (lastSeenAt !== undefined) values.last_seen_at = lastSeenAt
  return updateReturning<PrinterRow>(db, TABLE, values, [["id", id]])
}
