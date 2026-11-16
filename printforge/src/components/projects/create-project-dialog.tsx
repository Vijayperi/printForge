"use client"

import { useState, useTransition } from "react"

import type { ProjectFormState } from "@/app/(studio)/projects/actions"
import { FieldError, FormError } from "@/src/components/auth/forms"
import { Button } from "@/src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"

export type ProjectAction = (
  prev: ProjectFormState,
  formData: FormData
) => Promise<ProjectFormState>

export function CreateProjectDialog({ action }: { action: ProjectAction }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ProjectFormState>({})
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await action({}, formData)
      if (result.done === true) {
        setOpen(false)
        setState({})
      } else {
        setState(result)
      }
    })
  }

  const titleErrors = state.fieldErrors?.["title"]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a project</DialogTitle>
          <DialogDescription>Give your project a name to get started.</DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4" aria-label="Create project">
          <FormError message={state.formError} />
          <div className="space-y-1.5">
            <Label htmlFor="new-project-title">Project name</Label>
            <Input
              id="new-project-title"
              name="title"
              aria-invalid={titleErrors !== undefined ? true : undefined}
              aria-describedby={titleErrors !== undefined ? "new-project-title-error" : undefined}
            />
            <FieldError id="new-project-title-error" messages={titleErrors} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
