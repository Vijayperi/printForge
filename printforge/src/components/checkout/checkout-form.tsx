"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { INDIAN_STATES } from "@/src/config/commerce"
import { checkoutContent } from "@/src/config/content"
import { checkoutRequestSchema } from "@/src/domain/checkout/schema"

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string }

/** Field errors keyed by the dotted path zod reports, e.g. `shippingAddress.pincode`. */
type FieldErrors = Record<string, string>

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of issues) {
    const key = issue.path.map(String).join(".")
    errors[key] ??= issue.message
  }
  return errors
}

/** Empty optional fields must be omitted, not sent as "" — the schema is strict. */
function optional(value: string): string | undefined {
  return value.trim() === "" ? undefined : value
}

/**
 * Contact + India-shaped shipping form (plan §6-S13 step 4). The body carries
 * `{quoteId, contact, shippingAddress}` and NOTHING else — the price is the
 * server's business. The same zod schema the route enforces validates here
 * first, so the customer sees field errors before a round trip.
 */
export function CheckoutForm({ quoteId }: { quoteId: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    // Every field below is rendered unconditionally, so each name is present.
    const read = (name: string): string => String(form.get(name))

    const candidate = {
      quoteId,
      contact: { name: read("name"), email: read("email"), phone: read("phone") },
      shippingAddress: {
        line1: read("line1"),
        line2: optional(read("line2")),
        city: read("city"),
        state: read("state"),
        pincode: read("pincode"),
      },
    }

    const parsed = checkoutRequestSchema.safeParse(candidate)
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(parsed.error.issues))
      setStatus({ kind: "idle" })
      return
    }

    setFieldErrors({})
    setStatus({ kind: "submitting" })
    const response = await fetch("/api/checkout/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    })
    const body = (await response.json()) as {
      checkoutUrl?: string
      error?: { message?: string }
    }
    if (!response.ok || body.checkoutUrl === undefined) {
      setStatus({ kind: "error", message: body.error?.message ?? checkoutContent.genericError })
      return
    }
    router.push(body.checkoutUrl)
  }

  const busy = status.kind === "submitting"

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-6" noValidate>
      <fieldset className="space-y-3" disabled={busy}>
        <legend className="text-sm font-semibold">{checkoutContent.contactHeading}</legend>
        <Field
          name="name"
          label={checkoutContent.nameLabel}
          autoComplete="name"
          error={fieldErrors["contact.name"]}
        />
        <Field
          name="email"
          type="email"
          label={checkoutContent.emailLabel}
          autoComplete="email"
          error={fieldErrors["contact.email"]}
        />
        <Field
          name="phone"
          label={checkoutContent.phoneLabel}
          autoComplete="tel"
          error={fieldErrors["contact.phone"]}
        />
      </fieldset>

      <fieldset className="space-y-3" disabled={busy}>
        <legend className="text-sm font-semibold">{checkoutContent.addressHeading}</legend>
        <Field
          name="line1"
          label={checkoutContent.line1Label}
          autoComplete="address-line1"
          error={fieldErrors["shippingAddress.line1"]}
        />
        <Field
          name="line2"
          label={checkoutContent.line2Label}
          autoComplete="address-line2"
          error={fieldErrors["shippingAddress.line2"]}
        />
        <Field
          name="city"
          label={checkoutContent.cityLabel}
          autoComplete="address-level2"
          error={fieldErrors["shippingAddress.city"]}
        />
        <div className="space-y-1">
          <Label htmlFor="checkout-state">{checkoutContent.stateLabel}</Label>
          <select
            id="checkout-state"
            name="state"
            defaultValue=""
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="" disabled>
              —
            </option>
            {INDIAN_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors["shippingAddress.state"]} />
        </div>
        <Field
          name="pincode"
          label={checkoutContent.pincodeLabel}
          inputMode="numeric"
          autoComplete="postal-code"
          error={fieldErrors["shippingAddress.pincode"]}
        />
        <p className="text-xs text-muted-foreground">{checkoutContent.countryNote}</p>
      </fieldset>

      {status.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? checkoutContent.submitting : checkoutContent.submit}
      </Button>
      <p className="text-xs text-muted-foreground">{checkoutContent.securityNote}</p>
    </form>
  )
}

function FieldError({ message }: { message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

function Field({
  name,
  label,
  error,
  ...input
}: {
  name: string
  label: string
  error: string | undefined
} & React.ComponentProps<typeof Input>) {
  const id = `checkout-${name}`
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} aria-invalid={error !== undefined} {...input} />
      <FieldError message={error} />
    </div>
  )
}
