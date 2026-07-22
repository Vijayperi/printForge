import type { DesignVersionRow, StructuredBrief } from "@/src/domain/types"

export const sampleBrief: StructuredBrief = {
  intendedUse: "gift",
  approxSizeMm: 80,
  style: "cute",
  durability: "display",
  materialPref: "PLA",
  colorPref: "orange",
  rawPrompt: "a friendly dinosaur",
}

export function designVersion(over: Partial<DesignVersionRow> = {}): DesignVersionRow {
  return {
    id: "dv_1",
    project_id: "proj_1",
    source: "generated",
    version_no: 1,
    prompt: "a friendly dinosaur",
    brief_json: sampleBrief,
    provider_task_id: "task_1",
    glb_asset_id: null,
    stl_asset_id: null,
    thumbnail_asset_id: null,
    generation_status: "creating",
    created_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
    ...over,
  }
}
