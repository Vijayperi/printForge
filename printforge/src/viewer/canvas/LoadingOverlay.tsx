import type { ViewerStatus } from "@/src/viewer/logic/types"

export interface LoadingOverlayProps {
  status: ViewerStatus
  progress: number
}

/** DOM overlay for load progress / error, shown over the canvas. */
export function LoadingOverlay({ status, progress }: LoadingOverlayProps) {
  if (status === "ready") return null
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60 text-sm">
      {status === "loading" ? (
        <p>Loading model… {Math.round(progress)}%</p>
      ) : (
        <p role="alert" className="text-destructive">
          We couldn&rsquo;t load the 3D model. Please try regenerating it.
        </p>
      )}
    </div>
  )
}
