/** Reset an orbit-controls-like object (if present) and signal completion. Pure. */
export function resetControls(controls: { reset: () => void } | null, onHandled: () => void): void {
  if (controls !== null) controls.reset()
  onHandled()
}
