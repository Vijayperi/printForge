import type { Result } from "@/src/lib/result"

/** Inputs a slicer needs to turn a stored mesh into a printable estimate (plan §4.4). */
export interface SliceInput {
  meshStorageKey: string
  scaleFactor: number
  printerProfileId: string
  materialId: string
  qualityId: string
  strengthId: string
}

export interface SliceResult {
  durationMinutes: number
  materialGrams: number
  materialMeters: number
  supportsUsed: boolean
  gcodeStorageKey: string
  slicerVersion: string
  profileVersion: string
  orientation: { rx: number; ry: number; rz: number }
}

export interface Slicer {
  slice(input: SliceInput): Promise<Result<SliceResult>>
}
