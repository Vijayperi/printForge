import "server-only"

import { z } from "zod"

import type { Slicer } from "@/src/adapters/slicer"
import { DEFAULT_PRINTER_PROFILE_ID } from "@/src/config/profiles"
import { pricingRules } from "@/src/config/pricingRules"
import { getAsset } from "@/src/data/assets"
import type { Db } from "@/src/data/db"
import { getDesignVersion } from "@/src/data/designVersions"
import { getConfiguration } from "@/src/data/printConfigurations"
import {
  getActiveQuoteByConfigHash,
  insertQuote,
  listQuotesByConfiguration,
  updateQuoteStatus,
} from "@/src/data/quotes"
import { getLatestValidationReport } from "@/src/data/validationReports"
import { price } from "@/src/domain/pricing/engine"
import { configHashFromRow, quoteExpiresAt } from "@/src/domain/quoting/quote"
import { quoteMachine, type QuoteState } from "@/src/domain/stateMachines/quote"
import type { Clock } from "@/src/lib/clock"
import { appError } from "@/src/lib/errors"
import { ok, type Result } from "@/src/lib/result"

export interface SlicingDeps {
  db: Db
  slicer: Slicer
  clock: Clock
}

const QUOTEABLE_VERDICTS = new Set(["pass", "warning"])
const payloadSchema = z.object({
  designVersionId: z.string().min(1),
  configHash: z.string().min(1),
})

/**
 * slicing.run (plan §6-S12 step 1+3): slice the current configuration, price it,
 * and create a fresh quote. Idempotent + self-invalidating:
 *  - if the design version's config has changed since enqueue (hash mismatch) the
 *    job is a no-op — a newer slicing.run for the current config will run;
 *  - if an active quote already exists for this (config, hash) it is a no-op;
 *  - otherwise it supersedes any stale active quotes and inserts the new one.
 */
export async function handleSlicingRun(deps: SlicingDeps, rawPayload: unknown): Promise<Result<void>> {
  const parsed = payloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return { ok: false, error: appError("validation", "invalid slicing.run payload") }
  }
  const { designVersionId, configHash } = parsed.data

  const config = await getConfiguration(deps.db, designVersionId)
  if (!config.ok) return config
  if (config.value === null) {
    return { ok: false, error: appError("precondition_failed", "no configuration to slice") }
  }
  // The config mutates in place; if it changed since enqueue, skip (a newer job runs).
  if (configHashFromRow(config.value) !== configHash) return ok(undefined)

  const existing = await getActiveQuoteByConfigHash(deps.db, config.value.id, configHash)
  if (!existing.ok) return existing
  if (existing.value !== null) return ok(undefined) // already quoted

  const report = await getLatestValidationReport(deps.db, designVersionId)
  if (!report.ok) return report
  if (report.value === null || !QUOTEABLE_VERDICTS.has(report.value.status)) {
    return { ok: false, error: appError("precondition_failed", "design version is not printable") }
  }

  const meshKey = await resolveMeshKey(deps.db, designVersionId)
  if (!meshKey.ok) return meshKey

  const sliced = await deps.slicer.slice({
    meshStorageKey: meshKey.value,
    scaleFactor: config.value.scale_factor,
    printerProfileId: DEFAULT_PRINTER_PROFILE_ID,
    materialId: config.value.material_id,
    qualityId: config.value.quality_id,
    strengthId: config.value.strength_id,
  })
  if (!sliced.ok) return sliced

  const quote = price(
    sliced.value,
    { materialId: config.value.material_id, shippingSpeed: config.value.shipping_speed },
    pricingRules
  )

  const superseded = await supersedeStaleQuotes(deps.db, config.value.id)
  if (!superseded.ok) return superseded

  const insert = await insertQuote(deps.db, {
    configurationId: config.value.id,
    configHash,
    amountMinor: quote.total.amountMinor,
    breakdownJson: quote.lines,
    sliceJson: sliced.value as unknown as Record<string, unknown>,
    expiresAt: quoteExpiresAt(deps.clock.now()),
  })
  return insert.ok ? ok(undefined) : insert
}

/** The STL asset's storage key for a design version. */
async function resolveMeshKey(db: Db, designVersionId: string): Promise<Result<string>> {
  const dv = await getDesignVersion(db, designVersionId)
  if (!dv.ok) return dv
  if (dv.value === null) return { ok: false, error: appError("not_found", "design version not found") }
  if (dv.value.stl_asset_id === null) {
    return { ok: false, error: appError("precondition_failed", "design version has no STL asset") }
  }
  const asset = await getAsset(db, dv.value.stl_asset_id)
  if (!asset.ok) return asset
  if (asset.value === null) return { ok: false, error: appError("not_found", "STL asset not found") }
  return ok(asset.value.storage_key)
}

/** SUPERSEDE every still-supersedable quote for a configuration (via the machine). */
async function supersedeStaleQuotes(db: Db, configurationId: string): Promise<Result<void>> {
  const quotes = await listQuotesByConfiguration(db, configurationId)
  if (!quotes.ok) return quotes
  for (const quote of quotes.value) {
    const next = quoteMachine.next(quote.status as QuoteState, "SUPERSEDE")
    if (!next.ok) continue // already terminal (expired/superseded/consumed) — nothing to do
    const updated = await updateQuoteStatus(db, quote.id, next.value)
    if (!updated.ok) return updated
  }
  return ok(undefined)
}
