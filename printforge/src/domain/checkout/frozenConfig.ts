import { z } from "zod"

import type { PrintConfigurationRow } from "@/src/domain/types"

/**
 * The print configuration as it was at the moment of purchase (FR-2). The live
 * `print_configurations` row keeps mutating as the customer tinkers; what was
 * bought must not, so a copy is frozen onto the order.
 */
export interface FrozenConfig {
  configurationId: string
  materialId: string
  colorId: string
  dimensionsMm: { x: number; y: number; z: number } | null
  scaleFactor: number
  qualityId: string
  strengthId: string
  shippingSpeed: string
  specialInstructions: string
}

export function freezeConfiguration(config: PrintConfigurationRow): FrozenConfig {
  return {
    configurationId: config.id,
    materialId: config.material_id,
    colorId: config.color_id,
    dimensionsMm: config.dimensions_mm,
    scaleFactor: config.scale_factor,
    qualityId: config.quality_id,
    strengthId: config.strength_id,
    shippingSpeed: config.shipping_speed,
    specialInstructions: config.special_instructions,
  }
}

const dimensionsSchema = z
  .object({ x: z.number(), y: z.number(), z: z.number() })
  .nullable()
  .catch(null)

/**
 * Read a frozen snapshot back out of jsonb for display. Every field falls back
 * rather than throwing: an order page must render whatever we stored, even if
 * an older row is shaped differently.
 */
const frozenConfigSchema = z.object({
  configurationId: z.string().catch(""),
  materialId: z.string().catch(""),
  colorId: z.string().catch(""),
  dimensionsMm: dimensionsSchema,
  scaleFactor: z.number().catch(1),
  qualityId: z.string().catch(""),
  strengthId: z.string().catch(""),
  shippingSpeed: z.string().catch(""),
  specialInstructions: z.string().catch(""),
})

export function readFrozenConfig(json: Record<string, unknown>): FrozenConfig {
  return frozenConfigSchema.parse(json)
}
