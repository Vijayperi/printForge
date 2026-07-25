import "server-only"

import { insertReturning, maybeOneWhere, updateReturning, type Db } from "@/src/data/db"
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

/**
 * Stamp how a received webhook was handled. A row whose `processing_result` is
 * still null was never processed to completion, so a provider retry of the same
 * event id is allowed to run it again (plan §6-S13 step 3).
 */
export function updateWebhookProcessingResult(
  db: Db,
  id: string,
  processingResult: string
): Promise<Result<WebhookEventRow>> {
  return updateReturning<WebhookEventRow>(db, TABLE, { processing_result: processingResult }, [
    ["id", id],
  ])
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
