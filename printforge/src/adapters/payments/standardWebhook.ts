import { Webhook } from "standardwebhooks"

import {
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TOLERANCE_MS,
} from "@/src/adapters/payments"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

export interface SignatureHeaders {
  id: string
  timestamp: string
  signature: string
}

/** Pull the three Standard Webhooks headers out, case-insensitively. */
export function readSignatureHeaders(
  headers: Record<string, string>
): Result<SignatureHeaders> {
  const lower: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value

  const id = lower[WEBHOOK_ID_HEADER]
  const timestamp = lower[WEBHOOK_TIMESTAMP_HEADER]
  const signature = lower[WEBHOOK_SIGNATURE_HEADER]
  if (id === undefined || timestamp === undefined || signature === undefined) {
    return err(appError("unauthorized", "missing standard-webhooks signature headers"))
  }
  return ok({ id, timestamp, signature })
}

/**
 * Standard Webhooks timestamps are unix seconds. Anything outside ±5 minutes of
 * our clock is a replay (plan §6-S13 step 2) — checked against the injected
 * Clock so the rule is testable, ahead of the library's own internal check.
 */
function timestampWithinTolerance(timestamp: string, clock: Clock): boolean {
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds)) return false
  return Math.abs(clock.now().getTime() - seconds * 1000) <= WEBHOOK_TOLERANCE_MS
}

/**
 * Verify a raw webhook body against the Standard Webhooks spec and return the
 * parsed payload plus its event id. The body must be the exact bytes received —
 * re-serializing JSON changes the signed message.
 */
export function verifyStandardWebhook(
  secret: string,
  rawBody: string,
  headers: Record<string, string>,
  clock: Clock
): Result<{ eventId: string; payload: Record<string, unknown> }> {
  const parsedHeaders = readSignatureHeaders(headers)
  if (!parsedHeaders.ok) return parsedHeaders
  const { id, timestamp, signature } = parsedHeaders.value

  if (!timestampWithinTolerance(timestamp, clock)) {
    return err(appError("unauthorized", "webhook timestamp outside tolerance"))
  }

  // `verify` returns the parsed body once the signature matches, so a JSON
  // failure here is a well-signed but malformed payload — a different fault
  // from a bad signature, and reported as such.
  let payload: unknown
  try {
    payload = new Webhook(secret).verify(rawBody, {
      [WEBHOOK_ID_HEADER]: id,
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [WEBHOOK_SIGNATURE_HEADER]: signature,
    })
  } catch (cause) {
    return cause instanceof SyntaxError
      ? err(appError("validation", "webhook body is not valid json", cause))
      : err(appError("unauthorized", "webhook signature verification failed", cause))
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return err(appError("validation", "webhook body is not a json object"))
  }
  return ok({ eventId: id, payload: payload as Record<string, unknown> })
}

/**
 * Sign a payload the way a provider would. Used by the mock provider (and the
 * dev mock-checkout page) so local and E2E webhooks travel the real verification
 * path rather than a bypass.
 */
export function signStandardWebhook(
  secret: string,
  eventId: string,
  timestamp: Date,
  rawBody: string
): Record<string, string> {
  return {
    [WEBHOOK_ID_HEADER]: eventId,
    [WEBHOOK_TIMESTAMP_HEADER]: String(Math.floor(timestamp.getTime() / 1000)),
    [WEBHOOK_SIGNATURE_HEADER]: new Webhook(secret).sign(eventId, timestamp, rawBody),
  }
}
