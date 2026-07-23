/**
 * Printer, material, quality and strength catalog (plan §6-S10 step 1). Every
 * value here is a launch placeholder — OWNER DECISION REQUIRED before real
 * fulfilment. Kept as plain typed data so the printability, configuration (S11)
 * and pricing (S12) domains can read one source of truth.
 */

export interface PrinterProfile {
  id: string
  name: string
  buildVolumeMm: { x: number; y: number; z: number }
  nozzleMm: number
  version: string
}

export interface MaterialColor {
  id: string
  name: string
  hex: string
  inStock: boolean
}

export interface MaterialProfile {
  id: string
  name: string
  colors: MaterialColor[]
  /** Minimum reliably-printable wall thickness (mm) at this material/nozzle. */
  minWallMm: number
  densityGCm3: number
  /** Price of one gram of filament, in INR paise (minor units). */
  pricePerGramMinor: number
}

export interface QualityPreset {
  id: string
  name: string
  layerHeightMm: number
  /** Multiplier on print time relative to the standard preset. */
  timeFactor: number
}

export interface StrengthPreset {
  id: string
  name: string
  infillPct: number
  /** Multiplier on material usage relative to the baseline. */
  materialFactor: number
}

// OWNER DECISION REQUIRED: real printer fleet + build volumes.
export const printerProfiles: PrinterProfile[] = [
  {
    id: "generic-fdm",
    name: "Generic FDM 220×220×250",
    buildVolumeMm: { x: 220, y: 220, z: 250 },
    nozzleMm: 0.4,
    version: "1.0.0",
  },
]

// OWNER DECISION REQUIRED: materials, colors in stock, min walls, densities, prices.
export const materialProfiles: MaterialProfile[] = [
  {
    id: "pla",
    name: "PLA",
    minWallMm: 0.8,
    densityGCm3: 1.24,
    pricePerGramMinor: 300,
    colors: [
      { id: "pla-white", name: "White", hex: "#f5f5f5", inStock: true },
      { id: "pla-black", name: "Black", hex: "#1a1a1a", inStock: true },
      { id: "pla-forge-orange", name: "Forge Orange", hex: "#e8622c", inStock: true },
      { id: "pla-slate", name: "Slate", hex: "#4a5568", inStock: false },
    ],
  },
  {
    id: "petg",
    name: "PETG",
    minWallMm: 1.0,
    densityGCm3: 1.27,
    pricePerGramMinor: 400,
    colors: [
      { id: "petg-clear", name: "Clear", hex: "#e8f0f0", inStock: true },
      { id: "petg-black", name: "Black", hex: "#1a1a1a", inStock: true },
    ],
  },
]

// OWNER DECISION REQUIRED: layer heights + realistic time factors.
export const qualityPresets: QualityPreset[] = [
  { id: "standard", name: "Standard", layerHeightMm: 0.2, timeFactor: 1.0 },
  { id: "fine", name: "Fine", layerHeightMm: 0.12, timeFactor: 1.6 },
]

// OWNER DECISION REQUIRED: infill percentages + material factors.
export const strengthPresets: StrengthPreset[] = [
  { id: "display", name: "Display", infillPct: 10, materialFactor: 1.0 },
  { id: "everyday", name: "Everyday", infillPct: 25, materialFactor: 1.15 },
  { id: "reinforced", name: "Reinforced", infillPct: 50, materialFactor: 1.4 },
]

export const DEFAULT_PRINTER_PROFILE_ID = "generic-fdm"
export const DEFAULT_MATERIAL_ID = "pla"

export function getPrinterProfile(id: string = DEFAULT_PRINTER_PROFILE_ID): PrinterProfile {
  return printerProfiles.find((p) => p.id === id) ?? (printerProfiles[0] as PrinterProfile)
}

export function getMaterialProfile(id: string = DEFAULT_MATERIAL_ID): MaterialProfile {
  return materialProfiles.find((m) => m.id === id) ?? (materialProfiles[0] as MaterialProfile)
}

export function getQualityPreset(id: string): QualityPreset | undefined {
  return qualityPresets.find((q) => q.id === id)
}

export function getStrengthPreset(id: string): StrengthPreset | undefined {
  return strengthPresets.find((s) => s.id === id)
}
