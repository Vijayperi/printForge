"use client"

import { useState, useTransition } from "react"

import type { ProjectFormState } from "@/app/(studio)/projects/actions"
import type { ProjectAction } from "@/src/components/projects/create-project-dialog"
import { FieldError, FormError } from "@/src/components/auth/forms"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog"
import { Badge } from "@/src/components/ui/badge"
import { Button } from "@/src/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/src/components/ui/card"
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
import type { ProjectRow } from "@/src/domain/types"

export function ProjectCard({
  project,
  renameAction,
  archiveAction,
}: {
  project: ProjectRow
  renameAction: ProjectAction
  archiveAction: ProjectAction
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameState, setRenameState] = useState<ProjectFormState>({})
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveState, setArchiveState] = useState<ProjectFormState>({})
  const [pending, startTransition] = useTransition()

  function submit(
    action: ProjectAction,
    setState: (s: ProjectFormState) => void,
    setOpen: (open: boolean) => void
  ) {
    return (formData: FormData) => {
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
  }

  const titleErrors = renameState.fieldErrors?.["title"]
  const isArchived = project.status === "archived"

  return (
    <Card data-testid="project-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{project.title}</span>
          <Badge variant={isArchived ? "outline" : "secondary"}>{project.status}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Open this project to generate and configure a model.
      </CardContent>
      <CardFooter className="gap-2">
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Rename
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>Choose a new name for “{project.title}”.</DialogDescription>
            </DialogHeader>
            <form
              action={submit(renameAction, setRenameState, setRenameOpen)}
              className="space-y-4"
              aria-label="Rename project"
            >
              <input type="hidden" name="id" value={project.id} />
              <FormError message={renameState.formError} />
              <div className="space-y-1.5">
                <Label htmlFor={`rename-${project.id}`}>Project name</Label>
                <Input
                  id={`rename-${project.id}`}
                  name="title"
                  defaultValue={project.title}
                  aria-invalid={titleErrors !== undefined ? true : undefined}
                  aria-describedby={titleErrors !== undefined ? `rename-${project.id}-error` : undefined}
                />
                <FieldError id={`rename-${project.id}-error`} messages={titleErrors} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={isArchived}>
              Archive
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this project?</AlertDialogTitle>
              <AlertDialogDescription>
                “{project.title}” will be moved to your archive. You can still view it later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form action={submit(archiveAction, setArchiveState, setArchiveOpen)}>
              <input type="hidden" name="id" value={project.id} />
              <FormError message={archiveState.formError} />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {/* A plain submit button (not AlertDialogAction, which would
                    auto-close) so a failed archive keeps the dialog open. */}
                <Button type="submit" variant="destructive" size="sm" disabled={pending}>
                  Archive
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  )
}
