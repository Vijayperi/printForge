import { describe, expect, it } from "vitest"

import { fleetRows, printerNeedsAttention, printerStateLabel } from "@/src/domain/ops/fleet"
import type { PrinterRow, PrintJobRow } from "@/src/domain/types"

function printer(overrides: Partial<PrinterRow> = {}): PrinterRow {
  return {
    id: "prn_1",
    name: "Bay 1",
    gateway_kind: "mock",
    capabilities_json: {},
    current_state: "idle",
    last_seen_at: null,
    created_at: "2026-07-26T00:00:00Z",
    updated_at: "2026-07-26T00:00:00Z",
    ...overrides,
  }
}

function job(overrides: Partial<PrintJobRow> = {}): PrintJobRow {
  return {
    id: "pj_1",
    order_id: "ord_1",
    printer_id: "prn_1",
    status: "printing",
    gcode_asset_id: "ast_1",
    slice_json: null,
    gateway_job_ref: "gw-1",
    failure_reason: null,
    attempt: 1,
    created_at: "2026-07-26T00:00:00Z",
    updated_at: "2026-07-26T00:00:00Z",
    ...overrides,
  }
}

describe("printerStateLabel", () => {
  it.each([
    ["idle", "Idle"],
    ["busy", "Printing"],
    ["offline", "Offline"],
    ["error", "Error"],
  ] as const)("labels %s as %s", (state, label) => {
    expect(printerStateLabel(state)).toBe(label)
  })

  it("shows an unrecognized state verbatim rather than guessing", () => {
    expect(printerStateLabel("recalibrating")).toBe("recalibrating")
  })
})

describe("printerNeedsAttention", () => {
  it.each([
    ["idle", false],
    ["busy", false],
    ["offline", true],
    ["error", true],
  ] as const)("%s → %s", (state, expected) => {
    expect(printerNeedsAttention(state)).toBe(expected)
  })
})

describe("fleetRows", () => {
  it("pairs each machine with the job it is holding", () => {
    const rows = fleetRows(
      [printer(), printer({ id: "prn_2", name: "Bay 2", current_state: "busy" })],
      [job({ printer_id: "prn_2", attempt: 2 })]
    )

    expect(rows[0]).toEqual({
      printerId: "prn_1",
      name: "Bay 1",
      state: "idle",
      stateLabel: "Idle",
      needsAttention: false,
      lastSeenAt: null,
      job: null,
    })
    expect(rows[1]?.job).toEqual({
      id: "pj_1",
      orderId: "ord_1",
      attempt: 2,
      status: "printing",
    })
  })

  it("flags a machine that needs an operator", () => {
    const rows = fleetRows([printer({ current_state: "error", last_seen_at: "2026-07-26T09:00:00Z" })], [])
    expect(rows[0]).toMatchObject({
      stateLabel: "Error",
      needsAttention: true,
      lastSeenAt: "2026-07-26T09:00:00Z",
    })
  })

  it("ignores held jobs belonging to machines that are not in the fleet", () => {
    const rows = fleetRows([printer()], [job({ printer_id: "prn_retired" })])
    expect(rows[0]?.job).toBeNull()
  })

  it("is empty when no printers are configured", () => {
    expect(fleetRows([], [job()])).toEqual([])
  })
})
