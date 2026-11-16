import { describe, expect, it } from "vitest"

import { getPrinter, insertPrinter, listPrinters, updatePrinterState } from "@/src/data/printers"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ printers: { rows, unique: ["id"] } })
}

describe("insertPrinter", () => {
  it("inserts with defaults and a prn_ id", async () => {
    const result = await insertPrinter(db(), { name: "Bambu A1", gatewayKind: "octoprint" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isId("prn", result.value.id)).toBe(true)
      expect(result.value.name).toBe("Bambu A1")
      expect(result.value.gateway_kind).toBe("octoprint")
      expect(result.value.capabilities_json).toEqual({})
      expect(result.value.current_state).toBe("idle")
    }
  })

  it("honors provided capabilities and state", async () => {
    const result = await insertPrinter(db(), {
      name: "P2",
      gatewayKind: "moonraker",
      capabilitiesJson: { bed: 256 },
      currentState: "offline",
    })
    expect(result.ok && result.value.capabilities_json).toEqual({ bed: 256 })
    expect(result.ok && result.value.current_state).toBe("offline")
  })
})

describe("listPrinters", () => {
  it("lists all printers ordered by name", async () => {
    const fake = db([
      { id: "prn_2", name: "Zeta", gateway_kind: "octoprint", current_state: "idle" },
      { id: "prn_1", name: "Alpha", gateway_kind: "octoprint", current_state: "idle" },
    ])
    const result = await listPrinters(fake)
    expect(result.ok && result.value.map((p) => p.name)).toEqual(["Alpha", "Zeta"])
  })
})

describe("getPrinter", () => {
  it("returns a printer or null", async () => {
    const fake = db([{ id: "prn_1", name: "A", gateway_kind: "octoprint", current_state: "idle" }])
    expect((await getPrinter(fake, "prn_1")).ok).toBe(true)
    const missing = await getPrinter(fake, "prn_x")
    expect(missing.ok && missing.value).toBeNull()
  })
})

describe("updatePrinterState", () => {
  it("updates state only", async () => {
    const fake = db([{ id: "prn_1", name: "A", gateway_kind: "octoprint", current_state: "idle", last_seen_at: null }])
    const result = await updatePrinterState(fake, "prn_1", "busy")
    expect(result.ok && result.value.current_state).toBe("busy")
    expect(result.ok && result.value.last_seen_at).toBeNull()
  })

  it("updates state and last_seen_at", async () => {
    const fake = db([{ id: "prn_1", name: "A", gateway_kind: "octoprint", current_state: "idle", last_seen_at: null }])
    const result = await updatePrinterState(fake, "prn_1", "idle", "2026-07-19T00:00:00Z")
    expect(result.ok && result.value.last_seen_at).toBe("2026-07-19T00:00:00Z")
  })
})
