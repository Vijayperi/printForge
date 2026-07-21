import "server-only"

import type { Moderator } from "@/src/adapters/moderation"
import { MockModerator } from "@/src/adapters/moderation/mock"

/** Resolve the moderator. Only the mock exists until S7 adds the real one. */
export function getModerator(): Moderator {
  return new MockModerator()
}
