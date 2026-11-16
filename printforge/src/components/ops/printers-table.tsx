import Link from "next/link"

import { Badge } from "@/src/components/ui/badge"
import { opsContent } from "@/src/config/content"
import type { FleetRow } from "@/src/domain/ops/fleet"
import { PRINT_JOB_LABELS, type PrintJobState } from "@/src/domain/stateMachines/printJob"

/** UTC, like the orders board: every operator reads the same clock. */
export function formatSeenAt(value: string | null): string {
  if (value === null) return opsContent.fleetNeverSeen
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return opsContent.fleetNeverSeen
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

/**
 * The fleet table (plan §6-S15 step 4). A machine holding a job links to that
 * job's order, because "which print is on bay 2" is always really the question
 * "whose order is bay 2 holding up".
 */
export function PrintersTable({ printers }: { printers: FleetRow[] }) {
  if (printers.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        {opsContent.fleetEmpty}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">{opsContent.fleetTitle}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="p-3 font-medium">
              {opsContent.fleetColumns.printer}
            </th>
            <th scope="col" className="p-3 font-medium">
              {opsContent.fleetColumns.state}
            </th>
            <th scope="col" className="p-3 font-medium">
              {opsContent.fleetColumns.job}
            </th>
            <th scope="col" className="p-3 font-medium">
              {opsContent.fleetColumns.seen}
            </th>
          </tr>
        </thead>
        <tbody>
          {printers.map((printer) => (
            <tr key={printer.printerId} className="border-t">
              <th scope="row" className="p-3 text-left font-medium">
                {printer.name}
              </th>
              <td className="p-3">
                <Badge variant={printer.needsAttention ? "destructive" : "secondary"}>
                  {printer.stateLabel}
                </Badge>
              </td>
              <td className="p-3">
                {printer.job === null ? (
                  <span className="text-muted-foreground">{opsContent.fleetIdleJob}</span>
                ) : (
                  <Link href={`/ops/orders/${printer.job.orderId}`} className="hover:underline">
                    {printer.job.orderId}
                    <span className="text-muted-foreground">
                      {" · "}
                      {opsContent.attemptLabel} {printer.job.attempt}
                      {" · "}
                      {PRINT_JOB_LABELS[printer.job.status as PrintJobState] ?? printer.job.status}
                    </span>
                  </Link>
                )}
              </td>
              <td className="p-3 text-muted-foreground">{formatSeenAt(printer.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
