import {
  getMaterialProfile,
  getQualityPreset,
  getStrengthPreset,
} from "@/src/config/profiles"
import type { FrozenConfig } from "@/src/domain/checkout/frozenConfig"
import type { QuoteBreakdownLine } from "@/src/domain/types"
import { formatINR, inr } from "@/src/lib/money"

export interface OrderSummaryProps {
  heading: string
  thumbnailAssetId: string | null
  config: FrozenConfig
  breakdown: QuoteBreakdownLine[]
  totalMinor: number
  totalLabel: string
}

/** A configured id rendered as a human name, falling back to the raw id. */
function presetName(name: string | undefined, id: string): string {
  return name ?? id
}

function colourName(materialId: string, colorId: string): string {
  const material = getMaterialProfile(materialId)
  return material.colors.find((colour) => colour.id === colorId)?.name ?? colorId
}

function dimensionsLabel(config: FrozenConfig): string | null {
  const d = config.dimensionsMm
  if (d === null) return null
  const at = (value: number): string => (Math.round(value * 10) / 10).toString()
  return `${at(d.x)} × ${at(d.y)} × ${at(d.z)} mm`
}

/**
 * The frozen what-you-bought panel (plan §6-S13 step 4), shared by the checkout
 * review and the order detail page. Presentational only — every value comes
 * from the snapshot stored on the order (or, at checkout, from the quote about
 * to be frozen).
 */
export function OrderSummary({
  heading,
  thumbnailAssetId,
  config,
  breakdown,
  totalMinor,
  totalLabel,
}: OrderSummaryProps) {
  const dimensions = dimensionsLabel(config)

  return (
    <section aria-labelledby="order-summary-heading" className="space-y-4 rounded-xl border p-4">
      <h2 id="order-summary-heading" className="text-sm font-semibold">
        {heading}
      </h2>

      <div className="flex items-start gap-4">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">
          {thumbnailAssetId !== null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/assets/${thumbnailAssetId}`}
              alt="Model thumbnail"
              className="size-full object-cover"
            />
          ) : (
            <span className="text-xs text-muted-foreground">3D</span>
          )}
        </span>

        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Material</dt>
          <dd className="text-right">{getMaterialProfile(config.materialId).name}</dd>
          <dt className="text-muted-foreground">Colour</dt>
          <dd className="text-right">{colourName(config.materialId, config.colorId)}</dd>
          <dt className="text-muted-foreground">Quality</dt>
          <dd className="text-right">
            {presetName(getQualityPreset(config.qualityId)?.name, config.qualityId)}
          </dd>
          <dt className="text-muted-foreground">Strength</dt>
          <dd className="text-right">
            {presetName(getStrengthPreset(config.strengthId)?.name, config.strengthId)}
          </dd>
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="text-right capitalize">{config.shippingSpeed}</dd>
          {dimensions !== null ? (
            <>
              <dt className="text-muted-foreground">Size</dt>
              <dd className="text-right tabular-nums">{dimensions}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {config.specialInstructions !== "" ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Notes: </span>
          {config.specialInstructions}
        </p>
      ) : null}

      <table className="w-full text-sm">
        <caption className="sr-only">Price breakdown</caption>
        <tbody>
          {breakdown.map((line) => (
            <tr key={line.key} className="border-b last:border-0">
              <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                {line.label}
              </th>
              <td className="py-1 text-right tabular-nums">{formatINR(line.amount)}</td>
            </tr>
          ))}
          <tr className="border-t-2">
            <th scope="row" className="py-2 text-left font-semibold">
              {totalLabel}
            </th>
            <td className="py-2 text-right font-semibold tabular-nums">
              {formatINR(inr(totalMinor))}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}
