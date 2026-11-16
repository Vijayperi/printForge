import Link from "next/link"

import { Badge } from "@/src/components/ui/badge"
import { opsContent } from "@/src/config/content"
import { getMaterialProfile } from "@/src/config/profiles"
import {
  dueDateFor,
  OPS_EXCEPTION_LABELS,
  type OpsExceptionReason,
} from "@/src/domain/ops/board"
import { orderCustomerLabel, type OrderState } from "@/src/domain/stateMachines/order"
import type { OpsOrderRow } from "@/src/domain/types"
import { formatINR, inr } from "@/src/lib/money"

/** UTC so the board reads the same for every operator, wherever they are. */
export function formatDay(value: string | null): string {
  if (value === null) return opsContent.unassigned
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return opsContent.unassigned
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(date)
}

function exceptionLabel(reason: string | null): string | null {
  if (reason === null) return null
  return OPS_EXCEPTION_LABELS[reason as OpsExceptionReason] ?? reason
}

/** The orders board table (plan §6-S14 step 1). Every row links to its detail page. */
export function OrdersTable({
  orders,
  printerNames,
}: {
  orders: OpsOrderRow[]
  printerNames: Record<string, string>
}) {
  if (orders.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        {opsContent.empty}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">{opsContent.boardTitle}</caption>
        <thead className="bg-muted/50 text-left">
          <tr>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.order}</th>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.customer}</th>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.status}</th>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.material}</th>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.printer}</th>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.due}</th>
            <th scope="col" className="p-3 text-right font-medium">{opsContent.columns.amount}</th>
            <th scope="col" className="p-3 font-medium">{opsContent.columns.exception}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const exception = exceptionLabel(order.exception_reason)
            return (
              <tr key={order.id} className="border-t">
                <td className="p-3">
                  <Link href={`/ops/orders/${order.id}`} className="font-medium hover:underline">
                    {order.id}
                  </Link>
                </td>
                <td className="p-3">{order.customer_name ?? opsContent.unassigned}</td>
                <td className="p-3">{orderCustomerLabel(order.status as OrderState)}</td>
                <td className="p-3">
                  {order.material_id === null
                    ? opsContent.unassigned
                    : getMaterialProfile(order.material_id).name}
                </td>
                <td className="p-3">
                  {order.printer_id === null
                    ? opsContent.unassigned
                    : (printerNames[order.printer_id] ?? order.printer_id)}
                </td>
                <td className="p-3 tabular-nums">
                  {formatDay(dueDateFor(order.paid_at)?.toISOString() ?? null)}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {order.amount_minor === null
                    ? opsContent.unassigned
                    : formatINR(inr(order.amount_minor))}
                </td>
                <td className="p-3">
                  {exception === null ? (
                    opsContent.unassigned
                  ) : (
                    <Badge variant="destructive">{exception}</Badge>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Previous/next links that preserve the active filters. */
export function BoardPager({
  page,
  hasMore,
  query,
}: {
  page: number
  hasMore: boolean
  query: Record<string, string>
}) {
  const href = (target: number): string => {
    const params = new URLSearchParams({ ...query, page: String(target) })
    return `/ops?${params.toString()}`
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
      {page > 0 ? (
        <Link href={href(page - 1)} className="hover:underline">
          {opsContent.previous}
        </Link>
      ) : (
        <span className="text-muted-foreground">{opsContent.previous}</span>
      )}
      <span className="text-muted-foreground">Page {page + 1}</span>
      {hasMore ? (
        <Link href={href(page + 1)} className="hover:underline">
          {opsContent.next}
        </Link>
      ) : (
        <span className="text-muted-foreground">{opsContent.next}</span>
      )}
    </nav>
  )
}
