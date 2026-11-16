import type { StructuredBrief } from "@/src/domain/types"
import type { Result } from "@/src/lib/result"

/** Normalized generation status (plan §4.4). Never exposes provider internals. */
export type GenerationStatus =
  | { state: "queued" | "creating"; progressPct?: number }
  | { state: "ready"; assets: { glbUrl: string; stlUrl?: string } }
  | { state: "failed"; reason: string }

export interface GenerationProvider {
  submit(brief: StructuredBrief): Promise<Result<{ providerTaskId: string }>>
  poll(providerTaskId: string): Promise<Result<GenerationStatus>>
  parseWebhook?(rawBody: string, headers: Record<string, string>): Result<GenerationStatus>
}
