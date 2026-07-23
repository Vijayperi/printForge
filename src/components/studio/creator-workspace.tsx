"use client"

import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"

import { CreationPanel } from "@/src/components/studio/creation-panel"
import { StlUpload } from "@/src/components/studio/stl-upload"
import { VersionHistory } from "@/src/components/studio/version-history"
import { WorkspaceViewer } from "@/src/components/studio/workspace-viewer"
import { Button } from "@/src/components/ui/button"
import type { DesignVersionRow, ProjectRow, StructuredBrief } from "@/src/domain/types"

function defaultVersion(versions: DesignVersionRow[]): DesignVersionRow | null {
  return versions.find((version) => version.generation_status === "ready") ?? versions[0] ?? null
}

export function CreatorWorkspace({
  project,
  versions,
}: {
  project: ProjectRow
  versions: DesignVersionRow[]
}) {
  const router = useRouter()
  // The user's explicit pick, if any; otherwise selection is derived from the
  // current versions so a freshly-ready model is shown after a refresh (no
  // setState-in-effect).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refine, setRefine] = useState<{ brief: StructuredBrief | null; key: number }>({
    brief: null,
    key: 0,
  })

  const selected =
    versions.find((version) => version.id === selectedId) ?? defaultVersion(versions)

  const onGenerated = useCallback(() => {
    router.refresh()
  }, [router])

  const refinableBrief = selected?.brief_json ?? null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="order-1 space-y-3 lg:order-2">
        <WorkspaceViewer version={selected} projectTitle={project.title} />
      </section>

      <section className="order-2 space-y-8 lg:order-1">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Create</h2>
          <CreationPanel
            key={refine.key}
            projectId={project.id}
            initialBrief={refine.brief}
            onGenerated={onGenerated}
          />
          <StlUpload projectId={project.id} onUploaded={onGenerated} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Versions</h3>
            {refinableBrief !== null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefine((previous) => ({ brief: refinableBrief, key: previous.key + 1 }))}
              >
                Refine selected
              </Button>
            ) : null}
          </div>
          <VersionHistory
            versions={versions}
            selectedId={selected?.id ?? null}
            onSelect={(version) => setSelectedId(version.id)}
          />
        </div>
      </section>
    </div>
  )
}
