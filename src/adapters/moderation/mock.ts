import type { Moderator, ModerationResult } from "@/src/adapters/moderation"
import { ok, type Result } from "@/src/lib/result"

/**
 * Allow-all moderator for development and S5. The real wordlist-backed
 * moderator arrives in S7 (PRD §14 prohibited-content categories).
 */
export class MockModerator implements Moderator {
  async check(_input: { text?: string; imageBytes?: Uint8Array }): Promise<Result<ModerationResult>> {
    return ok({ verdict: "allow" })
  }
}
