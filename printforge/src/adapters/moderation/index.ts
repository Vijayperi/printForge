import type { Result } from "@/src/lib/result"

export type ModerationVerdict = "allow" | "deny" | "flag"

export interface ModerationResult {
  verdict: ModerationVerdict
  category?: string
}

/** Prompt / reference-image moderation (PRD §14). */
export interface Moderator {
  check(input: { text?: string; imageBytes?: Uint8Array }): Promise<Result<ModerationResult>>
}
