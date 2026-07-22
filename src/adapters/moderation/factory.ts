import "server-only"

import type { Moderator } from "@/src/adapters/moderation"
import { WordlistModerator } from "@/src/adapters/moderation/wordlist"
import { denyTerms, flagTerms } from "@/src/config/moderation"

/** Resolve the moderator. Wordlist-backed prompt moderation (PRD §14). */
export function getModerator(): Moderator {
  return new WordlistModerator({ denyTerms, flagTerms })
}
