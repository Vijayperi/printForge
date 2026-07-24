import "server-only"

import {
  insertReturning,
  selectWhere,
  updateReturning,
  type Db,
} from "@/src/data/db"
import type { PrintConfigurationRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import { ok, type Result } from "@/src/lib/result"

const TABLE = "print_configurations"

export interface ConfigurationValues {
  materialId: string
  colorId: string
  dimensionsMm: { x: number; y: number; z: number }
  scaleFactor: number
  qualityId: string
  strengthId: string
  shippingSpeed: string
  specialInstructions: string
}

/** The current configuration for a design version (newest wins), or null. */
export async function getConfiguration(
  db: Db,
  designVersionId: string
): Promise<Result<PrintConfigurationRow | null>> {
  const rows = await selectWhere<PrintConfigurationRow>(db, TABLE, [
    ["design_version_id", designVersionId],
  ], { orderBy: "created_at", ascending: false })
  return rows.ok ? ok(rows.value[0] ?? null) : rows
}

function toRow(values: ConfigurationValues) {
  return {
    material_id: values.materialId,
    color_id: values.colorId,
    dimensions_mm: values.dimensionsMm,
    scale_factor: values.scaleFactor,
    quality_id: values.qualityId,
    strength_id: values.strengthId,
    shipping_speed: values.shippingSpeed,
    special_instructions: values.specialInstructions,
  }
}

/**
 * One configuration per design version: update the existing row if present,
 * otherwise insert a fresh `cfg_` row. Returns the persisted row.
 */
export async function upsertConfiguration(
  db: Db,
  designVersionId: string,
  values: ConfigurationValues
): Promise<Result<PrintConfigurationRow>> {
  const existing = await getConfiguration(db, designVersionId)
  if (!existing.ok) return existing

  const rowValues = toRow(values)
  if (existing.value !== null) {
    return updateReturning<PrintConfigurationRow>(db, TABLE, rowValues, [["id", existing.value.id]])
  }
  return insertReturning<PrintConfigurationRow>(db, TABLE, {
    id: newId("cfg"),
    design_version_id: designVersionId,
    ...rowValues,
  } as PrintConfigurationRow)
}
