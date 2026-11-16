import Link from "next/link"
import { redirect } from "next/navigation"

import { getAuthGateway } from "@/src/adapters/auth/factory"
import { PageHeader } from "@/src/components/layout/primitives"
import { ordersContent } from "@/src/config/content"
import { listOrdersByUser } from "@/src/data/orders"
import { getRequestDb } from "@/src/data/supabaseClients"
import { orderCustomerLabel, type OrderState } from "@/src/domain/stateMachines/order"

/** Orders list (plan §6-S13 step 4) — customer labels only, never raw statuses. */
export default async function OrdersPage() {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) redirect("/login")

  const db = await getRequestDb()
  const result = await listOrdersByUser(db, user.value.userId)
  const orders = result.ok ? result.value : []

  return (
    <div className="space-y-6">
      <PageHeader title={ordersContent.listTitle} description={ordersContent.listIntro} />

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {ordersContent.empty}
        </div>
      ) : (
        <ul className="list-none space-y-3 p-0">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-4 transition-colors hover:bg-muted"
              >
                <span className="space-y-1">
                  <span className="block font-medium">{order.id}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ordersContent.placedLabel} {new Date(order.created_at).toLocaleDateString()}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {orderCustomerLabel(order.status as OrderState)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
