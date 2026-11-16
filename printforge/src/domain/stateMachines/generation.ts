import { defineMachine } from "@/src/domain/stateMachines/machine"

export type GenerationState = "queued" | "creating" | "ready" | "failed"
export type GenerationEvent =
  | "PROVIDER_ACCEPTED"
  | "PROVIDER_COMPLETED"
  | "PROVIDER_FAILED"
  | "RETRY"

/** Generation lifecycle (plan §4.3). */
export const generationMachine = defineMachine<GenerationState, GenerationEvent>({
  queued: { PROVIDER_ACCEPTED: "creating", PROVIDER_FAILED: "failed" },
  creating: { PROVIDER_COMPLETED: "ready", PROVIDER_FAILED: "failed" },
  failed: { RETRY: "queued" },
  ready: {},
})
