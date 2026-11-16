import "server-only"

import type { Notifier, NotifierInput } from "@/src/adapters/email"
import { renderTemplate } from "@/src/adapters/email/templates"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

const SEND_URL = "https://api.resend.com/emails"

export interface ResendConfig {
  apiKey: string
  /** RFC 5322 sender, e.g. `PrintForge <orders@printforge.in>`. */
  from: string
}

/**
 * Resend transactional sender (plan §6-S16 step 1, resend.com/docs/api-reference
 * /emails/send-email). Renders through the same `renderTemplate` the mock uses,
 * so the two can only differ in the transport.
 */
export class ResendNotifier implements Notifier {
  constructor(private readonly config: ResendConfig) {}

  async send(input: NotifierInput): Promise<Result<{ messageRef: string }>> {
    const rendered = renderTemplate(input.template, input.data)
    if (!rendered.ok) return rendered

    let res: Response
    try {
      res = await fetch(SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [input.to],
          subject: rendered.value.subject,
          html: rendered.value.html,
          text: rendered.value.text,
        }),
      })
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : "unknown transport failure"
      return err(appError("provider_error", `resend send failed: ${detail}`))
    }

    if (!res.ok) {
      return err(appError("provider_error", `resend send failed with status ${res.status}`))
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string }
    if (typeof body.id !== "string" || body.id.length === 0) {
      return err(appError("provider_error", "resend accepted the mail but returned no id"))
    }
    return ok({ messageRef: body.id })
  }
}
