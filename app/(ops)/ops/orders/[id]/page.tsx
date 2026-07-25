import { notFound } from "next/navigation"

import { ORDER_NOTE_ACTION } from "@/app/api/ops/orders/[id]/notes/route"
import { OrderSummary } from "@/src/components/checkout/order-summary"
import { PageHeader } from "@/src/components/layout/primitives"
import { NotesThread, type OrderNote } from "@/src/components/ops/notes-thread"
import { ReviewActions } from "@/src/components/ops/review-actions"
import { Badge } from "@/src/components/ui/badge"
import { opsContent } from "@/src/config/content"
import { listAuditEventsByEntity } from "@/src/data/auditEvents"
import { getDesignVersion } from "@/src/data/designVersions"
import { listNotificationsByOrder } from "@/src/data/notificationLog"
import { getOrder } from "@/src/data/orders"
import { getQuote } from "@/src/data/quotes"
import { getServiceDb } from "@/src/data/supabaseClients"
import { getLatestValidationReport } from "@/src/data/validationReports"
import { readFrozenConfig } from "@/src/domain/checkout/frozenConfig"
import { readStoredAddress, readStoredContact } from "@/src/domain/checkout/schema"
import { orderCustomerLabel, type OrderState } from "@/src/domain/stateMachines/order"
import type { Finding } from "@/src/domain/types"
import { requireOperator } from "@/src/lib/opsAuth"

/** Audit rows that are operator notes, newest last so the thread reads forward. */
function notesFrom(rows: { id: string; action: string; metadata: Record<string, unknown>; created_at: string }[]): OrderNote[] {
  return rows
    .filter((row) => row.action === ORDER_NOTE_ACTION)
    .map((row) => ({
      id: row.id,
      note: String(row.metadata["note"] ?? ""),
      author: String(row.metadata["authorEmail"] ?? "operator"),
      createdAt: row.created_at,
    }))
    .reverse()
}

/**
 * Operator order detail (plan §6-S14 step 2 + 3). Everything the customer sees,
 * plus the raw validation findings, slice metadata, payment axis, the audit
 * trail, the notification log, and the review controls.
 */
export default async function OpsOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const operator = await requireOperator()
  if (!operator.ok) notFound()
  const { id } = await params

  const db = getServiceDb()
  const order = await getOrder(db, id)
  if (!order.ok || order.value === null) notFound()

  const [quote, dv, report, audits, notifications] = await Promise.all([
    getQuote(db, order.value.quote_id),
    getDesignVersion(db, order.value.frozen_dv_id),
    getLatestValidationReport(db, order.value.frozen_dv_id),
    listAuditEventsByEntity(db, "order", id),
    listNotificationsByOrder(db, id),
  ])

  const config = readFrozenConfig(order.value.frozen_config_json)
  const contact = readStoredContact(order.value.contact_json)
  const address = readStoredAddress(order.value.shipping_address_json)
  const auditRows = audits.ok ? audits.value : []
  const findings: Finding[] =
    report.ok && report.value !== null ? (report.value.findings_json as Finding[]) : []
  const slice = quote.ok && quote.value !== null ? quote.value.slice_json : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.value.id}
        description={`${contact.name} · ${contact.email} · ${orderCustomerLabel(order.value.status as OrderState)}`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <OrderSummary
            heading={opsContent.configHeading}
            thumbnailAssetId={dv.ok && dv.value !== null ? dv.value.thumbnail_asset_id : null}
            config={config}
            breakdown={quote.ok && quote.value !== null ? quote.value.breakdown_json : []}
            totalMinor={quote.ok && quote.value !== null ? quote.value.amount_minor : 0}
            totalLabel="Order total"
          />

          <section aria-labelledby="ops-findings-heading" className="space-y-2">
            <h2 id="ops-findings-heading" className="text-sm font-semibold">
              {opsContent.findingsHeading}
              {report.ok && report.value !== null ? (
                <Badge variant="secondary" className="ml-2">
                  {report.value.status}
                </Badge>
              ) : null}
            </h2>
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{opsContent.findingsEmpty}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {findings.map((finding, index) => (
                  <li key={`${finding.kind}-${index}`} className="rounded border p-2">
                    <span className="font-medium">{finding.kind}</span>{" "}
                    <span className="text-muted-foreground">({finding.severity})</span>
                    {finding.detail === undefined ? null : (
                      <span className="block text-muted-foreground">{finding.detail}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ops-slice-heading" className="space-y-1 text-sm">
            <h2 id="ops-slice-heading" className="text-sm font-semibold">
              {opsContent.sliceHeading}
            </h2>
            {slice === null ? (
              <p className="text-muted-foreground">No slice recorded.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4">
                {Object.entries(slice).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="text-right tabular-nums">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <ReviewActions
            orderId={order.value.id}
            state={order.value.status as OrderState}
            heldFrom={order.value.held_from_status as OrderState | null}
          />

          <section aria-labelledby="ops-payment-heading" className="space-y-1 text-sm">
            <h2 id="ops-payment-heading" className="text-sm font-semibold">
              {opsContent.paymentHeading}
            </h2>
            <dl className="grid grid-cols-2 gap-x-4">
              <dt className="text-muted-foreground">Axis</dt>
              <dd className="text-right">{order.value.payment_status}</dd>
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="text-right">{order.value.payment_ref ?? opsContent.unassigned}</dd>
              <dt className="text-muted-foreground">Ships to</dt>
              <dd className="text-right">
                {address.city}, {address.state} {address.pincode}
              </dd>
            </dl>
          </section>

          <NotesThread orderId={order.value.id} notes={notesFrom(auditRows)} />

          <section aria-labelledby="ops-notifications-heading" className="space-y-2">
            <h2 id="ops-notifications-heading" className="text-sm font-semibold">
              {opsContent.notificationsHeading}
            </h2>
            {!notifications.ok || notifications.value.length === 0 ? (
              <p className="text-sm text-muted-foreground">{opsContent.notificationsEmpty}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {notifications.value.map((row) => (
                  <li key={row.id} className="flex justify-between rounded border p-2">
                    <span>{row.template}</span>
                    <span className="text-muted-foreground">{row.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
