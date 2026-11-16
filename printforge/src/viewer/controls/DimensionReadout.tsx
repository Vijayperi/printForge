import type { Vec3 } from "@/src/viewer/logic/types"

export interface DimensionReadoutProps {
  dimensionsMm: Vec3 | null
}

const AXES: Array<{ key: keyof Vec3; label: string }> = [
  { key: "x", label: "Width" },
  { key: "y", label: "Height" },
  { key: "z", label: "Depth" },
]

function format(mm: number): string {
  return `${mm.toFixed(1)} mm`
}

export function DimensionReadout({ dimensionsMm }: DimensionReadoutProps) {
  if (dimensionsMm === null) {
    return (
      <p className="text-sm text-muted-foreground" data-slot="dimension-readout">
        Dimensions unavailable
      </p>
    )
  }
  return (
    <div
      data-slot="dimension-readout"
      role="group"
      aria-label="Model dimensions"
      className="flex gap-4 text-sm"
    >
      {AXES.map(({ key, label }) => (
        <span key={key} className="flex gap-1">
          <span className="text-muted-foreground">{label}:</span>
          <span>{format(dimensionsMm[key])}</span>
        </span>
      ))}
    </div>
  )
}
