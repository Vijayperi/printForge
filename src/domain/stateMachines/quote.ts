import { defineMachine } from "@/src/domain/stateMachines/machine"

export type QuoteState = "active" | "expired" | "superseded" | "consumed"
export type QuoteEvent = "EXPIRE" | "SUPERSEDE" | "CONSUME"

/**
 * Quote lifecycle (plan §4.3). A quote is created `active`; it EXPIREs (clock),
 * is SUPERSEDEd by a pricing-relevant config change, or is CONSUMEd at checkout.
 * All non-active states are terminal.
 */
export const quoteMachine = defineMachine<QuoteState, QuoteEvent>({
  active: { EXPIRE: "expired", SUPERSEDE: "superseded", CONSUME: "consumed" },
  expired: {},
  superseded: {},
  consumed: {},
})
