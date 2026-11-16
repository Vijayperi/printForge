import "server-only"

import { z } from "zod"

import {
  isCustomerTemplate,
  isTemplateKey,
  type Notifier,
  type TemplateKey,
} from "@/src/adapters/email"
import type { Db } from "@/src/data/db"
import { insertNotification } from "@/src/data/notificationLog"
import { getOrder } from "@/src/data/orders"
import { getQuote } from "@/src/data/quotes"
import { readStoredContact } from "@/src/domain/checkout/schema"
import type { OrderRow } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

export interface NotificationDeps {
  db: Db
  notifier: Notifier
  appUrl: string
  /** Inbox every `ops_*` alert is addressed to. */
  opsEmail: string
}

const payloadSchema = z
  .object({ template: z.string().min(1), orderId: z.string().min(1).optional() })
  .loose()

/** `${appUrl}/orders/${id}` — the page the customer's CTA opens. */
export function customerOrderUrl(appUrl: string, orderId: string): string {
  return `${appUrl}/orders/${orderId}`
}

/** `${appUrl}/ops/orders/${id}` — the page an operator needs when an alert lands. */
export function opsOrderUrl(appUrl: string, orderId: string): string {
  return `${appUrl}/ops/orders/${orderId}`
}

/**
 * Everything a customer template needs beyond what the emitting flow attached:
 * the order's own link, and — for a receipt — the amount, which is read from the
 * quote rather than trusted from the payload so the mail can never disagree with
 * what we charged.
 */
async function customerData(
  deps: NotificationDeps,
  template: TemplateKey,
  order: OrderRow,
  payload: Record<string, unknown>
): Promise<Result<Record<string, unknown>>> {
  const base = { ...payload, orderId: order.id, orderUrl: customerOrderUrl(deps.appUrl, order.id) }
  if (template !== "order_receipt") return ok(base)

  const quote = await getQuote(deps.db, order.quote_id)
  if (!quote.ok) return quote
  if (quote.value === null) {
    return err(appError("not_found", `order ${order.id} has no quote to bill a receipt from`))
  }
  return ok({ ...base, amountMinor: quote.value.amount_minor })
}

/** Recipient plus data for a customer mail; fails if the order cannot be found. */
async function customerRecipient(
  deps: NotificationDeps,
  template: TemplateKey,
  orderId: string | undefined,
  payload: Record<string, unknown>
): Promise<Result<{ to: string; data: Record<string, unknown>; orderId: string }>> {
  if (orderId === undefined) {
    return err(appError("validation", `template ${template} needs an orderId`))
  }
  const found = await getOrder(deps.db, orderId)
  if (!found.ok) return found
  if (found.value === null) return err(appError("not_found", `order ${orderId} not found`))

  const contact = readStoredContact(found.value.contact_json)
  if (contact.email.length === 0) {
    return err(appError("validation", `order ${orderId} has no contact email`))
  }

  const data = await customerData(deps, template, found.value, payload)
  if (!data.ok) return data
  return ok({ to: contact.email, data: data.value, orderId })
}

/**
 * notification.send (plan §6-S16 step 1): render one queued notification and
 * hand it to the notifier, then write the per-order log row either way.
 *
 * Every attempt logs, successful or not — the notification log is the record of
 * what we *tried* to tell someone, which is the question being asked when a
 * customer says they never heard from us. Idempotency is the queue's job: the
 * emitting flow chooses a key, so a replayed webhook cannot mail twice.
 */
export async function handleNotificationSend(
  deps: NotificationDeps,
  rawPayload: unknown
): Promise<Result<void>> {
  const parsed = payloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    return err(appError("validation", "notification.send payload must carry a template"))
  }
  const { template, orderId, ...rest } = parsed.data
  if (!isTemplateKey(template)) {
    return err(appError("validation", `unknown notification template ${template}`))
  }

  const resolved = isCustomerTemplate(template)
    ? await customerRecipient(deps, template, orderId, rest)
    : ok({
        to: deps.opsEmail,
        data: orderId === undefined ? rest : { ...rest, opsUrl: opsOrderUrl(deps.appUrl, orderId) },
        orderId: orderId ?? null,
      })
  if (!resolved.ok) return resolved
  const { to, data, orderId: loggedOrderId } = resolved.value

  const sent = await deps.notifier.send(
    loggedOrderId === null ? { to, template, data } : { to, template, data, orderId: loggedOrderId }
  )

  const logged = await insertNotification(deps.db, {
    ...(loggedOrderId === null ? {} : { orderId: loggedOrderId }),
    toEmail: to,
    template,
    status: sent.ok ? "sent" : "failed",
    ...(sent.ok ? { messageRef: sent.value.messageRef } : { error: sent.error.message }),
  })
  if (!logged.ok) return logged

  return sent.ok ? ok(undefined) : err(sent.error)
}
