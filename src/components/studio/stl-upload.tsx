"use client"

import { useTransition, type FormEvent } from "react"
import { useState } from "react"

import { FormError } from "@/src/components/auth/forms"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"

export function StlUpload({
  projectId,
  onUploaded,
}: {
  projectId: string
  onUploaded: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formEl = event.currentTarget
    const input = formEl.elements.namedItem("file") as HTMLInputElement | null
    const file = input?.files?.[0]
    if (input === null || file === undefined) {
      setError("Choose an .stl file to upload.")
      return
    }
    const form = new FormData()
    form.set("file", file)
    form.set("projectId", projectId)

    startTransition(async () => {
      const res = await fetch("/api/uploads/stl", { method: "POST", body: form })
      if (res.ok) {
        input.value = "" // the only legal assignment to a file input; clears it
        onUploaded()
        return
      }
      const problem = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      setError(problem?.error?.message ?? "Upload failed. Please try again.")
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border p-4" aria-label="Upload STL">
      <div className="space-y-1.5">
        <Label htmlFor="stl-file">Upload your own STL</Label>
        <Input id="stl-file" name="file" type="file" accept=".stl" />
      </div>
      <FormError message={error ?? undefined} />
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload STL"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Upload your own .stl to print — it goes through the same printability checks.
      </p>
    </form>
  )
}
