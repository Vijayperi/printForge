import { defineMachine } from "@/src/domain/stateMachines/machine"

export type ValidationState =
  | "pending"
  | "analyzing"
  | "pass"
  | "warning"
  | "manual_review"
  | "fail"

export type ValidationEvent =
  | "START"
  | "RESULT_PASS"
  | "RESULT_WARNING"
  | "RESULT_MANUAL"
  | "RESULT_FAIL"
  | "REVALIDATE"
  | "OPERATOR_APPROVE"
  | "OPERATOR_REJECT"

/**
 * Validation lifecycle (plan §4.3). `START` begins analysis; the `RESULT_*`
 * events land the verdict; `REVALIDATE` re-queues any terminal report (e.g. on a
 * scale change); operators may override a `manual_review` report to pass/fail.
 */
export const validationMachine = defineMachine<ValidationState, ValidationEvent>({
  pending: { START: "analyzing" },
  analyzing: {
    RESULT_PASS: "pass",
    RESULT_WARNING: "warning",
    RESULT_MANUAL: "manual_review",
    RESULT_FAIL: "fail",
  },
  pass: { REVALIDATE: "pending" },
  warning: { REVALIDATE: "pending" },
  manual_review: { REVALIDATE: "pending", OPERATOR_APPROVE: "pass", OPERATOR_REJECT: "fail" },
  fail: { REVALIDATE: "pending" },
})

/** The four terminal verdict states a completed analysis can produce. */
export const TERMINAL_VALIDATION_STATES: readonly ValidationState[] = [
  "pass",
  "warning",
  "manual_review",
  "fail",
]
