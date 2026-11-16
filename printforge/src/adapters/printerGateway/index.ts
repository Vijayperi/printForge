import type { PrinterGatewayState } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/** What a machine is doing right now, normalized across gateway kinds (plan §4.4). */
export type { PrinterGatewayState }

export interface PrinterGatewayStatus {
  state: PrinterGatewayState
  /** The gateway's handle for the job on the bed, when one is printing. */
  currentJobRef?: string
  progressPct?: number
}

export interface ReleaseInput {
  printJobId: string
  printerId: string
  gcodeStorageKey: string
  /**
   * Replays with the same key must return the same `gatewayJobRef` and must not
   * start a second print — the one invariant a double-dispatch cannot violate.
   */
  idempotencyKey: string
}

/**
 * The seam between PrintForge and the machines (plan §4.4). Nothing outside
 * `src/jobs/**` and the ops release route may import an implementation: printers
 * are unreachable from any browser context (FR-9), which ESLint enforces.
 */
export interface PrinterGateway {
  release(job: ReleaseInput): Promise<Result<{ gatewayJobRef: string }>>
  printerStatus(printerId: string): Promise<Result<PrinterGatewayStatus>>
  cancel(gatewayJobRef: string): Promise<Result<void>>
}

/** Why a machine in this state cannot be given a file, in operator language. */
const NOT_RELEASABLE: Record<Exclude<PrinterGatewayState, "idle">, string> = {
  busy: "the printer is busy with another job",
  offline: "the printer is offline",
  error: "the printer is reporting an error",
}

/**
 * A file may only be sent to a machine that is idle. Shared by every gateway so
 * "busy/offline → precondition_failed with the reason surfaced to ops" (plan
 * §6-S15 step 2) reads the same whichever gateway refused.
 */
export function assertPrinterIdle(state: PrinterGatewayState): Result<void> {
  if (state === "idle") return ok(undefined)
  return err(appError("precondition_failed", NOT_RELEASABLE[state]))
}
