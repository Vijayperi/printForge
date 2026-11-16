"use client"

import { useEffect, useState } from "react"

import { Badge } from "@/src/components/ui/badge"
import { printabilityContent } from "@/src/config/content"
import type { Finding, Measurements, Verdict } from "@/src/domain/types"

const POLL_INTERVAL_MS = 2000

type ReportState =
  | { status: "pending" }
  | { status: Verdict; findings: Finding[]; measurements: Measurements | null }

const VERDICT_TONE: Record<Verdict, string> = {
  pass: "border-transparent bg-emerald-600 text-white",
  warning: "border-transparent bg-amber-500 text-black",
  manual_review: "border-transparent bg-sky-600 text-white",
  fail: "border-transparent bg-red-600 text-white",
}

function isPending(state: ReportState): state is { status: "pending" } {
  return state.status === "pending"
}

/**
 * Customer-facing printability report (plan §6-S10 step 4). Polls the validation
 * report for the current design version and renders the verdict (icon + text,
 * never colour alone), plain-language findings, and what to do next. Repair
 * proposals (e.g. flipped surfaces) are shown as suggestions — the model is
 * never altered automatically.
 */
export function PrintabilityPanel({ designVersionId }: { designVersionId: string }) {
  const [state, setState] = useState<ReportState>({ status: "pending" })

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    // Self-rescheduling poll: fetch, and only queue the next poll while the
    // report is still pending. Reset between design versions comes from the
    // `key` the workspace sets, so the effect never sets state synchronously.
    const poll = async (): Promise<void> => {
      const res = await fetch(`/api/design-versions/${designVersionId}/validation`)
      const body = res.ok ? ((await res.json()) as ReportState) : null
      if (!active) return
      if (body !== null) {
        setState(body)
        if (body.status !== "pending") return
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
    }

    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [designVersionId])

  const content = printabilityContent

  return (
    <section id="printability" aria-labelledby="printability-heading" className="space-y-3">
      <h3 id="printability-heading" className="text-lg font-semibold">
        {content.title}
      </h3>

      {isPending(state) ? (
        <p className="text-sm text-muted-foreground" role="status">
          {content.pendingLabel}
        </p>
      ) : (
        <Report state={state} />
      )}
    </section>
  )
}

function Report({
  state,
}: {
  state: { status: Verdict; findings: Finding[]; measurements: Measurements | null }
}) {
  const content = printabilityContent
  const verdict = content.verdicts[state.status]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge className={VERDICT_TONE[state.status]} aria-live="polite">
          <span aria-hidden="true">{verdict.icon}</span> {verdict.label}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{verdict.whatNext}</p>

      {state.findings.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{content.findingsHeading}</h4>
          <ul className="space-y-2">
            {state.findings.map((finding, i) => {
              const copy = content.findings[finding.kind]
              return (
                <li key={`${finding.kind}-${i}`} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{copy.label}</p>
                  <p className="text-muted-foreground">{copy.explanation}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{finding.detail}</p>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {state.measurements !== null ? (
        <p className="text-xs text-muted-foreground">
          {measurementSummary(state.measurements)}
        </p>
      ) : null}
    </div>
  )
}

function measurementSummary(m: Measurements): string {
  const { x, y, z } = m.boundingMm
  return `Size ${round(x)}×${round(y)}×${round(z)} mm · ${m.volumeCm3.toFixed(1)} cm³ · ${m.triangleCount.toLocaleString()} triangles`
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
