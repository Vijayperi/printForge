import { describe, expect, it } from "vitest"

import { assertPrinterIdle, type PrinterGatewayState } from "@/src/adapters/printerGateway"

describe("assertPrinterIdle", () => {
  it("allows a release to an idle printer", () => {
    expect(assertPrinterIdle("idle")).toEqual({ ok: true, value: undefined })
  })

  const refused = [
    ["busy", "the printer is busy with another job"],
    ["offline", "the printer is offline"],
    ["error", "the printer is reporting an error"],
  ] as const satisfies readonly [PrinterGatewayState, string][]

  it.each(refused)("refuses a %s printer as precondition_failed", (state, message) => {
    const result = assertPrinterIdle(state)
    expect(result.ok).toBe(false)
    if (result.ok) expect.unreachable("expected a refusal")
    else {
      expect(result.error.code).toBe("precondition_failed")
      expect(result.error.message).toBe(message)
    }
  })
})
