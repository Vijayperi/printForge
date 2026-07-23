"use client"

import type { DesignVersionRow } from "@/src/domain/types"
import { Badge } from "@/src/components/ui/badge"
import { cn } from "@/src/lib/utils"

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ready: "default",
  failed: "destructive",
  queued: "secondary",
  creating: "secondary",
}

function excerpt(prompt: string | null): string {
  if (prompt === null || prompt.trim().length === 0) return "Untitled version"
  return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt
}

export function VersionHistory({
  versions,
  selectedId,
  onSelect,
}: {
  versions: DesignVersionRow[]
  selectedId: string | null
  onSelect: (version: DesignVersionRow) => void
}) {
  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">No versions yet. Generate one to get started.</p>
  }
  return (
    <ul className="flex list-none flex-col gap-2 p-0" aria-label="Version history">
      {versions.map((version) => (
        <li key={version.id}>
          <button
            type="button"
            onClick={() => onSelect(version)}
            aria-current={version.id === selectedId}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors hover:bg-muted",
              version.id === selectedId && "border-primary bg-muted"
            )}
          >
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">
              {version.thumbnail_asset_id !== null ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/assets/${version.thumbnail_asset_id}`}
                  alt={`Version ${version.version_no} thumbnail`}
                  className="size-full object-cover"
                />
              ) : (
                <span className="text-xs text-muted-foreground">v{version.version_no}</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{excerpt(version.prompt)}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(version.created_at).toLocaleDateString()}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {version.source === "uploaded" ? <Badge variant="outline">Uploaded</Badge> : null}
              <Badge variant={STATUS_VARIANT[version.generation_status] ?? "secondary"}>
                {version.generation_status}
              </Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
