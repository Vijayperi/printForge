import "server-only"

import { insertReturning, selectWhere, type Db } from "@/src/data/db"
import type { ShipmentRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "shipments"

export function insertShipment(
  db: Db,
  input: { orderId: string; carrier: string; trackingNumber: string; status?: string }
): Promise<Result<ShipmentRow>> {
  return insertReturning<ShipmentRow>(db, TABLE, {
    id: newId("shp"),
    order_id: input.orderId,
    carrier: input.carrier,
    tracking_number: input.trackingNumber,
    status: input.status ?? "created",
  } as ShipmentRow)
}

export function listShipmentsByOrder(db: Db, orderId: string): Promise<Result<ShipmentRow[]>> {
  return selectWhere<ShipmentRow>(db, TABLE, [["order_id", orderId]], {
    orderBy: "created_at",
    ascending: false,
  })
}
