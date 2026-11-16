import type { Result } from "@/src/lib/result"

/**
 * Derives a print-pipeline STL and a preview thumbnail from a viewer GLB.
 * The real converter (mesh conversion + offscreen render) is an owner-era task;
 * S7 ships a deterministic mock.
 */
export interface GlbConverter {
  toStl(glbBytes: Uint8Array): Promise<Result<Uint8Array>>
  toThumbnail(glbBytes: Uint8Array): Promise<Result<Uint8Array>>
}
