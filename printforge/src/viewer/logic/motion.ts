/**
 * Reduced-motion policy. Returns true when the environment requests reduced
 * motion, in which case the viewer disables damping and auto-rotate. Pure: the
 * matchMedia source is injectable for testing.
 */
export function prefersReducedMotion(
  matchMedia?: (query: string) => { matches: boolean }
): boolean {
  const mm =
    matchMedia ??
    (typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia.bind(globalThis)
      : undefined)
  if (mm === undefined) return false
  return mm("(prefers-reduced-motion: reduce)").matches
}
