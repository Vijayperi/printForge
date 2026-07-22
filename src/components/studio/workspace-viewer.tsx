"use client"

import type { DesignVersionRow } from "@/src/domain/types"
import { ViewerWorkspace } from "@/src/viewer/ViewerWorkspace"

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full min-h-[320px] place-items-center rounded-xl border bg-muted/30 p-8 text-center">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

export function WorkspaceViewer({
  version,
  projectTitle,
}: {
  version: DesignVersionRow | null
  projectTitle: string
}) {
  if (version === null) {
    return (
      <Placeholder
        title="No model yet"
        body="Describe what you want to create to generate your first 3D model."
      />
    )
  }
  if (version.generation_status === "ready" && version.glb_asset_id !== null) {
    return <ViewerWorkspace url={`/api/assets/${version.glb_asset_id}`} projectTitle={projectTitle} />
  }
  if (version.generation_status === "failed") {
    return (
      <Placeholder
        title="Generation failed"
        body="This version couldn’t be generated. Adjust your prompt and try again."
      />
    )
  }
  return (
    <Placeholder
      title="Generating…"
      body="Your model is being created. This usually takes about a minute."
    />
  )
}
