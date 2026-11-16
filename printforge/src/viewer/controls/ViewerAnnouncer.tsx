import type { ViewerMode, ViewerStatus } from "@/src/viewer/logic/types"

export interface ViewerAnnouncerProps {
  status: ViewerStatus
  mode: ViewerMode
}

function message(status: ViewerStatus, mode: ViewerMode): string {
  switch (status) {
    case "loading":
      return "Loading model…"
    case "error":
      return "Failed to load the model."
    case "ready":
      return `Model ready. ${mode === "visual" ? "Visual" : "Technical mesh"} view.`
  }
}

export function ViewerAnnouncer({ status, mode }: ViewerAnnouncerProps) {
  return (
    <div role="status" aria-live="polite" className="sr-only" data-slot="viewer-announcer">
      {message(status, mode)}
    </div>
  )
}
