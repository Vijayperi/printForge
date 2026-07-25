import "server-only"

import { z } from "zod"

import {
  assertPrinterIdle,
  type PrinterGateway,
  type PrinterGatewayState,
  type PrinterGatewayStatus,
  type ReleaseInput,
} from "@/src/adapters/printerGateway"
import type { AssetStorage } from "@/src/adapters/storage"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/**
 * OctoPrint gateway (docs.octoprint.org/en/main/api, re-verified 2026-07-26 per
 * plan §0.4). Endpoints used:
 *  - `GET  /api/printer` → `state.flags`; **409 when the printer is not
 *    operational**, which is how an unreachable machine announces itself;
 *  - `GET  /api/job` → the file on the bed + `progress.completion` (0–100);
 *  - `POST /api/files/local` → multipart upload (`file`, `select`);
 *  - `POST /api/files/local/{path}` → `{command:"select", print:true}` → 204;
 *  - `POST /api/job` → `{command:"cancel"}` → 204.
 *
 * Credentials come from `PRINTER_GATEWAY_CONFIG` (server env, JSON keyed by the
 * `printers.id` of each bay) and never from a database row a client can read —
 * FR-9, asserted by the bundle grep in CI.
 */

const GCODE_MIME = "text/plain"
const REF_PREFIX = "octoprint"

const printerConfigSchema = z.strictObject({
  baseUrl: z.url(),
  apiKey: z.string().min(1),
})

export const printerGatewayConfigSchema = z.record(z.string().min(1), printerConfigSchema)

export type PrinterGatewayConfig = z.infer<typeof printerGatewayConfigSchema>

/** Parse `PRINTER_GATEWAY_CONFIG`. Shape errors are configuration bugs, not runtime ones. */
export function parsePrinterGatewayConfig(raw: string): Result<PrinterGatewayConfig> {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return err(appError("validation", "PRINTER_GATEWAY_CONFIG is not valid JSON"))
  }
  const parsed = printerGatewayConfigSchema.safeParse(json)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return err(appError("validation", `invalid PRINTER_GATEWAY_CONFIG: ${detail}`))
  }
  return ok(parsed.data)
}

interface OctoPrintFlags {
  operational?: boolean
  printing?: boolean
  pausing?: boolean
  paused?: boolean
  cancelling?: boolean
  error?: boolean
  closedOrError?: boolean
}

/**
 * Collapse OctoPrint's nine independent booleans into our four states.
 *
 * `error` wins over everything; `closedOrError` without `error` means the serial
 * link is closed, which is unreachable rather than broken; a paused or
 * cancelling machine still has our file on its bed, so it counts as busy.
 */
export function stateFromFlags(flags: OctoPrintFlags): PrinterGatewayState {
  if (flags.error === true) return "error"
  if (flags.closedOrError === true) return "offline"
  if (
    flags.printing === true ||
    flags.pausing === true ||
    flags.paused === true ||
    flags.cancelling === true
  ) {
    return "busy"
  }
  return flags.operational === true ? "idle" : "offline"
}

/**
 * OctoPrint has no job identifiers — a print is only "the file that is loaded".
 * The ref therefore carries the two things needed to find it again: which bay,
 * and which file.
 */
export function encodeJobRef(printerId: string, fileName: string): string {
  return `${REF_PREFIX}:${printerId}:${fileName}`
}

export function decodeJobRef(ref: string): Result<{ printerId: string; fileName: string }> {
  const [prefix, printerId, fileName, ...rest] = ref.split(":")
  if (
    prefix !== REF_PREFIX ||
    printerId === undefined ||
    printerId === "" ||
    fileName === undefined ||
    fileName === "" ||
    rest.length > 0
  ) {
    return err(appError("not_found", `unknown gateway job ${ref}`))
  }
  return ok({ printerId, fileName })
}

/** What we uploaded is named after the dispatch, so a replay lands on the same file. */
export function gcodeFileName(idempotencyKey: string): string {
  return `${idempotencyKey}.gcode`
}

