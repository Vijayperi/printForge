"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Textarea } from "@/src/components/ui/textarea"
import { configurationContent } from "@/src/config/content"
import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_QUALITY_ID,
  DEFAULT_SHIPPING_SPEED,
  DEFAULT_STRENGTH_ID,
  getMaterialProfile,
  getPrinterProfile,
  materialProfiles,
  qualityPresets,
  SHIPPING_SPEEDS,
  strengthPresets,
  type MaterialColor,
  type PrinterProfile,
} from "@/src/config/profiles"
import {
  applyScale,
  longestDim,
  MAX_INSTRUCTIONS,
  MIN_LONGEST_MM,
  validateConfiguration,
  type ConfigCatalog,
  type ConfigViolation,
  type Dimensions,
  type PrintConfigInput,
} from "@/src/domain/quoting/configuration"
import type { PrintConfigurationRow } from "@/src/domain/types"

const POLL_MS = 2000
const SAVE_DEBOUNCE_MS = 800

const CATALOG: ConfigCatalog = {
  profile: getPrinterProfile(),
  materials: materialProfiles,
  qualities: qualityPresets,
  strengths: strengthPresets,
  shippingSpeeds: SHIPPING_SPEEDS,
}

export interface ConfigFormState {
  materialId: string
  colorId: string
  qualityId: string
  strengthId: string
  shippingSpeed: string
  instructions: string
  targetLongestMm: number
}

