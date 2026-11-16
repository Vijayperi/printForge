import { z } from "zod"

import {
  isCustomerTemplate,
  type CustomerTemplateKey,
  type OpsTemplateKey,
  type TemplateKey,
} from "@/src/adapters/email"
import { carrierLabel } from "@/src/config/commerce"
import { emailContent, type EmailCopy } from "@/src/config/content"
import { appError } from "@/src/lib/errors"
import { formatINR, inr } from "@/src/lib/money"
import { err, ok, type Result } from "@/src/lib/result"

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** One `label: value` row of the facts block both layouts render. */
type Fact = readonly [string, string]

const EMPTY_VALUE = "—"

/**
 * Every value that reaches an email body passes through here. Operator reasons,
 * carrier tracking numbers and provider refs are all attacker- or human-authored
 * strings, and mail clients render HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const orderBase = {
  orderId: z.string().min(1),
  orderUrl: z.url(),
}

const customerSchemas = {
  order_receipt: z.object({ ...orderBase, amountMinor: z.number().int().nonnegative() }),
  // Deliberately carries no `reason`: the hold reason is an internal operator
  // note, and a customer should not read our shorthand for why we paused.
  review_hold: z.object(orderBase),
  production_milestone: z.object({
    ...orderBase,
    milestone: z.enum(["started", "completed"]),
  }),
  shipment: z.object({
    ...orderBase,
    carrier: z.string().min(1),
    trackingNumber: z.string().min(1),
  }),
  cancellation_refund: z.object({
    ...orderBase,
    refundAmountMinor: z.number().int().nonnegative().optional(),
  }),
} satisfies Record<CustomerTemplateKey, z.ZodType>

type CustomerData = {
  [K in CustomerTemplateKey]: z.infer<(typeof customerSchemas)[K]>
}

/** Copy plus the facts table for one customer template. */
function customerLayout(template: CustomerTemplateKey, data: CustomerData[CustomerTemplateKey]) {
  const orderFact: Fact = [emailContent.orderRefLabel, data.orderId]

  switch (template) {
    case "order_receipt": {
      const { amountMinor } = data as CustomerData["order_receipt"]
      return {
        copy: emailContent.customer.order_receipt as EmailCopy,
        facts: [orderFact, ["Total paid", formatINR(inr(amountMinor))] as Fact],
      }
    }
    case "review_hold":
      return { copy: emailContent.customer.review_hold as EmailCopy, facts: [orderFact] }
    case "production_milestone": {
      const { milestone } = data as CustomerData["production_milestone"]
      return {
        copy: emailContent.customer.production_milestone[milestone] as EmailCopy,
        facts: [orderFact],
      }
    }
    case "shipment": {
      const { carrier, trackingNumber } = data as CustomerData["shipment"]
      return {
        copy: emailContent.customer.shipment as EmailCopy,
        facts: [
          orderFact,
          ["Carrier", carrierLabel(carrier)] as Fact,
          ["Tracking number", trackingNumber] as Fact,
        ],
      }
    }
    default: {
      const { refundAmountMinor } = data as CustomerData["cancellation_refund"]
      return {
        copy: emailContent.customer.cancellation_refund as EmailCopy,
        facts:
          refundAmountMinor === undefined
            ? [orderFact]
            : [orderFact, ["Refund", formatINR(inr(refundAmountMinor))] as Fact],
      }
    }
  }
}

/** Render a payload value for an ops alert; unknown shapes stay readable as JSON. */
export function factValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE
  if (typeof value === "string") return value.length === 0 ? EMPTY_VALUE : value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

/**
 * Turn an alert payload into facts. Keys are sorted so the same alert always
 * renders identically no matter what order the emitting flow built its object
 * in — which is what makes the snapshots meaningful.
 */
export function opsFacts(data: Record<string, unknown>): Fact[] {
  return Object.keys(data)
    .filter((key) => key !== "template" && key !== "opsUrl")
    .sort()
    .map((key) => [key, factValue(data[key])] as Fact)
}

function factsHtml(facts: readonly Fact[]): string {
  const rows = facts
    .map(
      ([label, value]) =>
        `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("")
  return `<table role="presentation">${rows}</table>`
}

function factsText(facts: readonly Fact[]): string {
  return facts.map(([label, value]) => `${label}: ${value}`).join("\n")
}

function ctaHtml(url: string | null, label: string): string {
  return url === null ? "" : `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`
}

/** The CTA as its own paragraph, or nothing at all when there is no link. */
function ctaTextLines(url: string | null, label: string): string[] {
  return url === null ? [] : ["", `${label}: ${url}`]
}

function renderCustomer(
  template: CustomerTemplateKey,
  raw: Record<string, unknown>
): Result<RenderedEmail> {
  const parsed = customerSchemas[template].safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return err(appError("validation", `invalid data for template ${template}: ${detail}`))
  }
  const data = parsed.data as CustomerData[CustomerTemplateKey]
  const { copy, facts } = customerLayout(template, data)
  const paragraphs = copy.body

  const html = [
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    factsHtml(facts),
    ctaHtml(data.orderUrl, copy.cta),
    `<p>${escapeHtml(emailContent.supportLine)}</p>`,
    `<p>${escapeHtml(emailContent.footer)}</p>`,
  ].join("")

  const text = [
    copy.heading,
    "",
    ...paragraphs,
    "",
    factsText(facts),
    ...ctaTextLines(data.orderUrl, copy.cta),
    "",
    emailContent.supportLine,
    emailContent.footer,
  ].join("\n")

  return ok({ subject: `${copy.subject} (${data.orderId})`, html, text })
}

function renderOps(template: OpsTemplateKey, raw: Record<string, unknown>): Result<RenderedEmail> {
  const subject = emailContent.ops[template]
  const facts = opsFacts(raw)
  const url = typeof raw.opsUrl === "string" ? raw.opsUrl : null

  const html = [
    `<h1>${escapeHtml(subject)}</h1>`,
    factsHtml(facts),
    ctaHtml(url, emailContent.opsCta),
  ].join("")

  const text = [subject, "", factsText(facts), ...ctaTextLines(url, emailContent.opsCta)].join("\n")

  return ok({ subject, html, text })
}

/**
 * Render a template to subject + HTML + plain text (plan §6-S16 step 1).
 *
 * Bad data is a `validation` error, which the worker treats as permanent — an
 * unrenderable payload will never render on a retry either, so it dead-letters
 * with the reason instead of spinning.
 */
export function renderTemplate(
  template: TemplateKey,
  data: Record<string, unknown>
): Result<RenderedEmail> {
  return isCustomerTemplate(template) ? renderCustomer(template, data) : renderOps(template, data)
}
