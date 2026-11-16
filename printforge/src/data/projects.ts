import "server-only"

import {
  insertReturning,
  maybeOneWhere,
  selectWhere,
  updateReturning,
  type Db,
} from "@/src/data/db"
import type { ProjectRow, ProjectStatus } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "projects"

export function createProject(
  db: Db,
  input: { userId: string; title: string }
): Promise<Result<ProjectRow>> {
  return insertReturning<ProjectRow>(db, TABLE, {
    id: newId("proj"),
    user_id: input.userId,
    title: input.title,
    status: "active",
  } as ProjectRow)
}

export function listProjectsByUser(db: Db, userId: string): Promise<Result<ProjectRow[]>> {
  return selectWhere<ProjectRow>(db, TABLE, [["user_id", userId]], {
    orderBy: "created_at",
    ascending: false,
  })
}

export function getProjectOwned(
  db: Db,
  userId: string,
  id: string
): Promise<Result<ProjectRow | null>> {
  return maybeOneWhere<ProjectRow>(db, TABLE, [
    ["id", id],
    ["user_id", userId],
  ])
}

export function renameProject(
  db: Db,
  userId: string,
  id: string,
  title: string
): Promise<Result<ProjectRow>> {
  return updateReturning<ProjectRow>(db, TABLE, { title }, [
    ["id", id],
    ["user_id", userId],
  ])
}

export function setProjectStatus(
  db: Db,
  userId: string,
  id: string,
  status: ProjectStatus
): Promise<Result<ProjectRow>> {
  return updateReturning<ProjectRow>(db, TABLE, { status }, [
    ["id", id],
    ["user_id", userId],
  ])
}
