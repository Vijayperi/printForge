"use client"

import { useEffect, useState, type FormEvent } from "react"

import { FormError } from "@/src/components/auth/forms"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import type { StructuredBrief } from "@/src/domain/types"

const DURABILITIES: Array<{ value: StructuredBrief["durability"]; label: string }> = [
  { value: "display", label: "Display only" },
  { value: "everyday", label: "Everyday use" },
  { value: "reinforced", label: "Reinforced" },
]

const POLL_INTERVAL_MS = 1500

type Phase = "idle" | "submitting" | "queued" | "creating" | "ready" | "failed"

const STATUS_LABEL: Record<Phase, string> = {
  idle: "",
  submitting: "Submitting…",
  queued: "Queued",
  creating: "Generating…",
  ready: "Ready",
  failed: "Failed",
}

export function CreationPanel({
  projectId,
  initialBrief,
  onGenerated,
}: {
  projectId: string
  initialBrief: StructuredBrief | null
  onGenerated: () => void
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [formError, setFormError] = useState<string | null>(null)
  const [pollingId, setPollingId] = useState<string | null>(null)

  useEffect(() => {
    if (pollingId === null) return
    const interval = setInterval(() => {
      void (async () => {
        const res = await fetch(`/api/generations/${pollingId}`)
        if (!res.ok) return
        const body = (await res.json()) as { status: Phase }
        setPhase(body.status)
        if (body.status === "ready") {
          clearInterval(interval)
          setPollingId(null)
          onGenerated()
        } else if (body.status === "failed") {
          clearInterval(interval)
          setPollingId(null)
        }
      })()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [pollingId, onGenerated])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setFormError(null)
    setPhase("submitting")

    // Every field is a present, named text input, so form.get returns a string.
    const body = {
      rawPrompt: form.get("rawPrompt") as string,
      intendedUse: form.get("intendedUse") as string,
      approxSizeMm: Number(form.get("approxSizeMm")),
      style: form.get("style") as string,
      durability: form.get("durability") as string,
      materialPref: form.get("materialPref") as string,
      colorPref: form.get("colorPref") as string,
    }

    const res = await fetch(`/api/projects/${projectId}/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

    if (res.status === 202) {
      const { designVersionId } = (await res.json()) as { designVersionId: string }
      setPhase("queued")
      setPollingId(designVersionId)
      return
    }
    setPhase("idle")
    if (res.status === 429) {
      setFormError("You’ve reached the generation limit for now. Please wait and try again.")
      return
    }
    const problem = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    setFormError(problem?.error?.message ?? "Something went wrong. Please try again.")
  }

  const busy = phase === "submitting" || pollingId !== null

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Create a model">
      <FormError message={formError ?? undefined} />

      <div className="space-y-1.5">
        <Label htmlFor="rawPrompt">What would you like to create?</Label>
        <Textarea
          id="rawPrompt"
          name="rawPrompt"
          required
          rows={3}
          defaultValue={initialBrief?.rawPrompt ?? ""}
          placeholder="A friendly dinosaur pen holder…"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="intendedUse">Intended use</Label>
          <Input id="intendedUse" name="intendedUse" required defaultValue={initialBrief?.intendedUse ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="approxSizeMm">Approx. size (mm)</Label>
          <Input
            id="approxSizeMm"
            name="approxSizeMm"
            type="number"
            min={1}
            required
            defaultValue={initialBrief?.approxSizeMm ?? 80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="style">Style</Label>
          <Input id="style" name="style" required defaultValue={initialBrief?.style ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="durability">Durability</Label>
          <select
            id="durability"
            name="durability"
            defaultValue={initialBrief?.durability ?? "display"}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {DURABILITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="materialPref">Material preference (optional)</Label>
          <Input id="materialPref" name="materialPref" defaultValue={initialBrief?.materialPref ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="colorPref">Colour preference (optional)</Label>
          <Input id="colorPref" name="colorPref" defaultValue={initialBrief?.colorPref ?? ""} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {initialBrief === null ? "Generate" : "Regenerate"}
        </Button>
        {phase !== "idle" ? (
          <Badge variant={phase === "failed" ? "destructive" : "secondary"} aria-live="polite">
            {STATUS_LABEL[phase]}
          </Badge>
        ) : null}
        {phase === "failed" ? (
          <span className="text-sm text-muted-foreground">Generation failed — adjust and try again.</span>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Each generation may use credits or count toward your usage limit.
      </p>
    </form>
  )
}
