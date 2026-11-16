import { opsContent } from "@/src/config/content"
import type { PrinterGatewayState, PrinterRow, PrintJobRow } from "@/src/domain/types"

const PRINTER_STATES = ["idle", "busy", "offline", "error"] as const

/**
 * Operator-facing label for a machine's cached state (`/ops/printers`). The
 * column is a free-text string in the database, so an unrecognized value is
 * shown as-is rather than hidden behind a wrong label.
 */
export function printerStateLabel(state: string): string {
  return (PRINTER_STATES as readonly string[]).includes(state)
    ? opsContent.printerStates[state as PrinterGatewayState]
    : state
}

/** A machine is worth an operator's attention when it is neither idle nor printing. */
export function printerNeedsAttention(state: string): boolean {
  return state === "offline" || state === "error"
}

export interface FleetRow {
  printerId: string
  name: string
  state: string
  stateLabel: string
  needsAttention: boolean
  lastSeenAt: string | null
  job: { id: string; orderId: string; attempt: number; status: string } | null
}

/**
 * The fleet view (plan §6-S15 step 4: "live printer states on /ops/printers").
 *
 * States come from the `printers` table rather than from the gateway itself: the
 * status poller writes what each machine reported, and a page that asked the
 * machines directly would both be slow and put the printer credentials one
 * import away from a React component (FR-9).
 */
export function fleetRows(
  printers: readonly PrinterRow[],
  heldJobs: readonly PrintJobRow[]
): FleetRow[] {
  return printers.map((printer) => {
    const job = heldJobs.find((held) => held.printer_id === printer.id) ?? null
    return {
      printerId: printer.id,
      name: printer.name,
      state: printer.current_state,
      stateLabel: printerStateLabel(printer.current_state),
      needsAttention: printerNeedsAttention(printer.current_state),
      lastSeenAt: printer.last_seen_at,
      job:
        job === null
          ? null
          : { id: job.id, orderId: job.order_id, attempt: job.attempt, status: job.status },
    }
  })
}
