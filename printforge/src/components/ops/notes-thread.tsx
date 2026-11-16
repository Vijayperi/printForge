"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/src/components/ui/button"
import { Label } from "@/src/components/ui/label"
import { Textarea } from "@/src/components/ui/textarea"
import { opsContent } from "@/src/config/content"

export interface OrderNote {
  id: string
  note: string
  author: string
  createdAt: string
}

/**
 * Append-only operator notes (plan §6-S14 step 2). There is no edit and no
 * delete — the thread is `audit_events` rows, which the database refuses to
 * mutate.
 */
export function NotesThread({ orderId, notes }: { orderId: string; notes: OrderNote[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    const response = await fetch(`/api/ops/orders/${orderId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: draft }),
    })
    setBusy(false)
    if (!response.ok) {
      setError("That note could not be saved.")
      return
    }
    setDraft("")
    setError(null)
    router.refresh()
  }

  return (
    <section aria-labelledby="ops-notes-heading" className="space-y-3">
      <h2 id="ops-notes-heading" className="text-sm font-semibold">
        {opsContent.notesHeading}
      </h2>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{opsContent.notesEmpty}</p>
      ) : (
        <ol className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border p-3 text-sm">
              <p>{note.note}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {note.author} · {new Date(note.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
              </p>
            </li>
          ))}
        </ol>
      )}

      <div className="space-y-2">
        <Label htmlFor="ops-note">{opsContent.noteLabel}</Label>
        <Textarea id="ops-note" value={draft} onChange={(event) => setDraft(event.target.value)} />
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={busy || draft.trim() === ""}
          onClick={() => void submit()}
        >
          {opsContent.noteSubmit}
        </Button>
      </div>
    </section>
  )
}
