/**
 * Numeric thresholds for the printability verdict (plan §6-S10 step 2). Build
 * volume and minimum wall come from the printer/material profiles; these are the
 * profile-independent cutoffs the decision table keys on.
 */
export const PRINTABILITY_THRESHOLDS = {
  /** boundary_holes with more open edges than this → fail; at or below → manual_review. */
  boundaryHoleFailEdges: 100,
  /** multiple_components where the smallest body is below this volume share → manual_review. */
  smallComponentVolumeFraction: 0.05,
} as const
