import type { Result } from "@/src/lib/result"

/**
 * Templates written for the person who placed the order. Each one renders from
 * an explicit schema (see `templates.ts`) so a customer can never receive a mail
 * with a missing field in it.
 */
export const CUSTOMER_TEMPLATE_KEYS = [
  "order_receipt",
  "review_hold",
  "production_milestone",
  "shipment",
  "cancellation_refund",
] as const

/**
 * Templates written for the operations inbox. §4.4 named the first two; the
 * remaining five are alerts the flows shipped in S13 and S15 already enqueue by
 * name, so the union is widened to match them rather than collapsing five
 * distinct reconciliation alerts into one an operator could no longer triage
 * (DECISIONS.md).
 */
export const OPS_TEMPLATE_KEYS = [
  "ops_manual_review",
  "ops_print_failure",
  "ops_order_review",
  "ops_payment_unmatched",
  "ops_late_payment",
  "ops_refund_unmatched",
  "ops_dispute_opened",
] as const

export type CustomerTemplateKey = (typeof CUSTOMER_TEMPLATE_KEYS)[number]
export type OpsTemplateKey = (typeof OPS_TEMPLATE_KEYS)[number]
export type TemplateKey = CustomerTemplateKey | OpsTemplateKey

export const TEMPLATE_KEYS: readonly TemplateKey[] = [
  ...CUSTOMER_TEMPLATE_KEYS,
  ...OPS_TEMPLATE_KEYS,
]

export function isCustomerTemplate(key: TemplateKey): key is CustomerTemplateKey {
  return (CUSTOMER_TEMPLATE_KEYS as readonly TemplateKey[]).includes(key)
}

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value)
}

/** Who a template is addressed to — decides which inbox the handler sends to. */
export function templateAudience(key: TemplateKey): "customer" | "ops" {
  return isCustomerTemplate(key) ? "customer" : "ops"
}

export interface NotifierInput {
  to: string
  template: TemplateKey
  data: Record<string, unknown>
  orderId?: string
}

/** Transactional email sender (plan §4.4). */
export interface Notifier {
  send(input: NotifierInput): Promise<Result<{ messageRef: string }>>
}
