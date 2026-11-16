import { describe, expect, it } from "vitest"

import { insertShipment, listShipmentsByOrder } from "@/src/data/shipments"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ shipments: { rows, unique: ["id"] } })
}

describe("insertShipment", () => {
  it("inserts with a generated shp_ id and default status", async () => {
    const fake = db()
    const result = await insertShipment(fake, {
      orderId: "ord_1",
      carrier: "Delhivery",
      trackingNumber: "TRK123",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("shp", result.value.id)).toBe(true)
      expect(result.value.order_id).toBe("ord_1")
      expect(result.value.carrier).toBe("Delhivery")
      expect(result.value.tracking_number).toBe("TRK123")
      expect(result.value.status).toBe("created")
    }
  })

  it("honors an explicit status", async () => {
    const fake = db()
    const result = await insertShipment(fake, {
      orderId: "ord_1",
      carrier: "Blue Dart",
      trackingNumber: "BD9",
      status: "in_transit",
    })
    expect(result.ok && result.value.status).toBe("in_transit")
  })
})

describe("listShipmentsByOrder", () => {
  it("returns shipments for an order, newest first", async () => {
    const fake = db([
      { id: "shp_1", order_id: "ord_1", carrier: "A", tracking_number: "1", created_at: "2026-01-01" },
      { id: "shp_2", order_id: "ord_1", carrier: "B", tracking_number: "2", created_at: "2026-01-05" },
      { id: "shp_3", order_id: "ord_2", carrier: "C", tracking_number: "3", created_at: "2026-01-09" },
    ])
    const result = await listShipmentsByOrder(fake, "ord_1")
    expect(result.ok && result.value.map((s) => s.id)).toEqual(["shp_2", "shp_1"])
  })
})
