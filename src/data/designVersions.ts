import "server-only"

import {
  insertReturning,
  maybeOneWhere,
  selectWhere,
  updateReturning,
  type Db,
} from "@/src/data/db"
import type { DesignSource, DesignVersionRow, StructuredBrief } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import { mapResult, type Result } from "@/src/lib/result"

const TABLE = "design_versions"

export function createDesignVersion(
  db: Db,
  input: {
    projectId: string
    source: DesignSource
    versionNo: number
    prompt?: string
    briefJson?: StructuredBrief
    providerTaskId?: string
    generationStatus?: string
  }
): Promise<Result<DesignVersionRow>> {
  return insertReturning<DesignVersionRow>(db, TABLE, {
    id: newId("dv"),
    project_id: input.projectId,
    source: input.source,
    version_no: input.versionNo,
    prompt: input.prompt ?? null,
    brief_json: input.briefJson ?? null,
    provider_task_id: input.providerTaskId ?? null,
    generation_status: input.generationStatus ?? "queued",
  } as DesignVersionRow)
}

export function getDesignVersion(db: Db, id: string): Promise<Result<DesignVersionRow | null>> {
  return maybeOneWhere<DesignVersionRow>(db, TABLE, [["id", id]])
}

export function listDesignVersionsByProject(
  db: Db,
  projectId: string
): Promise<Result<DesignVersionRow[]>> {
  return selectWhere<DesignVersionRow>(db, TABLE, [["project_id", projectId]], {
    orderBy: "version_no",
    ascending: false,
  })
}

export async function nextVersionNo(db: Db, projectId: string): Promise<Result<number>> {
  const rows = await selectWhere<DesignVersionRow>(db, TABLE, [["project_id", projectId]])
  return mapResult(rows, (versions) =>
    versions.reduce((max, v) => Math.max(max, v.version_no), 0) + 1
  )
}

export function updateGenerationStatus(
  db: Db,
  id: string,
  status: string
): Promise<Result<DesignVersionRow>> {
  return updateReturning<DesignVersionRow>(db, TABLE, { generation_status: status }, [["id", id]])
}

export function attachAssets(
  db: Db,
  id: string,
  assets: { glbAssetId?: string; stlAssetId?: string; thumbnailAssetId?: string }
): Promise<Result<DesignVersionRow>> {
  const values: Partial<DesignVersionRow> = {}
  if (assets.glbAssetId !== undefined) values.glb_asset_id = assets.glbAssetId
  if (assets.stlAssetId !== undefined) values.stl_asset_id = assets.stlAssetId
  if (assets.thumbnailAssetId !== undefined) values.thumbnail_asset_id = assets.thumbnailAssetId
  return updateReturning<DesignVersionRow>(db, TABLE, values, [["id", id]])
}
