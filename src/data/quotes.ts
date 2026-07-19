import "server-only"

import {
  insertReturning,
  maybeOneWhere,
  selectWhere,
  updateReturning,
  type Db,
} from "@/src/data/db"
import type { QuoteBreakdownLine, QuoteRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "quotes"

export function insertQuote(
  db: Db,
  input: {
    configurationId: string
    amountMinor: number
    breakdownJson: QuoteBreakdownLine[]
    expiresAt: string
    sliceJson?: Record<string, unknown>
    status?: string
    currency?: string
  }
): Promise<Result<QuoteRow>> {
  return insertReturning<QuoteRow>(db, TABLE, {
    id: newId("qt"),
    configuration_id: input.configurationId,
    status: input.status ?? "active",
    amount_minor: input.amountMinor,
    currency: input.currency ?? "INR",
    breakdown_json: input.breakdownJson,
    slice_json: input.sliceJson ?? null,
    expires_at: input.expiresAt,
  } as QuoteRow)
}

export function getQuote(db: Db, id: string): Promise<Result<QuoteRow | null>> {
  return maybeOneWhere<QuoteRow>(db, TABLE, [["id", id]])
}

export function listQuotesByConfiguration(
  db: Db,
  configurationId: string
): Promise<Result<QuoteRow[]>> {
  return selectWhere<QuoteRow>(db, TABLE, [["configuration_id", configurationId]], {
    orderBy: "created_at",
    ascending: false,
  })
}

export function updateQuoteStatus(db: Db, id: string, status: string): Promise<Result<QuoteRow>> {
  return updateReturning<QuoteRow>(db, TABLE, { status }, [["id", id]])
}
