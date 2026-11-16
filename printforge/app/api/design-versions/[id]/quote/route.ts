import { getAuthGateway } from "@/src/adapters/auth/factory"
import type { Db } from "@/src/data/db"
import { getDesignVersion } from "@/src/data/designVersions"
import { getConfiguration } from "@/src/data/printConfigurations"
import { getLatestQuoteByConfigHash, updateQuoteStatus } from "@/src/data/quotes"
import { getRequestDb, getServiceDb } from "@/src/data/supabaseClients"
import { getLatestValidationReport } from "@/src/data/validationReports"
import { configHashFromRow, isExpired } from "@/src/domain/quoting/quote"
import { quoteMachine } from "@/src/domain/stateMachines/quote"
import { transitionOrThrow } from "@/src/domain/stateMachines/machine"
import type { PrintConfigurationRow, QuoteRow } from "@/src/domain/types"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { newId } from "@/src/lib/ids"
import { ok, type Result } from "@/src/lib/result"

const QUOTEABLE_VERDICTS = new Set(["pass", "warning"])

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

function quoteDto(quote: QuoteRow) {
  return {
    id: quote.id,
    amountMinor: quote.amount_minor,
    currency: quote.currency,
    breakdown: quote.breakdown_json,
    slice: quote.slice_json,
    expiresAt: quote.expires_at,
  }
}

/**
 * The fresh (active, unexpired) quote for a (configuration, hash), or null.
 * Expiry is enforced on read (plan §6-S12 step 3): a lapsed quote is EXPIREd here,
 * no cron needed.
 */
async function resolveFreshQuote(
  db: Db,
  configurationId: string,
  configHash: string,
  now: Date
): Promise<Result<QuoteRow | null>> {
  const latest = await getLatestQuoteByConfigHash(db, configurationId, configHash)
  if (!latest.ok) return latest
  const quote = latest.value
  if (quote === null || quote.status !== "active") return ok(null)
  if (isExpired(quote.expires_at, now)) {
    const expired = await updateQuoteStatus(db, quote.id, transitionOrThrow(quoteMachine, "active", "EXPIRE"))
    if (!expired.ok) return expired
    return ok(null)
  }
  return ok(quote)
}

/** Auth + ownership + configuration lookup shared by GET and POST. */
async function loadOwnedConfig(
  id: string
): Promise<Result<{ config: PrintConfigurationRow; db: Db }>> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return { ok: false, error: appError("unauthorized", "sign in required") }

  const db = await getRequestDb()
  const dv = await getDesignVersion(db, id)
  if (!dv.ok) return dv
  if (dv.value === null) return { ok: false, error: appError("not_found", "design version not found") }

  const config = await getConfiguration(db, id)
  if (!config.ok) return config
  if (config.value === null) return { ok: false, error: appError("precondition_failed", "configure the model first") }
  return ok({ config: config.value, db })
}

/** Current quote for the design version's configuration (polled by the UI). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params
  const loaded = await loadOwnedConfig(id)
  if (!loaded.ok) return jsonError(loaded.error)

  const serviceDb = getServiceDb()
  const configHash = configHashFromRow(loaded.value.config)
  const fresh = await resolveFreshQuote(serviceDb, loaded.value.config.id, configHash, new SystemClock().now())
  if (!fresh.ok) return jsonError(fresh.error)

  return fresh.value === null
    ? Response.json({ status: "none" }, { status: 200 })
    : Response.json({ status: "ready", quote: quoteDto(fresh.value) }, { status: 200 })
}

/**
 * Request a quote (plan §6-S12 step 3). Requires a configuration + a printable
 * verdict. Returns the fresh quote if one already exists, otherwise enqueues
 * `slicing.run` and returns 202 `pending_slice`. The slicing handler is idempotent
 * (it no-ops if an active quote already exists for the hash), so a duplicate
 * enqueue is harmless — and a lapsed quote can be re-requested.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params
  const loaded = await loadOwnedConfig(id)
  if (!loaded.ok) return jsonError(loaded.error)
  const { config, db } = loaded.value

  const report = await getLatestValidationReport(db, id)
  if (!report.ok) return jsonError(report.error)
  if (report.value === null || !QUOTEABLE_VERDICTS.has(report.value.status)) {
    return jsonError(appError("precondition_failed", "this model isn’t printable yet"))
  }

  const serviceDb = getServiceDb()
  const configHash = configHashFromRow(config)
  const fresh = await resolveFreshQuote(serviceDb, config.id, configHash, new SystemClock().now())
  if (!fresh.ok) return jsonError(fresh.error)
  if (fresh.value !== null) {
    return Response.json({ status: "ready", quote: quoteDto(fresh.value) }, { status: 200 })
  }

  const enqueue = await new PostgresJobQueue(serviceDb, new SystemClock()).enqueue({
    type: "slicing.run",
    payload: { designVersionId: id, configHash },
    idempotencyKey: `slice:${id}:${configHash}:${newId("job")}`,
  })
  if (!enqueue.ok) return jsonError(enqueue.error)
  return Response.json({ status: "pending_slice" }, { status: 202 })
}