const BOUNDARY = "printforge-gcode-boundary"

/**
 * The upload body, assembled by hand rather than with `FormData`.
 *
 * G-code is bytes, and a hand-built body is byte-identical in every runtime —
 * `FormData` + `Blob` are environment-provided types, and jsdom's are not the
 * ones Node's multipart parser accepts, so building it here keeps the wire format
 * the same under test as in production.
 */
export function multipartGcodeBody(
  fileName: string,
  bytes: Uint8Array
): { contentType: string; body: ArrayBuffer } {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${GCODE_MIME}\r\n\r\n`
  )
  // Select the file but do not print yet: the print command is issued separately,
  // so "refused the file" and "refused to start" are distinguishable failures.
  const tail = encoder.encode(
    `\r\n--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="select"\r\n\r\ntrue\r\n` +
      `--${BOUNDARY}--\r\n`
  )
  const buffer = new ArrayBuffer(head.length + bytes.length + tail.length)
  const body = new Uint8Array(buffer)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return { contentType: `multipart/form-data; boundary=${BOUNDARY}`, body: buffer }
}

interface Observation {
  state: PrinterGatewayState
  /** The file on the bed, when the machine is busy with one. */
  jobFile: string | null
  progressPct: number | null
}

export interface OctoPrintGatewayDeps {
  storage: AssetStorage
  config: PrinterGatewayConfig
}

export class OctoPrintGateway implements PrinterGateway {
  constructor(private readonly deps: OctoPrintGatewayDeps) {}

  async release(job: ReleaseInput): Promise<Result<{ gatewayJobRef: string }>> {
    const printer = this.printerConfig(job.printerId)
    if (!printer.ok) return printer

    const fileName = gcodeFileName(job.idempotencyKey)
    const ref = encodeJobRef(job.printerId, fileName)

    const observed = await this.observe(printer.value)
    if (!observed.ok) return observed
    // Our own file is already on the bed: this is a replayed dispatch, so hand
    // back the same ref rather than uploading a second copy of the print.
    if (observed.value.jobFile === fileName) return ok({ gatewayJobRef: ref })

    const idle = assertPrinterIdle(observed.value.state)
    if (!idle.ok) return idle

    const gcode = await this.deps.storage.read(job.gcodeStorageKey)
    if (!gcode.ok) return gcode

    const uploaded = await this.upload(printer.value, fileName, gcode.value)
    if (!uploaded.ok) return uploaded

    const started = await this.selectAndPrint(printer.value, uploaded.value)
    if (!started.ok) return started

    return ok({ gatewayJobRef: ref })
  }

  async printerStatus(printerId: string): Promise<Result<PrinterGatewayStatus>> {
    const printer = this.printerConfig(printerId)
    if (!printer.ok) return printer

    const observed = await this.observe(printer.value)
    if (!observed.ok) return observed

    const status: PrinterGatewayStatus = { state: observed.value.state }
    if (observed.value.jobFile !== null) {
      status.currentJobRef = encodeJobRef(printerId, observed.value.jobFile)
    }
    if (observed.value.progressPct !== null) status.progressPct = observed.value.progressPct
    return ok(status)
  }

  async cancel(gatewayJobRef: string): Promise<Result<void>> {
    const decoded = decodeJobRef(gatewayJobRef)
    if (!decoded.ok) return decoded

    const printer = this.printerConfig(decoded.value.printerId)
    if (!printer.ok) return printer

    const observed = await this.observe(printer.value)
    if (!observed.ok) return observed
    // Nothing of ours is running: already finished or already cancelled.
    if (observed.value.jobFile === null) return ok(undefined)
    if (observed.value.jobFile !== decoded.value.fileName) {
      // Never stop a print we did not start.
      return err(
        appError("conflict", `the printer is printing ${observed.value.jobFile}, not this job`)
      )
    }

    const res = await this.send(printer.value, "/api/job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cancel" }),
    })
    if (!res.ok) return res
    if (res.value.status === 409) {
      return err(appError("precondition_failed", "the printer refused to cancel the print"))
    }
    if (!res.value.ok) {
      return err(appError("provider_error", `octoprint cancel failed with status ${res.value.status}`))
    }
    return ok(undefined)
  }

  private printerConfig(printerId: string): Result<{ baseUrl: string; apiKey: string }> {
    const printer = this.deps.config[printerId]
    if (printer === undefined) {
      return err(appError("not_found", `printer ${printerId} is not in the gateway configuration`))
    }
    return ok(printer)
  }

  /** One round of "what is this machine doing", normalized. */
  private async observe(printer: { baseUrl: string; apiKey: string }): Promise<Result<Observation>> {
    const res = await this.send(printer, "/api/printer", { method: "GET" })
    if (!res.ok) return res
    // 409 is OctoPrint's "the printer is not operational" — an offline bay.
    if (res.value.status === 409) return ok({ state: "offline", jobFile: null, progressPct: null })
    if (!res.value.ok) {
      return err(appError("provider_error", `octoprint state failed with status ${res.value.status}`))
    }

    const body = (await res.value.json()) as { state?: { flags?: OctoPrintFlags } }
    const state = stateFromFlags(body.state?.flags ?? {})
    if (state !== "busy") return ok({ state, jobFile: null, progressPct: null })
    return this.observeJob(printer, state)
  }

  /** The file and progress of the print currently loaded. */
  private async observeJob(
    printer: { baseUrl: string; apiKey: string },
    state: PrinterGatewayState
  ): Promise<Result<Observation>> {
    const res = await this.send(printer, "/api/job", { method: "GET" })
    if (!res.ok) return res
    if (!res.value.ok) {
      return err(appError("provider_error", `octoprint job failed with status ${res.value.status}`))
    }
    const body = (await res.value.json()) as {
      job?: { file?: { name?: string; path?: string } }
      progress?: { completion?: number }
    }
    const file = body.job?.file
    const completion = body.progress?.completion
    return ok({
      state,
      jobFile: file?.path ?? file?.name ?? null,
      // `completion` is a percentage, not a fraction (OctoPrint data model).
      progressPct: completion === undefined ? null : Math.round(completion),
    })
  }

  private async upload(
    printer: { baseUrl: string; apiKey: string },
    fileName: string,
    bytes: Uint8Array
  ): Promise<Result<string>> {
    const multipart = multipartGcodeBody(fileName, bytes)
    const res = await this.send(printer, "/api/files/local", {
      method: "POST",
      headers: { "Content-Type": multipart.contentType },
      body: multipart.body,
    })
    if (!res.ok) return res
    if (res.value.status === 409) {
      return err(appError("precondition_failed", "the printer refused the upload"))
    }
    if (!res.value.ok) {
      return err(appError("provider_error", `octoprint upload failed with status ${res.value.status}`))
    }
    const body = (await res.value.json()) as { files?: { local?: { path?: string } } }
    return ok(body.files?.local?.path ?? fileName)
  }

  private async selectAndPrint(
    printer: { baseUrl: string; apiKey: string },
    path: string
  ): Promise<Result<void>> {
    const res = await this.send(printer, `/api/files/local/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "select", print: true }),
    })
    if (!res.ok) return res
    if (res.value.status === 409) {
      return err(appError("precondition_failed", "the printer refused to start the print"))
    }
    if (!res.value.ok) {
      return err(appError("provider_error", `octoprint print failed with status ${res.value.status}`))
    }
    return ok(undefined)
  }

  /** Every call carries the bay's own API key; transport failures become provider errors. */
  private async send(
    printer: { baseUrl: string; apiKey: string },
    path: string,
    init: RequestInit
  ): Promise<Result<Response>> {
    try {
      const res = await fetch(`${printer.baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, "X-Api-Key": printer.apiKey },
      })
      return ok(res)
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : "unreachable"
      return err(appError("provider_error", `octoprint request to ${path} failed: ${detail}`))
    }
  }
}
