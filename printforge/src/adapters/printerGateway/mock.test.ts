import { describe, expect, it } from "vitest"

import { printerGatewayContract } from "@/src/adapters/printerGateway/contract.spec-factory"
import {
  MOCK_SCRIPT_HAPPY,
  MOCK_SCRIPT_OFFLINE,
  MockPrinterGateway,
  mockScriptFailsAt,
} from "@/src/adapters/printerGateway/mock"

const IDLE = "prn_idle"
const OFFLINE = "prn_offline"

function makeGateway() {
  return new MockPrinterGateway({
    [IDLE]: MOCK_SCRIPT_HAPPY,
    [OFFLINE]: MOCK_SCRIPT_OFFLINE,
  })
}

function input(printerId: string, printJobId = "pj_1") {
  return {
    printJobId,
    printerId,
    gcodeStorageKey: `gcode/${printJobId}.gcode`,
    idempotencyKey: printJobId,
  }
}

printerGatewayContract(() => ({
  gateway: makeGateway(),
  idlePrinterId: IDLE,
  offlinePrinterId: OFFLINE,
  unknownJobRef: "mock-gw-999",
  // The mock fleet never reads the file, only records which one it was asked for.
  gcodeStorageKey: "gcode/pj_contract_1.gcode",
}))

describe("MockPrinterGateway", () => {
  it("walks a scripted print from progress to a free bed", async () => {
    const gateway = makeGateway()
    const released = await gateway.release(input(IDLE))
    expect(released.ok).toBe(true)
    if (!released.ok) return

    const first = await gateway.printerStatus(IDLE)
    const second = await gateway.printerStatus(IDLE)
    const third = await gateway.printerStatus(IDLE)

    expect(first.ok && first.value).toEqual({
      state: "busy",
      currentJobRef: released.value.gatewayJobRef,
      progressPct: 10,
    })
    expect(second.ok && second.value.progressPct).toBe(60)
    expect(third.ok && third.value).toEqual({ state: "idle" })
  })

  it("frees the machine for the next order once a print finishes", async () => {
    const gateway = makeGateway()
    await gateway.release(input(IDLE, "pj_1"))
    for (const _ of MOCK_SCRIPT_HAPPY.timeline ?? []) await gateway.printerStatus(IDLE)

    const next = await gateway.release(input(IDLE, "pj_2"))
    expect(next.ok).toBe(true)
  })

  it("refuses a second job while the first is still on the bed", async () => {
    const gateway = makeGateway()
    await gateway.release(input(IDLE, "pj_1"))

    const second = await gateway.release(input(IDLE, "pj_2"))
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe("precondition_failed")
      expect(second.error.message).toBe("the printer is busy with another job")
    }
  })

  it("reports a mid-print failure and leaves the machine needing attention", async () => {
    const gateway = new MockPrinterGateway({ [IDLE]: mockScriptFailsAt(40) })
    await gateway.release(input(IDLE))

    const printing = await gateway.printerStatus(IDLE)
    expect(printing.ok && printing.value.progressPct).toBe(40)
    const failed = await gateway.printerStatus(IDLE)
    expect(failed.ok && failed.value).toEqual({ state: "error" })

    // The bay stays in error: the next release is refused, not silently accepted.
    const next = await gateway.release(input(IDLE, "pj_2"))
    expect(next.ok).toBe(false)
    if (!next.ok) expect(next.error.message).toBe("the printer is reporting an error")
  })

  it("reports busy without progress when the script omits it", async () => {
    const gateway = new MockPrinterGateway({ [IDLE]: { timeline: [{ state: "busy" }] } })
    const released = await gateway.release(input(IDLE))
    const status = await gateway.printerStatus(IDLE)
    expect(released.ok && status.ok && status.value).toEqual({
      state: "busy",
      currentJobRef: "mock-gw-1",
    })
  })

  it("treats an unscripted printer as an idle machine on the default timeline", async () => {
    const gateway = makeGateway()
    const status = await gateway.printerStatus("prn_unscripted")
    expect(status.ok && status.value).toEqual({ state: "idle" })

    const released = await gateway.release(input("prn_unscripted"))
    expect(released.ok).toBe(true)
    const busy = await gateway.printerStatus("prn_unscripted")
    expect(busy.ok && busy.value.progressPct).toBe(50)
  })

  it("stops a print mid-run and frees the machine", async () => {
    const gateway = makeGateway()
    const released = await gateway.release(input(IDLE))
    expect(released.ok).toBe(true)
    if (!released.ok) return
    await gateway.printerStatus(IDLE)

    const cancelled = await gateway.cancel(released.value.gatewayJobRef)
    expect(cancelled.ok).toBe(true)
    expect(gateway.wasCancelled(released.value.gatewayJobRef)).toBe(true)

    // The bed is free again, so the next order can go on immediately.
    const status = await gateway.printerStatus(IDLE)
    expect(status.ok && status.value).toEqual({ state: "idle" })
    expect((await gateway.release(input(IDLE, "pj_2"))).ok).toBe(true)
  })

  it("cancelling twice is not an error", async () => {
    const gateway = makeGateway()
    const released = await gateway.release(input(IDLE))
    if (!released.ok) return expect.unreachable("release failed")

    await gateway.cancel(released.value.gatewayJobRef)
    const again = await gateway.cancel(released.value.gatewayJobRef)
    expect(again.ok).toBe(true)
  })

  it("records what the fleet was asked to print", async () => {
    const gateway = makeGateway()
    const released = await gateway.release(input(IDLE, "pj_7"))
    if (!released.ok) return expect.unreachable("release failed")

    expect(gateway.releasedJob(released.value.gatewayJobRef)).toEqual({
      printJobId: "pj_7",
      gcodeStorageKey: "gcode/pj_7.gcode",
    })
    expect(gateway.releasedJob("mock-gw-404")).toBeNull()
    expect(gateway.wasCancelled(released.value.gatewayJobRef)).toBe(false)
  })
})
