import type { GlbConverter } from "@/src/adapters/conversion"
import { ok, type Result } from "@/src/lib/result"

// A 1×1 transparent PNG used as the placeholder thumbnail.
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

function decodeBase64(b64: string): Uint8Array {
  return Uint8Array.from(globalThis.atob(b64), (c) => c.charCodeAt(0))
}

/** Deterministic stub converter (plan §6-S7). */
export class MockGlbConverter implements GlbConverter {
  async toStl(_glbBytes: Uint8Array): Promise<Result<Uint8Array>> {
    // A minimal, valid binary STL: 80-byte header + a 0-triangle count.
    return ok(new Uint8Array(84))
  }

  async toThumbnail(_glbBytes: Uint8Array): Promise<Result<Uint8Array>> {
    return ok(decodeBase64(PLACEHOLDER_PNG_BASE64))
  }
}
