import { describe, expect, it } from "vitest"

import type { PrinterGateway } from "@/src/adapters/printerGateway"

export interface PrinterGatewaySubject {
  gateway: PrinterGateway
  /** A machine that is idle and will accept a file. */
  idlePrinterId: string
  /** A machine that cannot be reached at all. */
  offlinePrinterId: string
  /** A handle no gateway has ever issued. */
  unknownJobRef: string
  /** A key that resolves to real gcode bytes in this subject's storage. */
  gcodeStorageKey: string
}

function releaseInput(subject: PrinterGatewaySubject, printerId: string, printJobId = "pj_contract_1") {
  return {
    printJobId,
    printerId,
    gcodeStorageKey: subject.gcodeStorageKey,
    idempotencyKey: printJobId,
  }
}

/**
 * Shared contract every PrinterGateway must satisfy (plan §4.4), run against the
 * mock fleet and the real OctoPrint gateway (the latter behind MSW) so the two
 * can never drift. The double-release case is the load-bearing one: a duplicate
 * dispatch must never put a second copy of a file on a machine.
 */
export function printerGatewayContract(
  makeSubject: () => PrinterGatewaySubject | Promise<PrinterGatewaySubject>
): void {
  describe("PrinterGateway contract", () => {
    it("reports an untouched printer as idle", async () => {
      const { gateway, idlePrinterId } = await makeSubject()
      const status = await gateway.printerStatus(idlePrinterId)
      expect(status.ok).toBe(true)
      if (status.ok) expect(status.value.state).toBe("idle")
    })

    it("release returns a non-empty gateway job ref", async () => {
      const subject = await makeSubject()
      const { gateway, idlePrinterId } = subject
      const released = await gateway.release(releaseInput(subject, idlePrinterId))
      expect(released.ok).toBe(true)
      if (released.ok) expect(released.value.gatewayJobRef.length).toBeGreaterThan(0)
    })

    it("returns the same ref for a replayed idempotency key, without a second print", async () => {
      const subject = await makeSubject()
      const { gateway, idlePrinterId } = subject
      const input = releaseInput(subject, idlePrinterId)

      const first = await gateway.release(input)
      const second = await gateway.release(input)
      expect(first.ok && second.ok).toBe(true)
      if (first.ok && second.ok) {
        expect(second.value.gatewayJobRef).toBe(first.value.gatewayJobRef)
      }
    })

    it("reports the released job as busy on the machine that has it", async () => {
      const subject = await makeSubject()
      const { gateway, idlePrinterId } = subject
      const released = await gateway.release(releaseInput(subject, idlePrinterId))
      expect(released.ok).toBe(true)
      if (!released.ok) return

      const status = await gateway.printerStatus(idlePrinterId)
      expect(status.ok).toBe(true)
      if (status.ok) {
        expect(status.value.state).toBe("busy")
        expect(status.value.currentJobRef).toBe(released.value.gatewayJobRef)
      }
    })

    it("refuses to release to an unreachable printer", async () => {
      const subject = await makeSubject()
      const { gateway, offlinePrinterId } = subject
      const released = await gateway.release(releaseInput(subject, offlinePrinterId))
      expect(released.ok).toBe(false)
      if (!released.ok) expect(released.error.code).toBe("precondition_failed")
    })

    it("reports an unreachable printer as offline", async () => {
      const { gateway, offlinePrinterId } = await makeSubject()
      const status = await gateway.printerStatus(offlinePrinterId)
      expect(status.ok).toBe(true)
      if (status.ok) expect(status.value.state).toBe("offline")
    })

    it("cancels a job that is on a machine", async () => {
      const subject = await makeSubject()
      const { gateway, idlePrinterId } = subject
      const released = await gateway.release(releaseInput(subject, idlePrinterId))
      expect(released.ok).toBe(true)
      if (!released.ok) return

      const cancelled = await gateway.cancel(released.value.gatewayJobRef)
      expect(cancelled.ok).toBe(true)
    })

    it("cannot cancel a job it never issued", async () => {
      const { gateway, unknownJobRef } = await makeSubject()
      const cancelled = await gateway.cancel(unknownJobRef)
      expect(cancelled.ok).toBe(false)
      if (!cancelled.ok) expect(cancelled.error.code).toBe("not_found")
    })
  })
}
