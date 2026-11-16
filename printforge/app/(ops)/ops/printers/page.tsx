import { notFound } from "next/navigation"

import { PageHeader } from "@/src/components/layout/primitives"
import { PrintersTable } from "@/src/components/ops/printers-table"
import { opsContent } from "@/src/config/content"
import { listPrinters } from "@/src/data/printers"
import { listHeldPrintJobs } from "@/src/data/printJobs"
import { getServiceDb } from "@/src/data/supabaseClients"
import { fleetRows } from "@/src/domain/ops/fleet"
import { requireOperator } from "@/src/lib/opsAuth"

/**
 * The fleet (plan §6-S15 step 4). States are the ones the status poller last
 * recorded, so this page reads the `printers` table and never the gateway —
 * printer credentials stay in the worker's half of the app (FR-9).
 */
export default async function OpsPrintersPage() {
  const operator = await requireOperator()
  if (!operator.ok) notFound()

  const db = getServiceDb()
  const [printers, held] = await Promise.all([listPrinters(db), listHeldPrintJobs(db)])

  return (
    <div className="space-y-6">
      <PageHeader title={opsContent.fleetTitle} description={opsContent.fleetIntro} />
      <PrintersTable
        printers={fleetRows(printers.ok ? printers.value : [], held.ok ? held.value : [])}
      />
    </div>
  )
}
