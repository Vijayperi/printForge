import "server-only"

import {
  insertReturning,
  maybeOneWhere,
  selectWhere,
  updateReturning,
  type Db,
} from "@/src/data/db"
import type { OrderRow } from "@/src/domain/types"
import { newId } from "@/src/lib/ids"
import type { Result } from "@/src/lib/result"

const TABLE = "orders"

export function insertOrder(
  db: Db,
  input: {
    userId: string
    quoteId: string
    contactJson: Record<string, unknown>
    shippingAddressJson: Record<string, unknown>
    frozenDvId: string
    frozenConfigJson: Record<string, unknown>
    status?: string
    paymentStatus?: string
  }
): Promise<Result<OrderRow>> {
  return insertReturning<OrderRow>(db, TABLE, {
    id: newId("ord"),
    user_id: input.userId,
    quote_id: input.quoteId,
    status: input.status ?? "pending_payment",
    payment_status: input.paymentStatus ?? "unpaid",
    contact_json: input.contactJson,
    shipping_address_json: input.shippingAddressJson,
    frozen_dv_id: input.frozenDvId,
    frozen_config_json: input.frozenConfigJson,
  } as OrderRow)
}

export function getOrder(db: Db, id: string): Promise<Result<OrderRow | null>> {
  return maybeOneWhere<OrderRow>(db, TABLE, [["id", id]])
}

export function getOrderOwned(
  db: Db,
  userId: string,
  id: string
): Promise<Result<OrderRow | null>> {
  return maybeOneWhere<OrderRow>(db, TABLE, [
    ["id", id],
    ["user_id", userId],
  ])
}

export function listOrdersByUser(db: Db, userId: string): Promise<Result<OrderRow[]>> {
  return selectWhere<OrderRow>(db, TABLE, [["user_id", userId]], {
    orderBy: "created_at",
    ascending: false,
  })
}

export function getOrderByQuoteId(db: Db, quoteId: string): Promise<Result<OrderRow | null>> {
  return maybeOneWhere<OrderRow>(db, TABLE, [["quote_id", quoteId]])
}

/** The order a provider payment reference belongs to — how refunds and disputes find their order. */
export function getOrderByPaymentRef(
  db: Db,
  paymentRef: string
): Promise<Result<OrderRow | null>> {
  return maybeOneWhere<OrderRow>(db, TABLE, [["payment_ref", paymentRef]])
}

export function updateOrderStatus(db: Db, id: string, status: string): Promise<Result<OrderRow>> {
  return updateReturning<OrderRow>(db, TABLE, { status }, [["id", id]])
}

/** Record the provider's checkout session id once the session has been created. */
export function updateOrderProviderSession(
  db: Db,
  id: string,
  providerSessionId: string
): Promise<Result<OrderRow>> {
  return updateReturning<OrderRow>(db, TABLE, { provider_session_id: providerSessionId }, [
    ["id", id],
  ])
}

export function updateOrderPaymentStatus(
  db: Db,
  id: string,
  paymentStatus: string
): Promise<Result<OrderRow>> {
  return updateReturning<OrderRow>(db, TABLE, { payment_status: paymentStatus }, [["id", id]])
}

/**
 * Apply everything one payment webhook changes about an order in a SINGLE row
 * update (plan §6-S13 step 3 asks for one transaction; the PostgREST data layer
 * has no multi-statement transaction, but a single-row update is atomic — see
 * DECISIONS.md). Omitted fields are left untouched.
 */
export function applyPaymentOutcome(
  db: Db,
  id: string,
  patch: {
    status?: string
    paymentStatus?: string
    paymentRef?: string
    heldFromStatus?: string | null
  }
): Promise<Result<OrderRow>> {
  const values: Partial<OrderRow> = {}
  if (patch.status !== undefined) values.status = patch.status
  if (patch.paymentStatus !== undefined) values.payment_status = patch.paymentStatus
  if (patch.paymentRef !== undefined) values.payment_ref = patch.paymentRef
  if (patch.heldFromStatus !== undefined) values.held_from_status = patch.heldFromStatus
  return updateReturning<OrderRow>(db, TABLE, values, [["id", id]])
}
