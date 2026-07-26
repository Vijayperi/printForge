import "server-only"

import type { Notifier } from "@/src/adapters/email"
import { MockNotifier } from "@/src/adapters/email/mock"
import { ResendNotifier } from "@/src/adapters/email/resend"
import { getEnv } from "@/src/config/env"

/**
 * The mock notifier is memoized per process so its outbox survives between
 * jobs — the worker sends from a long-lived process, and a per-call instance
 * would make the development outbox permanently empty.
 */
let mockNotifier: MockNotifier | null = null

/** Resolve the notifier from env (plan §4.4). */
export function getNotifier(): Notifier {
  const env = getEnv()
  if (env.EMAIL === "resend") {
    return new ResendNotifier({ apiKey: env.RESEND_API_KEY as string, from: env.EMAIL_FROM })
  }
  if (mockNotifier === null) mockNotifier = new MockNotifier()
  return mockNotifier
}

/** Test-only: forget the in-memory outbox. */
export function resetMockNotifier(): void {
  mockNotifier = null
}
