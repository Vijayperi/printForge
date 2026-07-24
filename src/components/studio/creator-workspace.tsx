"use client"

import { useRouter } from "next/navigation"
import { useCallback, useState, type ReactNode } from "react"

import { ConfigurePanel, type LiveConfig } from "@/src/components/studio/configure-panel"
import { CreationPanel } from "@/src/components/studio/creation-panel"
import { PrintabilityPanel } from "@/src/components/studio/printability-panel"
import { QuotePanel } from "@/src/components/studio/quote-panel"
import { StlUpload } from "@/src/components/studio/stl-upload"
import { VersionHistory } from "@/src/components/studio/version-history"
import { WorkspaceViewer } from "@/src/components/studio/workspace-viewer"
import { Button } from "@/src/components/ui/button"
import type { DesignVersionRow, ProjectRow, StructuredBrief } from "@/src/domain/types"

const NEUTRAL_LIVE: LiveConfig = { swatchColor: null, scaleFactor: 1 }
type WorkspaceTab = "printability" | "configure" | "quote"

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
  const [tab, setTab] = useState<WorkspaceTab>("printability")
  const [live, setLive] = useState<LiveConfig>(NEUTRAL_LIVE)

  const selected =
    versions.find((version) => version.id === selectedId) ?? defaultVersion(versions)

  const onGenerated = useCallback(() => {
    router.refresh()
  }, [router])

  const refinableBrief = selected?.brief_json ?? null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="order-1 space-y-4 lg:order-2">
        <WorkspaceViewer
          version={selected}
          projectTitle={project.title}
          swatchColor={live.swatchColor}
          scaleFactor={live.scaleFactor}
        />
        {selected !== null ? (
          <div className="space-y-3">
            <div role="tablist" aria-label="Model details" className="flex gap-1 border-b">
              <TabButton id="printability" active={tab === "printability"} onSelect={setTab}>
                Printability
              </TabButton>
              <TabButton id="configure" active={tab === "configure"} onSelect={setTab}>
                Configure
              </TabButton>
              <TabButton id="quote" active={tab === "quote"} onSelect={setTab}>
                Quote
              </TabButton>
            </div>
            <div
              role="tabpanel"
              id="panel-printability"
              aria-labelledby="tab-printability"
              hidden={tab !== "printability"}
            >
              <PrintabilityPanel key={selected.id} designVersionId={selected.id} />
            </div>
            <div
              role="tabpanel"
              id="panel-configure"
              aria-labelledby="tab-configure"
              hidden={tab !== "configure"}
            >
              <ConfigurePanel key={selected.id} designVersionId={selected.id} onLiveChange={setLive} />
            </div>
            <div
              role="tabpanel"
              id="panel-quote"
              aria-labelledby="tab-quote"
              hidden={tab !== "quote"}
            >
              <QuotePanel key={selected.id} designVersionId={selected.id} />
            </div>
          </div>
        ) : null}
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

function TabButton({
  id,
  active,
  onSelect,
  children,
}: {
  id: WorkspaceTab
  active: boolean
  onSelect: (id: WorkspaceTab) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      onClick={() => onSelect(id)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
      }`}
    >
      {children}
    </button>
  )
}
