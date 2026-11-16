import type { Moderator, ModerationResult } from "@/src/adapters/moderation"
import { ok, type Result } from "@/src/lib/result"

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** First whole-word match from `terms` found in `text`, or null. */
function firstMatch(text: string, terms: string[]): string | null {
  for (const term of terms) {
    if (new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(text)) return term
  }
  return null
}

/**
 * Wordlist-backed prompt moderation (PRD §14). Deny terms block the request;
 * flag terms allow it but route to manual review. Image classification is
 * owner-era — image-only input is allowed for now.
 */
export class WordlistModerator implements Moderator {
  constructor(private readonly lists: { denyTerms: string[]; flagTerms: string[] }) {}

  async check(input: { text?: string; imageBytes?: Uint8Array }): Promise<Result<ModerationResult>> {
    if (input.text === undefined) {
      return ok({ verdict: "allow" })
    }
    const text = input.text.toLowerCase()

    const denied = firstMatch(text, this.lists.denyTerms)
    if (denied !== null) return ok({ verdict: "deny", category: denied })

    const flagged = firstMatch(text, this.lists.flagTerms)
    if (flagged !== null) return ok({ verdict: "flag", category: flagged })

    return ok({ verdict: "allow" })
  }
}
