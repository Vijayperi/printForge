import { z } from "zod"

import { getAuthGateway } from "@/src/adapters/auth/factory"
import {
  getPrinterProfile,
  materialProfiles,
  qualityPresets,
  SHIPPING_SPEEDS,
  strengthPresets,
} from "@/src/config/profiles"
import { getDesignVersion } from "@/src/data/designVersions"
import {
  getConfiguration,
  upsertConfiguration,
  type ConfigurationValues,
} from "@/src/data/printConfigurations"
import { getRequestDb, getServiceDb } from "@/src/data/supabaseClients"
import {
  scaleHash,
  validateConfiguration,
  type ConfigCatalog,
  type PrintConfigInput,
} from "@/src/domain/quoting/configuration"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"
import { appError, toHttpError, type AppError } from "@/src/lib/errors"

function jsonError(error: AppError): Response {
  const { status, body } = toHttpError(error)
  return Response.json(body, { status })
}

const bodySchema = z.object({
  materialId: z.string().min(1),
  colorId: z.string().min(1),
  dimensionsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  scaleFactor: z.number(),
  qualityId: z.string().min(1),
  strengthId: z.string().min(1),
  shippingSpeed: z.string().min(1),
  specialInstructions: z.string().default(""),
})

const CATALOG: ConfigCatalog = {
  profile: getPrinterProfile(),
  materials: materialProfiles,
  qualities: qualityPresets,
  strengths: strengthPresets,
  shippingSpeeds: SHIPPING_SPEEDS,
}

function toValues(input: PrintConfigInput): ConfigurationValues {
  return {
    materialId: input.materialId,
    colorId: input.colorId,
    dimensionsMm: input.dimensionsMm,
    scaleFactor: input.scaleFactor,
    qualityId: input.qualityId,
    strengthId: input.strengthId,
    shippingSpeed: input.shippingSpeed,
    specialInstructions: input.specialInstructions,
  }
}

/** The current saved configuration for an owned design version, or null. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return jsonError(appError("unauthorized", "sign in required"))

  const { id } = await params
  const db = await getRequestDb()
  const dv = await getDesignVersion(db, id)
  if (!dv.ok) return jsonError(dv.error)
  if (dv.value === null) return jsonError(appError("not_found", "design version not found"))

  const config = await getConfiguration(db, id)
  if (!config.ok) return jsonError(config.error)
  return Response.json({ configuration: config.value }, { status: 200 })
}

/**
 * Persist a configuration for an owned design version (plan §6-S11). Validates
 * against the §4.5 profiles; a scale change re-enqueues `validation.run` for the
 * new (design version, profile, scale) so printability re-checks at the chosen
 * size. Colour/quality/strength/shipping changes persist without re-validating.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) return jsonError(appError("unauthorized", "sign in required"))

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError(appError("validation", "expected a JSON body"))
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return jsonError(appError("validation", "invalid configuration body"))

  const validated = validateConfiguration(parsed.data, CATALOG)
  if (!validated.ok) {
    return Response.json(
      { error: { code: "validation", message: "configuration is not valid" }, violations: validated.error },
      { status: 400 }
    )
  }

  const { id } = await params
  const db = await getRequestDb()
  const dv = await getDesignVersion(db, id)
  if (!dv.ok) return jsonError(dv.error)
  if (dv.value === null) return jsonError(appError("not_found", "design version not found"))

  const prior = await getConfiguration(db, id)
  if (!prior.ok) return jsonError(prior.error)
  const priorScale = prior.value?.scale_factor ?? 1
  const newHash = scaleHash(validated.value.scaleFactor)
  const scaleChanged = newHash !== scaleHash(priorScale)

  const saved = await upsertConfiguration(db, id, toValues(validated.value))
  if (!saved.ok) return jsonError(saved.error)

  if (scaleChanged) {
    const queue = new PostgresJobQueue(getServiceDb(), new SystemClock())
    const enqueue = await queue.enqueue({
      type: "validation.run",
      payload: {
        designVersionId: id,
        scaleFactor: validated.value.scaleFactor,
        scaleHash: newHash,
        printerProfileId: CATALOG.profile.id,
        materialId: validated.value.materialId,
      },
      idempotencyKey: `validate:${id}:${newHash}`,
    })
    if (!enqueue.ok) return jsonError(enqueue.error)
  }

  return Response.json(
    { configuration: saved.value, revalidating: scaleChanged, scaleHash: newHash },
    { status: 200 }
  )
}