export interface LiveConfig {
  swatchColor: string | null
  scaleFactor: number
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** In-stock colours of a material (the only ones we let customers pick). */
export function inStockColors(materialId: string): MaterialColor[] {
  return getMaterialProfile(materialId).colors.filter((c) => c.inStock)
}

function firstColorId(materialId: string): string {
  // Every catalog material carries at least one in-stock colour (§4.5 invariant).
  return inStockColors(materialId)[0]!.id
}

/** Initialise the form from a saved configuration, or sensible defaults. */
export function buildInitialForm(saved: PrintConfigurationRow | null, base: Dimensions): ConfigFormState {
  const baseLongest = longestDim(base)
  if (saved !== null) {
    return {
      materialId: saved.material_id,
      colorId: saved.color_id,
      qualityId: saved.quality_id,
      strengthId: saved.strength_id,
      shippingSpeed: saved.shipping_speed,
      instructions: saved.special_instructions,
      targetLongestMm: round1(baseLongest * saved.scale_factor),
    }
  }
  return {
    materialId: DEFAULT_MATERIAL_ID,
    colorId: firstColorId(DEFAULT_MATERIAL_ID),
    qualityId: DEFAULT_QUALITY_ID,
    strengthId: DEFAULT_STRENGTH_ID,
    shippingSpeed: DEFAULT_SHIPPING_SPEED,
    instructions: "",
    targetLongestMm: round1(baseLongest),
  }
}

/** Turn the form + base dimensions into the API/domain input (applies scale). */
export function formToInput(form: ConfigFormState, base: Dimensions): PrintConfigInput {
  const { dims, scaleFactor } = applyScale(base, form.targetLongestMm)
  return {
    materialId: form.materialId,
    colorId: form.colorId,
    dimensionsMm: dims,
    scaleFactor,
    qualityId: form.qualityId,
    strengthId: form.strengthId,
    shippingSpeed: form.shippingSpeed,
    specialInstructions: form.instructions,
  }
}

/** The two things the 3D viewer reacts to live: swatch colour + scale. */
export function liveOf(form: ConfigFormState, base: Dimensions): LiveConfig {
  const color = getMaterialProfile(form.materialId).colors.find((c) => c.id === form.colorId)
  return { swatchColor: color?.hex ?? null, scaleFactor: applyScale(base, form.targetLongestMm).scaleFactor }
}

/** Slider/input bounds: at least the minimum, at most what fits the build volume. */
export function sizeBounds(base: Dimensions, profile: PrinterProfile): { min: number; max: number } {
  const baseLongest = longestDim(base)
  if (baseLongest === 0) return { min: MIN_LONGEST_MM, max: MIN_LONGEST_MM }
  const maxScale = Math.min(
    profile.buildVolumeMm.x / base.x,
    profile.buildVolumeMm.y / base.y,
    profile.buildVolumeMm.z / base.z
  )
  return { min: MIN_LONGEST_MM, max: Math.max(MIN_LONGEST_MM, Math.floor(baseLongest * maxScale)) }
}

function violationFor(violations: ConfigViolation[], field: ConfigViolation["field"]): string | null {
  return violations.find((v) => v.field === field)?.message ?? null
}

interface ValidationBody {
  measurements: { boundingMm: Dimensions } | null
  scaleHash: string | null
}

/**
 * Configure tab (plan §6-S11). Loads the saved configuration + the model's base
 * measurements, renders the size/material/colour/quality/strength/shipping/notes
 * controls with live constraints, autosaves (debounced) + explicit Save, and — on
 * a size change — re-checks printability at the new scale (`onLiveChange` feeds
 * the viewer's colour + scale so the 3D preview tracks the form).
 */
export function ConfigurePanel({
  designVersionId,
  onLiveChange,
}: {
  designVersionId: string
  onLiveChange: (live: LiveConfig) => void
}) {
  const [form, setForm] = useState<ConfigFormState | null>(null)
  const [base, setBase] = useState<Dimensions | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [pendingHash, setPendingHash] = useState<string | null>(null)

  const savedConfigRef = useRef<PrintConfigurationRow | null | undefined>(undefined)
  const baseRef = useRef<Dimensions | null>(null)
  const initializedRef = useRef(false)
  const mountedRef = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const configUrl = `/api/design-versions/${designVersionId}/configuration`
  const validationUrl = `/api/design-versions/${designVersionId}/validation`

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(saveTimer.current)
    }
  }, [])

  // Initialise the form exactly once, as soon as we have BOTH the saved config
  // (or its absence) and the model's base measurements — whichever lands last.
  const tryInit = useCallback(() => {
    if (initializedRef.current) return
    if (savedConfigRef.current === undefined || baseRef.current === null) return
    initializedRef.current = true
    const initial = buildInitialForm(savedConfigRef.current, baseRef.current)
    setForm(initial)
    onLiveChange(liveOf(initial, baseRef.current))
  }, [onLiveChange])

  // Load the saved configuration once.
  useEffect(() => {
    let active = true
    void fetch(configUrl).then(async (res) => {
      const cfg = res.ok
        ? ((await res.json()) as { configuration: PrintConfigurationRow | null }).configuration
        : null
      if (!active) return
      savedConfigRef.current = cfg
      tryInit()
    })
    return () => {
      active = false
    }
  }, [configUrl, tryInit])

  // Poll the validation report for the base measurements, and — after a size
  // change — until the fresh (scaled) report lands (matching `pendingHash`).
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async (): Promise<void> => {
      const res = await fetch(validationUrl)
      const body = res.ok ? ((await res.json()) as ValidationBody) : null
      if (!active) return
      if (body !== null) {
        const dims = body.measurements?.boundingMm ?? null
        if (dims !== null) {
          if (baseRef.current === null) {
            baseRef.current = dims
            setBase(dims)
          }
          tryInit()
        }
        const matched = pendingHash === null || body.scaleHash === pendingHash
        if (pendingHash !== null && matched) setPendingHash(null)
        if (dims !== null && matched) return
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }

    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [validationUrl, pendingHash, tryInit])

  const save = useCallback(
    async (next: ConfigFormState, baseDims: Dimensions): Promise<void> => {
      const input = formToInput(next, baseDims)
      if (!validateConfiguration(input, CATALOG).ok) {
        setSaveState("idle")
        return
      }
      setSaveState("saving")
      const res = await fetch(configUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
      const body = res.ok ? ((await res.json()) as { revalidating: boolean; scaleHash: string }) : null
      if (!mountedRef.current) return
      if (body === null) {
        setSaveState("error")
        return
      }
      setSaveState("saved")
      if (body.revalidating) setPendingHash(body.scaleHash)
    },
    [configUrl]
  )

  if (form === null || base === null) {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{configurationContent.title}</h3>
        <p className="text-sm text-muted-foreground" role="status">
          {configurationContent.measuringLabel}
        </p>
      </div>
    )
  }

  const input = formToInput(form, base)
  const validation = validateConfiguration(input, CATALOG)
  const violations = validation.ok ? [] : validation.error
  const bounds = sizeBounds(base, CATALOG.profile)

  const update = (patch: Partial<ConfigFormState>): void => {
    const next = { ...form, ...patch }
    setForm(next)
    setSaveState("idle")
    onLiveChange(liveOf(next, base))
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(next, base), SAVE_DEBOUNCE_MS)
  }

  const onMaterialChange = (materialId: string): void => {
    update({ materialId, colorId: firstColorId(materialId) })
  }

  const saveNow = (): void => {
    clearTimeout(saveTimer.current)
    void save(form, base)
  }

  return (
    <section aria-labelledby="configure-heading" className="space-y-5">
      <div className="space-y-1">
        <h3 id="configure-heading" className="text-lg font-semibold">
          {configurationContent.title}
        </h3>
        <p className="text-sm text-muted-foreground">{configurationContent.intro}</p>
      </div>

      {/* Size */}
      <div className="space-y-2">
        <label htmlFor="cfg-size" className="text-sm font-medium">
          {configurationContent.size.label}
        </label>
        <div className="flex items-center gap-3">
          <input
            id="cfg-size"
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={1}
            value={form.targetLongestMm}
            onChange={(e) => update({ targetLongestMm: Number(e.target.value) })}
            className="w-full accent-primary"
          />
          <Input
            type="number"
            aria-label={`${configurationContent.size.label} in ${configurationContent.size.unit}`}
            min={bounds.min}
            max={bounds.max}
            value={form.targetLongestMm}
            onChange={(e) => update({ targetLongestMm: Number(e.target.value) })}
            className="w-24"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {configurationContent.size.help} · {dimsLabel(input.dimensionsMm)}
        </p>
        {violationFor(violations, "size") !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {violationFor(violations, "size")}
          </p>
        ) : null}
      </div>

      {/* Material */}
      <div className="space-y-2">
        <label htmlFor="cfg-material" className="text-sm font-medium">
          {configurationContent.material.label}
        </label>
        <select
          id="cfg-material"
          value={form.materialId}
          onChange={(e) => onMaterialChange(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {materialProfiles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Colour */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{configurationContent.color.label}</legend>
        <div className="flex flex-wrap gap-3">
          {inStockColors(form.materialId).map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-sm has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary"
            >
              <input
                type="radio"
                name="cfg-color"
                value={c.id}
                checked={form.colorId === c.id}
                onChange={() => update({ colorId: c.id })}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="size-4 rounded-full border"
                style={{ backgroundColor: c.hex }}
              />
              {c.name}
            </label>
          ))}
        </div>
        {violationFor(violations, "color") !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {violationFor(violations, "color")}
          </p>
        ) : null}
      </fieldset>

      {/* Quality */}
      <RadioCards
        legend={configurationContent.quality.label}
        name="cfg-quality"
        selected={form.qualityId}
        onSelect={(qualityId) => update({ qualityId })}
        options={qualityPresets.map((q) => {
          const copy = configurationContent.quality.options[q.id]!
          return { id: q.id, name: copy.name, description: copy.description }
        })}
      />

      {/* Strength */}
      <RadioCards
        legend={configurationContent.strength.label}
        name="cfg-strength"
        selected={form.strengthId}
        onSelect={(strengthId) => update({ strengthId })}
        options={strengthPresets.map((s) => {
          const copy = configurationContent.strength.options[s.id]!
          return { id: s.id, name: copy.name, description: copy.description }
        })}
      />

      {/* Shipping */}
      <div className="space-y-2">
        <label htmlFor="cfg-shipping" className="text-sm font-medium">
          {configurationContent.shipping.label}
        </label>
        <select
          id="cfg-shipping"
          value={form.shippingSpeed}
          onChange={(e) => update({ shippingSpeed: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {SHIPPING_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {configurationContent.shipping.options[s]!.name}
            </option>
          ))}
        </select>
      </div>

      {/* Special instructions */}
      <div className="space-y-2">
        <label htmlFor="cfg-instructions" className="text-sm font-medium">
          {configurationContent.instructions.label}
        </label>
        <Textarea
          id="cfg-instructions"
          maxLength={MAX_INSTRUCTIONS}
          value={form.instructions}
          placeholder={configurationContent.instructions.placeholder}
          onChange={(e) => update({ instructions: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          {form.instructions.length}/{MAX_INSTRUCTIONS}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">{configurationContent.textureDisclaimer}</p>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={saveNow} disabled={!validation.ok || saveState === "saving"}>
          {saveState === "saving" ? configurationContent.saving : configurationContent.save}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {pendingHash !== null
            ? configurationContent.revalidating
            : saveState === "saved"
              ? configurationContent.saved
              : saveState === "error"
                ? configurationContent.saveError
                : ""}
        </span>
      </div>
    </section>
  )
}

function dimsLabel(d: Dimensions): string {
  return `${round1(d.x)}×${round1(d.y)}×${round1(d.z)} mm`
}

function RadioCards({
  legend,
  name,
  selected,
  onSelect,
  options,
}: {
  legend: string
  name: string
  selected: string
  onSelect: (id: string) => void
  options: { id: string; name: string; description: string }[]
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-2">
        {options.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary"
          >
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={selected === o.id}
              onChange={() => onSelect(o.id)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{o.name}</span>
              <span className="block text-xs text-muted-foreground">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
