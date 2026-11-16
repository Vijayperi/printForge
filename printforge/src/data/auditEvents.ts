import "server-only"

import { insertReturning, selectWhere, type Db } from "@/src/data/db"
import type { ActorKind, AuditEventRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "audit_events"

export function insertAuditEvent(
  db: Db,
  input: {
    actorId?: string
    actorKind: ActorKind
    entityType: string
    entityId: string
    action: string
    metadata?: Record<string, unknown>
  }
): Promise<Result<AuditEventRow>> {
  return insertReturning<AuditEventRow>(db, TABLE, {
    id: newId("evt"),
    actor_id: input.actorId ?? null,
    actor_kind: input.actorKind,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    metadata: input.metadata ?? {},
  } as AuditEventRow)
}

export function listAuditEventsByEntity(
  db: Db,
  entityType: string,
  entityId: string
): Promise<Result<AuditEventRow[]>> {
  return selectWhere<AuditEventRow>(
    db,
    TABLE,
    [
      ["entity_type", entityType],
      ["entity_id", entityId],
    ],
    { orderBy: "created_at", ascending: false }
  )
}
