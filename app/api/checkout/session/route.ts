import { getAuthGateway } from "@/src/adapters/auth/factory"
import { getPaymentProvider } from "@/src/adapters/payments/factory"
import { getEnv } from "@/src/config/env"
import { insertAuditEvent } from "@/src/data/auditEvents"
import type { Db } from "@/src/data/db"
import { getDesignVersion } from "@/src/data/designVersions"
import {
  insertOrder,
  updateOrderProviderSession,
  updateOrderStatus,
} from "@/src/data/orders"
import { getConfigurationById } from "@/src/data/printConfigurations"
import { getQuote, updateQuoteStatus } from "@/src/data/quotes"
import { getRequestDb, getServiceDb } from "@/src/data/supabaseClients"
import { getLatestValidationReport } from "@/src/data/validationReports"
import { checkoutRequestSchema, type CheckoutRequest } from "@/src/domain/checkout/schema"
import { isExpired } from "@/src/domain/quoting/quote"
import { transitionOrThrow } from "@/src/domain/stateMachines/machine"
import { orderMachine } from "@/src/domain/stateMachines/order"
import { quoteMachine } from "@/src/domain/stateMachines/quote"
import type { PrintConfigurationRow, QuoteRow } from "@/src/domain/types"
import { SystemClock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"
import { inr } from "@/src/lib/money"
import { ok, type Result } from "@/src/lib/result"

const PAYABLE_VERDICTS = new Set(["pass", "warning"])

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

/**
 * The configuration snapshot frozen onto the order (FR-2). The live
 * `print_configurations` row keeps mutating as the customer tinkers; what was
 * bought must not.
 */
function freezeConfiguration(config: PrintConfigurationRow): Record<string, unknown> {
  return {
    configurationId: config.id,
    materialId: config.material_id,
    colorId: config.color_id,
    dimensionsMm: config.dimensions_mm,
    scaleFactor: config.scale_factor,
    qualityId: config.quality_id,
    strengthId: config.strength_id,
    shippingSpeed: config.shipping_speed,
    specialInstructions: config.special_instructions,
  }
}

interface PayableQuote {
  quote: QuoteRow
  config: PrintConfigurationRow
  designVersionId: string
}

/**
 * Resolve the quote the customer is trying to pay for. Reads go through the
 * request-scoped (RLS) client, so someone else's quote is simply not found.
 */
async function loadPayableQuote(
  db: Db,
  serviceDb: Db,
  quoteId: string,
  now: Date
): Promise<Result<PayableQuote>> {
  const found = await getQuote(db, quoteId)
  if (!found.ok) return found
  const quote = found.value
  if (quote === null) return { ok: false, error: appError("not_found", "quote not found") }

  const config = await getConfigurationById(db, quote.configuration_id)
  if (!config.ok) return config
  if (config.value === null) {
    return { ok: false, error: appError("not_found", "quote configuration not found") }
  }

  const dv = await getDesignVersion(db, config.value.design_version_id)
  if (!dv.ok) return dv
  if (dv.value === null) {
    return { ok: false, error: appError("not_found", "design version not found") }
  }

  const report = await getLatestValidationReport(db, dv.value.id)
  if (!report.ok) return report
  if (report.value === null || !PAYABLE_VERDICTS.has(report.value.status)) {
    return { ok: false, error: appError("precondition_failed", "this model isn’t printable yet") }
  }

  if (quote.status !== "active") {
    return { ok: false, error: appError("conflict", "this quote is no longer available") }
  }
  if (isExpired(quote.expires_at, now)) {
    const expired = await updateQuoteStatus(
      serviceDb,
      quote.id,
      transitionOrThrow(quoteMachine, "active", "EXPIRE")
    )
    if (!expired.ok) return expired
    return { ok: false, error: appError("conflict", "this quote has expired — request a new one") }
  }

  return ok({ quote, config: config.value, designVersionId: dv.value.id })
}

/**
 * Open a hosted checkout for a quote (plan §4.6, §6-S13 step 4).
 *
 * The body carries `{quoteId, contact, shippingAddress}` and nothing else — the
 * amount is re-read from the stored quote, never accepted from the client. The
 * order freezes the design version and configuration at this moment, and the
 * quote is CONSUMEd so it can never be paid twice.
 */
export async function POST(request: Request): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) {
    return jsonError(appError("unauthorized", "sign in required"))
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(appError("validation", "request body must be json"))
  }
  const parsed = checkoutRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return jsonError(appError("validation", detail))
  }
  const body: CheckoutRequest = parsed.data

  const db = await getRequestDb()
  const serviceDb = getServiceDb()
  const payable = await loadPayableQuote(db, serviceDb, body.quoteId, new SystemClock().now())
  if (!payable.ok) return jsonError(payable.error)
  const { quote, config, designVersionId } = payable.value

  const order = await insertOrder(serviceDb, {
    userId: user.value.userId,
    quoteId: quote.id,
    contactJson: { ...body.contact },
    shippingAddressJson: { ...body.shippingAddress },
    frozenDvId: designVersionId,
    frozenConfigJson: freezeConfiguration(config),
  })
  if (!order.ok) return jsonError(order.error)
  const orderId = order.value.id

  const consumed = await updateQuoteStatus(
    serviceDb,
    quote.id,
    transitionOrThrow(quoteMachine, "active", "CONSUME")
  )
  if (!consumed.ok) return jsonError(consumed.error)

  const checkout = await getPaymentProvider().createCheckout({
    quoteId: quote.id,
    orderId,
    amount: inr(quote.amount_minor),
    customer: { email: body.contact.email, name: body.contact.name },
    returnUrl: `${getEnv().APP_URL}/orders/${orderId}`,
    metadata: { quote_id: quote.id, order_id: orderId },
  })
  if (!checkout.ok) {
    // The session could not be opened, so this order can never be paid: close it
    // rather than leave a zombie pending_payment row behind.
    const cancelled = await updateOrderStatus(
      serviceDb,
      orderId,
      transitionOrThrow(orderMachine, "pending_payment", "PAYMENT_FAILED")
    )
    if (!cancelled.ok) return jsonError(cancelled.error)
    return jsonError(checkout.error)
  }

  const sessionSaved = await updateOrderProviderSession(
    serviceDb,
    orderId,
    checkout.value.providerSessionId
  )
  if (!sessionSaved.ok) return jsonError(sessionSaved.error)

  const audited = await insertAuditEvent(serviceDb, {
    actorId: user.value.userId,
    actorKind: "user",
    entityType: "order",
    entityId: orderId,
    action: "checkout.session_created",
    metadata: {
      quoteId: quote.id,
      amountMinor: quote.amount_minor,
      currency: quote.currency,
      providerSessionId: checkout.value.providerSessionId,
    },
  })
  if (!audited.ok) return jsonError(audited.error)

  return Response.json(
    { orderId, checkoutUrl: checkout.value.checkoutUrl },
    { status: 201 }
  )
}
