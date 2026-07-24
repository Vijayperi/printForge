import { z } from "zod"

import type { PaymentEvent } from "@/src/adapters/payments"
import { appError } from "@/src/lib/errors"
import { inr } from "@/src/lib/money"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * Dodo metadata values are strings, numbers or booleans; our `PaymentEvent`
 * carries strings, so primitives are stringified on the way in.
 */
const metadataSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .default({})
  .transform((raw) => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw)) out[key] = String(value)
    return out
  })

// PrintForge sells in INR only; any other currency means a misconfigured product.
const currencySchema = z.literal("INR")
const minorAmountSchema = z.number().int().nonnegative()

const paymentSucceededSchema = z.object({
  payment_id: z.string().min(1),
  total_amount: minorAmountSchema,
  currency: currencySchema,
  metadata: metadataSchema,
})

const paymentFailedSchema = z.object({
  metadata: metadataSchema,
  error_message: z.string().min(1).nullish(),
  error_code: z.string().min(1).nullish(),
})

const refundSucceededSchema = z.object({
  payment_id: z.string().min(1),
  amount: minorAmountSchema,
  currency: currencySchema,
})

const disputeOpenedSchema = z.object({
  payment_id: z.string().min(1),
})

const envelopeSchema = z.object({
  type: z.string().min(1),
  data: z.looseObject({}),
})

function malformed(eventType: string, error: z.ZodError): ReturnType<typeof appError> {
  const detail = error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
  return appError("provider_error", `malformed ${eventType} payload: ${detail}`)
}

/**
 * Map a verified Standard-Webhooks payload onto our `PaymentEvent` union
 * (plan §4.4). Event types we do not act on become `ignored` so the route can
 * log and ACK them; a payload of a type we DO act on that does not parse is an
 * error, never a silent ignore.
 */
export function normalizePaymentPayload(
  eventId: string,
  payload: Record<string, unknown>
): Result<PaymentEvent> {
  const envelope = envelopeSchema.safeParse(payload)
  if (!envelope.success) return err(malformed("webhook", envelope.error))
  const { type, data } = envelope.data

  switch (type) {
    case "payment.succeeded": {
      const parsed = paymentSucceededSchema.safeParse(data)
      if (!parsed.success) return err(malformed(type, parsed.error))
      return ok({
        type: "payment.succeeded",
        eventId,
        paymentRef: parsed.data.payment_id,
        metadata: parsed.data.metadata,
        amount: inr(parsed.data.total_amount),
      })
    }
    case "payment.failed": {
      const parsed = paymentFailedSchema.safeParse(data)
      if (!parsed.success) return err(malformed(type, parsed.error))
      return ok({
        type: "payment.failed",
        eventId,
        metadata: parsed.data.metadata,
        reason: parsed.data.error_message ?? parsed.data.error_code ?? "payment failed",
      })
    }
    case "refund.succeeded": {
      const parsed = refundSucceededSchema.safeParse(data)
      if (!parsed.success) return err(malformed(type, parsed.error))
      return ok({
        type: "refund.succeeded",
        eventId,
        paymentRef: parsed.data.payment_id,
        amount: inr(parsed.data.amount),
      })
    }
    case "dispute.opened": {
      const parsed = disputeOpenedSchema.safeParse(data)
      if (!parsed.success) return err(malformed(type, parsed.error))
      return ok({ type: "dispute.opened", eventId, paymentRef: parsed.data.payment_id })
    }
    default:
      return ok({ type: "ignored", eventId, rawType: type })
  }
}
