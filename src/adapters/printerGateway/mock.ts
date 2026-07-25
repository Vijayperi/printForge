import {
  assertPrinterIdle,
  type PrinterGateway,
  type PrinterGatewayState,
  type PrinterGatewayStatus,
  type ReleaseInput,
} from "@/src/adapters/printerGateway"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/** One thing a scripted machine reports on one poll. */
export interface MockTick {
  state: PrinterGatewayState
  progressPct?: number
}

/**
 * How a simulated machine behaves (plan §6-S15 step 1). The timeline is consumed
 * by `printerStatus` **after a release**, one tick per poll, so a test walks a
 * print by polling rather than by waiting — no clock, no timers, deterministic.
 *
 * A non-`busy` tick ends the print and becomes the machine's new resting state:
 * `idle` frees it for the next job, `error` leaves it needing an operator.
 */
export interface MockPrinterScript {
  /** Reported until something is released; also where a finished print returns to. */
  restingState?: PrinterGatewayState
  /** One tick per poll while a job is on the bed; the last tick repeats. */
  timeline?: readonly MockTick[]
}

/** Prints cleanly: two polls of progress, then the bed is free again. */
export const MOCK_SCRIPT_HAPPY: MockPrinterScript = {
  timeline: [
    { state: "busy", progressPct: 10 },
    { state: "busy", progressPct: 60 },
    { state: "idle" },
  ],
}

/** Unreachable — releases are refused before anything is uploaded. */
export const MOCK_SCRIPT_OFFLINE: MockPrinterScript = { restingState: "offline" }

/** Fails partway through, the way a filament jam or thermal runaway does. */
export function mockScriptFailsAt(progressPct: number): MockPrinterScript {
  return { timeline: [{ state: "busy", progressPct }, { state: "error" }] }
}

const DEFAULT_TIMELINE: readonly MockTick[] = [{ state: "busy", progressPct: 50 }, { state: "idle" }]

interface MockPrinter {
  restingState: PrinterGatewayState
  timeline: readonly MockTick[]
  cursor: number
  jobRef: string | null
}

interface MockJob {
  printerId: string
  printJobId: string
  gcodeStorageKey: string
}

/**
 * A simulated print fleet for development and tests (plan §6-S15 step 1).
 *
 * Printers are named by the same ids the `printers` table uses; anything not in
 * the script map is an idle machine running the default timeline, so a seeded
 * database works without configuring every bay.
 */
export class MockPrinterGateway implements PrinterGateway {
  private readonly printers = new Map<string, MockPrinter>()
  private readonly refsByKey = new Map<string, string>()
  private readonly jobs = new Map<string, MockJob>()
  private readonly cancelled = new Set<string>()
  private counter = 0

  constructor(scripts: Record<string, MockPrinterScript> = {}) {
    for (const [printerId, script] of Object.entries(scripts)) {
      this.printers.set(printerId, {
        restingState: script.restingState ?? "idle",
        timeline: script.timeline ?? DEFAULT_TIMELINE,
        cursor: 0,
        jobRef: null,
      })
    }
  }

  async release(job: ReleaseInput): Promise<Result<{ gatewayJobRef: string }>> {
    const replay = this.refsByKey.get(job.idempotencyKey)
    // A replay never reaches the machine: same ref back, no second print.
    if (replay !== undefined) return ok({ gatewayJobRef: replay })

    const printer = this.printer(job.printerId)
    const idle = assertPrinterIdle(printer.jobRef === null ? printer.restingState : "busy")
    if (!idle.ok) return idle

    this.counter += 1
    const gatewayJobRef = `mock-gw-${this.counter}`
    this.refsByKey.set(job.idempotencyKey, gatewayJobRef)
    this.jobs.set(gatewayJobRef, {
      printerId: job.printerId,
      printJobId: job.printJobId,
      gcodeStorageKey: job.gcodeStorageKey,
    })
    printer.jobRef = gatewayJobRef
    printer.cursor = 0
    return ok({ gatewayJobRef })
  }

  async printerStatus(printerId: string): Promise<Result<PrinterGatewayStatus>> {
    const printer = this.printer(printerId)
    if (printer.jobRef === null) return ok({ state: printer.restingState })

    const tick = printer.timeline[Math.min(printer.cursor, printer.timeline.length - 1)] as MockTick
    printer.cursor += 1
    if (tick.state !== "busy") {
      // The print is over: the machine settles into whatever the tick reported.
      printer.jobRef = null
      printer.restingState = tick.state
      return ok({ state: tick.state })
    }
    const status: PrinterGatewayStatus = { state: "busy", currentJobRef: printer.jobRef }
    if (tick.progressPct !== undefined) status.progressPct = tick.progressPct
    return ok(status)
  }

  async cancel(gatewayJobRef: string): Promise<Result<void>> {
    const job = this.jobs.get(gatewayJobRef)
    if (job === undefined) {
      return err(appError("not_found", `unknown gateway job ${gatewayJobRef}`))
    }
    // Cancelling twice is not an error — the printer is stopped either way.
    this.cancelled.add(gatewayJobRef)
    const printer = this.printer(job.printerId)
    if (printer.jobRef === gatewayJobRef) {
      printer.jobRef = null
      printer.cursor = 0
    }
    return ok(undefined)
  }

  /** Test seam: was this job stopped mid-print? */
  wasCancelled(gatewayJobRef: string): boolean {
    return this.cancelled.has(gatewayJobRef)
  }

  /** Test seam: what the fleet was actually asked to print. */
  releasedJob(gatewayJobRef: string): { printJobId: string; gcodeStorageKey: string } | null {
    const job = this.jobs.get(gatewayJobRef)
    if (job === undefined) return null
    return { printJobId: job.printJobId, gcodeStorageKey: job.gcodeStorageKey }
  }

  private printer(printerId: string): MockPrinter {
    const existing = this.printers.get(printerId)
    if (existing !== undefined) return existing
    const fresh: MockPrinter = {
      restingState: "idle",
      timeline: DEFAULT_TIMELINE,
      cursor: 0,
      jobRef: null,
    }
    this.printers.set(printerId, fresh)
    return fresh
  }
}
