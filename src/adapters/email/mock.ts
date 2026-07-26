import { ulid } from "ulid"

import type { Notifier, NotifierInput } from "@/src/adapters/email"
import { renderTemplate, type RenderedEmail } from "@/src/adapters/email/templates"
import { ok, type Result } from "@/src/lib/result"

export interface SentEmail extends RenderedEmail {
  to: string
  template: string
  orderId: string | null
  messageRef: string
}

/**
 * The default notifier (plan §6-S16 step 1): renders exactly what the real one
 * renders, then keeps the result in memory instead of sending it. The per-order
 * `notification_log` row is written by the `notification.send` handler, not
 * here, because §4.4's Notifier has no database (DECISIONS.md).
 */
export class MockNotifier implements Notifier {
  private readonly outbox: SentEmail[] = []

  async send(input: NotifierInput): Promise<Result<{ messageRef: string }>> {
    const rendered = renderTemplate(input.template, input.data)
    if (!rendered.ok) return rendered

    // Shaped like a provider's reference, not one of our ids: this is the field
    // a real ESP fills in, and nothing may key off its format.
    const messageRef = `mock_${ulid()}`
    this.outbox.push({
      ...rendered.value,
      to: input.to,
      template: input.template,
      orderId: input.orderId ?? null,
      messageRef,
    })
    return ok({ messageRef })
  }

  /** Everything this notifier has "sent", oldest first. */
  sent(): readonly SentEmail[] {
    return this.outbox
  }

  /** Test-only: forget the outbox. */
  clear(): void {
    this.outbox.length = 0
  }
}
