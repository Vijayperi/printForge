import "server-only"

import { insertReturning, maybeOneWhere, type Db } from "@/src/data/db"
import type { WebhookEventRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "webhook_events"

/**
 * Record a received webhook. A duplicate (provider, event_id) surfaces as a
 * `conflict` Result — the caller relies on this for idempotency (plan §6-S13).
 */
export function recordWebhookEvent(
  db: Db,
  input: { provider: string; eventId: string; payload: Record<string, unknown> }
): Promise<Result<WebhookEventRow>> {
  return insertReturning<WebhookEventRow>(db, TABLE, {
    id: newId("wh"),
    provider: input.provider,
    event_id: input.eventId,
    payload: input.payload,
  } as WebhookEventRow)
}

export function getWebhookEvent(
  db: Db,
  provider: string,
  eventId: string
): Promise<Result<WebhookEventRow | null>> {
  return maybeOneWhere<WebhookEventRow>(db, TABLE, [
    ["provider", provider],
    ["event_id", eventId],
  ])
}
