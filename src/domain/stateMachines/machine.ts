import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * A typed finite state machine (plan §4.3). `next` on an illegal (state, event)
 * pair returns a `conflict` error; every writer of a state column must route
 * through `next` so illegal transitions can never be persisted.
 */
export interface Machine<S extends string, E extends string> {
  readonly states: readonly S[]
  readonly events: readonly E[]
  can(state: S, event: E): boolean
  next(state: S, event: E): Result<S>
}

export function defineMachine<S extends string, E extends string>(
  table: Record<S, Partial<Record<E, S>>>
): Machine<S, E> {
  const states = Object.keys(table) as S[]
  const eventSet = new Set<E>()
  for (const state of states) {
    for (const event of Object.keys(table[state]) as E[]) {
      eventSet.add(event)
    }
  }
  const events = [...eventSet]

  function next(state: S, event: E): Result<S> {
    const target = table[state]?.[event]
    if (target === undefined) {
      return err(appError("conflict", `illegal transition: ${state} –${event}→`))
    }
    return ok(target)
  }

  return {
    states,
    events,
    can: (state, event) => table[state]?.[event] !== undefined,
    next,
  }
}

/**
 * Resolve a transition that the caller knows is legal by construction (e.g. a
 * literal source state), returning the target directly. Throws on an illegal pair
 * — a programming error, not a runtime condition — so callers need no dead
 * error-handling branch. Use `next` where the source state is dynamic/untrusted.
 */
export function transitionOrThrow<S extends string, E extends string>(
  machine: Machine<S, E>,
  state: S,
  event: E
): S {
  const result = machine.next(state, event)
  if (!result.ok) throw result.error
  return result.value
}
