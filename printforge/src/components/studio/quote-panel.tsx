"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/src/components/ui/button"
import { commerce } from "@/src/config/commerce"
import { quoteContent } from "@/src/config/content"
import type { QuoteBreakdownLine } from "@/src/domain/types"
import { formatINR, inr } from "@/src/lib/money"

const POLL_MS = 2000

export interface QuoteDto {
  id: string
  amountMinor: number
  currency: string
  breakdown: QuoteBreakdownLine[]
  slice: { durationMinutes: number; materialGrams: number; supportsUsed: boolean } | null
  expiresAt: string
}

type View =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ready"; quote: QuoteDto }
  | { kind: "unavailable"; message: string }

/** Humanise a whole-minute duration, e.g. 150 → "2h 30m", 45 → "45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Deterministic UTC formatting of a quote's expiry timestamp. */
export function formatExpiry(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso))
}

function dayRange(w: { minDays: number; maxDays: number }): string {
  return `${w.minDays}–${w.maxDays} ${quoteContent.daysSuffix}`
}

/**
 * Quote tab (plan §6-S12 step 4). Action-driven: "Get a quote" POSTs the current
 * configuration; a 202 shows a slicing skeleton and polls until the quote lands.
 * The breakdown, estimated print time, SLA windows and expiry render on success.
 * Checkout is a disabled placeholder until S13.
 */
export function QuotePanel({ designVersionId }: { designVersionId: string }) {
  const [view, setView] = useState<View>({ kind: "idle" })
  const [requestNonce, setRequestNonce] = useState(0)
  const url = `/api/design-versions/${designVersionId}/quote`

  // Each request (nonce bump) POSTs for a quote; a 200 renders it, a 4xx explains
  // why it can't, and a 202 polls the quote until the slice lands.
  useEffect(() => {
    if (requestNonce === 0) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async (): Promise<void> => {
      const res = await fetch(url)
      const body = res.ok ? ((await res.json()) as { status: string; quote?: QuoteDto }) : null
      if (!active) return
      if (body !== null && body.status === "ready" && body.quote !== undefined) {
        setView({ kind: "ready", quote: body.quote })
        return
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }

    void (async () => {
      const res = await fetch(url, { method: "POST" })
      const body = res.status === 202 ? null : await res.json()
      if (!active) return
      if (res.status === 202) {
        await poll()
        return
      }
      if (res.ok) setView({ kind: "ready", quote: body.quote as QuoteDto })
      else setView({ kind: "unavailable", message: body?.error?.message ?? "This model can’t be quoted yet." })
    })()

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [requestNonce, url])

  const request = (): void => {
    setView({ kind: "working" })
    setRequestNonce((n) => n + 1)
  }

  return (
    <section aria-labelledby="quote-heading" className="space-y-4">
      <div className="space-y-1">
        <h3 id="quote-heading" className="text-lg font-semibold">
          {quoteContent.title}
        </h3>
        <p className="text-sm text-muted-foreground">{quoteContent.intro}</p>
      </div>

      {view.kind === "working" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {quoteContent.pendingLabel}
        </p>
      ) : null}

      {view.kind === "unavailable" ? (
        <p role="alert" className="text-sm text-destructive">
          {view.message}
        </p>
      ) : null}

      {view.kind === "ready" ? <Ready quote={view.quote} /> : null}

      {view.kind !== "working" ? (
        <Button type="button" onClick={request}>
          {view.kind === "ready" ? quoteContent.requote : quoteContent.getQuote}
        </Button>
      ) : null}
    </section>
  )
}

function Ready({ quote }: { quote: QuoteDto }) {
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <caption className="sr-only">{quoteContent.breakdownHeading}</caption>
        <tbody>
          {quote.breakdown.map((line) => (
            <tr key={line.key} className="border-b last:border-0">
              <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                {line.label}
              </th>
              <td className="py-1 text-right tabular-nums">{formatINR(line.amount)}</td>
            </tr>
          ))}
          <tr className="border-t-2">
            <th scope="row" className="py-2 text-left font-semibold">
              {quoteContent.totalLabel}
            </th>
            <td className="py-2 text-right font-semibold tabular-nums">{formatINR(inr(quote.amountMinor))}</td>
          </tr>
        </tbody>
      </table>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        {quote.slice !== null ? (
          <>
            <dt className="text-muted-foreground">{quoteContent.durationLabel}</dt>
            <dd className="text-right tabular-nums">{formatDuration(quote.slice.durationMinutes)}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">{quoteContent.productionLabel}</dt>
        <dd className="text-right">{dayRange(commerce.productionWindow)}</dd>
        <dt className="text-muted-foreground">{quoteContent.deliveryLabel}</dt>
        <dd className="text-right">{dayRange(commerce.deliveryWindow)}</dd>
        <dt className="text-muted-foreground">{quoteContent.validUntilLabel}</dt>
        <dd className="text-right">{formatExpiry(quote.expiresAt)}</dd>
      </dl>

      <p className="text-xs text-muted-foreground">{quoteContent.disclaimer}</p>

      <Button asChild className="w-full">
        <Link href={`/checkout?quoteId=${encodeURIComponent(quote.id)}`}>
          {quoteContent.proceed}
        </Link>
      </Button>
    </div>
  )
}
