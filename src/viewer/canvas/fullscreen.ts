export interface FullscreenElement {
  requestFullscreen?: () => Promise<void>
}

export interface FullscreenDocument {
  fullscreenElement: Element | null
  exitFullscreen?: () => Promise<void>
}

/**
 * Toggle fullscreen for an element and return the resulting state. Pure: both
 * the element and document are injected so it is testable without a real DOM
 * fullscreen implementation (which jsdom lacks).
 */
export async function toggleFullscreen(
  element: FullscreenElement | null,
  doc: FullscreenDocument
): Promise<boolean> {
  if (doc.fullscreenElement === null) {
    await element?.requestFullscreen?.()
    return true
  }
  await doc.exitFullscreen?.()
  return false
}
