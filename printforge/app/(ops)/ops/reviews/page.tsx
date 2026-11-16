import { notFound } from "next/navigation"

import { PageHeader } from "@/src/components/layout/primitives"
import { ReviewDecision } from "@/src/components/ops/review-decision"
import { opsContent } from "@/src/config/content"
import { getServiceDb } from "@/src/data/supabaseClients"
import { listValidationReportsByStatus } from "@/src/data/validationReports"
import type { Finding } from "@/src/domain/types"

import { requireOperator } from "@/src/lib/opsAuth"

/**
 * Manual-review queue (plan §6-S14 step 3): the reports the automated decision
 * table refused to call either way. Oldest first — the queue is worked in
 * arrival order.
 */
export default async function OpsReviewsPage() {
  const operator = await requireOperator()
  if (!operator.ok) notFound()

  const reports = await listValidationReportsByStatus(getServiceDb(), "manual_review")
  const rows = reports.ok ? reports.value : []

  return (
    <div className="space-y-6">
      <PageHeader title={opsContent.queueTitle} description={opsContent.queueIntro} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {opsContent.queueEmpty}
        </p>
      ) : (
        <ul className="list-none space-y-4 p-0">
          {rows.map((report) => {
            const findings = report.findings_json as Finding[]
            return (
              <li key={report.id} className="space-y-3 rounded-xl border p-4">
                <div>
                  <p className="font-medium">{report.design_version_id}</p>
                  <p className="text-xs text-muted-foreground">
                    {report.printer_profile_id} · {new Date(report.created_at).toISOString().slice(0, 10)}
                  </p>
                </div>

                {findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{opsContent.findingsEmpty}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {findings.map((finding, index) => (
                      <li key={`${finding.kind}-${index}`}>
                        <span className="font-medium">{finding.kind}</span>{" "}
                        <span className="text-muted-foreground">({finding.severity})</span>
                      </li>
                    ))}
                  </ul>
                )}

                <ReviewDecision reportId={report.id} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
