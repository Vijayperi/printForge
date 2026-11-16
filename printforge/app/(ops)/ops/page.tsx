import { notFound } from "next/navigation"

import { PageHeader } from "@/src/components/layout/primitives"
import { OrderFilters, type FilterOption } from "@/src/components/ops/order-filters"
import { BoardPager, OrdersTable } from "@/src/components/ops/orders-table"
import { opsContent } from "@/src/config/content"
import { listOpsOrders } from "@/src/data/opsOrders"
import { listPrinters } from "@/src/data/printers"
import { getServiceDb } from "@/src/data/supabaseClients"
import { parseOpsOrderFilter } from "@/src/domain/ops/board"
import { requireOperator } from "@/src/lib/opsAuth"

type Query = Record<string, string | string[] | undefined>

/** Collapse Next's repeated-parameter shape down to the first value of each key. */
function firstValues(query: Query): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    const single = Array.isArray(value) ? value[0] : value
    if (single !== undefined && single !== "") flat[key] = single
  }
  return flat
}

/**
 * Operations orders board (plan §6-S14 step 1). Filters and paging live in the
 * query string, so a filtered board is a shareable URL and the back button
 * behaves. An unparseable query is a 404 rather than a crash.
 */
export default async function OpsBoardPage({
  searchParams,
}: {
  searchParams: Promise<Query>
}) {
  const operator = await requireOperator()
  if (!operator.ok) notFound()

  const query = firstValues(await searchParams)
  const parsed = parseOpsOrderFilter(query)
  if (!parsed.success) notFound()

  const db = getServiceDb()
  const [page, printers] = await Promise.all([listOpsOrders(db, parsed.data), listPrinters(db)])
  if (!page.ok) notFound()

  const printerRows = printers.ok ? printers.value : []
  const printerOptions: FilterOption[] = printerRows.map((p) => ({ value: p.id, label: p.name }))
  const printerNames = Object.fromEntries(printerRows.map((p) => [p.id, p.name]))

  const { page: _page, ...filterQuery } = query

  return (
    <div className="space-y-6">
      <PageHeader title={opsContent.boardTitle} description={opsContent.boardIntro} />
      <OrderFilters filter={parsed.data} printers={printerOptions} />
      <OrdersTable orders={page.value.rows} printerNames={printerNames} />
      <BoardPager page={parsed.data.page} hasMore={page.value.hasMore} query={filterQuery} />
    </div>
  )
}
