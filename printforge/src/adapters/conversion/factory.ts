import "server-only"

import type { GlbConverter } from "@/src/adapters/conversion"
import { MockGlbConverter } from "@/src/adapters/conversion/mock"

/** Resolve the GLB converter. Only the mock exists until real conversion ships. */
export function getGlbConverter(): GlbConverter {
  return new MockGlbConverter()
}
