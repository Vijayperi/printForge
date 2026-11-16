import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { printerGatewayContract } from "@/src/adapters/printerGateway/contract.spec-factory"
import {
  decodeJobRef,
  encodeJobRef,
  gcodeFileName,
  OctoPrintGateway,
  parsePrinterGatewayConfig,
  stateFromFlags,
} from "@/src/adapters/printerGateway/octoprint"
import { InMemoryStorage } from "@/src/adapters/storage/memory"
import { server } from "@/tests/msw/server"

const IDLE = "prn_bay1"
const OFFLINE = "prn_bay2"
const IDLE_BASE = "http://octopi-bay1.local"
const OFFLINE_BASE = "http://octopi-bay2.local"
const API_KEY = "octo-bay1-key"
const GCODE = "G28 ; home\nG1 Z5\n"

const CONFIG = {
  [IDLE]: { baseUrl: IDLE_BASE, apiKey: API_KEY },
  [OFFLINE]: { baseUrl: OFFLINE_BASE, apiKey: "octo-bay2-key" },
}

/**
 * A stateful stand-in for one OctoPrint instance: enough of `/api/printer`,
 * `/api/job`, `/api/files/local` and `/api/job` (commands) that a release, a
 * poll and a cancel behave the way a real machine makes them behave.
 */
interface FakePrinter {
  operational: boolean
  printing: boolean
  error: boolean
  jobFile: string | null
  completion: number
  uploads: { fileName: string; select: string | null; body: string }[]
  commands: unknown[]
  apiKeys: string[]
}

let bay: FakePrinter
let storage: InMemoryStorage
let gcodeKey: string

function newFakePrinter(): FakePrinter {
  return {
    operational: true,
    printing: false,
    error: false,
    jobFile: null,
    completion: 0,
    uploads: [],
    commands: [],
    apiKeys: [],
  }
}

/**
 * Read a multipart body by hand. `request.formData()` cannot be used here:
 * undici's parser builds a `File` and then brand-checks it against the global
 * one, which under jsdom is a different class — so it throws on any multipart
 * body, however well-formed. OctoPrint reads the raw parts too.
 */
function parseMultipart(text: string): Map<string, { value: string; fileName?: string }> {
  const fields = new Map<string, { value: string; fileName?: string }>()
  for (const raw of text.split(/--printforge-gcode-boundary(?:--)?/)) {
    const part = raw.replace(/^\r\n/, "").replace(/\r\n$/, "")
    const split = part.indexOf("\r\n\r\n")
    if (split === -1) continue
    const headers = part.slice(0, split)
    const value = part.slice(split + 4)
    const name = /name="([^"]+)"/.exec(headers)?.[1]
    if (name === undefined) continue
    const fileName = /filename="([^"]+)"/.exec(headers)?.[1]
    fields.set(name, fileName === undefined ? { value } : { value, fileName })
  }
  return fields
}

function handlersFor(base: string, printer: () => FakePrinter) {
  return [
    http.get(`${base}/api/printer`, ({ request }) => {
      const it = printer()
      it.apiKeys.push(request.headers.get("X-Api-Key") ?? "")
      // OctoPrint answers 409 while the printer is not operational.
      if (!it.operational) return HttpResponse.json({ error: "Printer is not operational" }, { status: 409 })
      return HttpResponse.json({
        state: {
          text: it.printing ? "Printing" : "Operational",
          flags: {
            operational: true,
            printing: it.printing,
            paused: false,
            pausing: false,
            cancelling: false,
            error: it.error,
            ready: !it.printing,
            closedOrError: false,
            sdReady: false,
          },
        },
      })
    }),
    http.get(`${base}/api/job`, () => {
      const it = printer()
      return HttpResponse.json({
        job: it.jobFile === null ? {} : { file: { name: it.jobFile, path: it.jobFile } },
        progress: { completion: it.completion, printTime: 120, printTimeLeft: 600 },
      })
    }),
    http.post(`${base}/api/files/local`, async ({ request }) => {
      const it = printer()
      const form = parseMultipart(await request.text())
      const file = form.get("file")
      const name = file?.fileName ?? ""
      it.uploads.push({
        fileName: name,
        select: form.get("select")?.value ?? null,
        body: file?.value ?? "",
      })
      return HttpResponse.json(
        { files: { local: { name, path: name, origin: "local" } }, done: true },
        { status: 201 }
      )
    }),
    http.post(`${base}/api/files/local/:path`, async ({ params, request }) => {
      const it = printer()
      it.commands.push(await request.json())
      it.printing = true
      it.jobFile = String(params["path"])
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${base}/api/job`, async ({ request }) => {
      const it = printer()
      it.commands.push(await request.json())
      it.printing = false
      it.jobFile = null
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

function makeGateway() {
  return new OctoPrintGateway({ storage, config: CONFIG })
}

function input(printerId: string, printJobId = "pj_1") {
  return {
    printJobId,
    printerId,
    gcodeStorageKey: gcodeKey,
    idempotencyKey: printJobId,
  }
}

beforeEach(async () => {
  bay = newFakePrinter()
  storage = new InMemoryStorage()
  const stored = await storage.put(new TextEncoder().encode(GCODE), {
    keyPrefix: "gcode",
    mime: "text/plain",
  })
  gcodeKey = stored.ok ? stored.value.storageKey : ""
  server.use(
    ...handlersFor(IDLE_BASE, () => bay),
    // Bay 2 never answers: an unplugged or powered-down machine.
    http.get(`${OFFLINE_BASE}/api/printer`, () =>
      HttpResponse.json({ error: "Printer is not operational" }, { status: 409 })
    )
  )
})

printerGatewayContract(() => ({
  gateway: makeGateway(),
  idlePrinterId: IDLE,
  offlinePrinterId: OFFLINE,
  unknownJobRef: "not-an-octoprint-ref",
  gcodeStorageKey: gcodeKey,
}))

describe("parsePrinterGatewayConfig", () => {
  it("reads a fleet keyed by printer id", () => {
    const parsed = parsePrinterGatewayConfig(JSON.stringify(CONFIG))
    expect(parsed.ok && parsed.value[IDLE]).toEqual({ baseUrl: IDLE_BASE, apiKey: API_KEY })
  })

  it("rejects malformed JSON", () => {
    const parsed = parsePrinterGatewayConfig("{nope")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("validation")
      expect(parsed.error.message).toBe("PRINTER_GATEWAY_CONFIG is not valid JSON")
    }
  })

  it("rejects a printer entry missing its credentials", () => {
    const parsed = parsePrinterGatewayConfig(JSON.stringify({ prn_1: { baseUrl: IDLE_BASE } }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("validation")
      expect(parsed.error.message).toMatch(/prn_1\.apiKey/)
    }
  })
})

describe("stateFromFlags", () => {
  const cases = [
    ["an errored machine", { operational: true, error: true }, "error"],
    ["a closed serial link", { closedOrError: true }, "offline"],
    ["a printing machine", { operational: true, printing: true }, "busy"],
    ["a paused machine", { operational: true, paused: true }, "busy"],
    ["a pausing machine", { operational: true, pausing: true }, "busy"],
    ["a cancelling machine", { operational: true, cancelling: true }, "busy"],
    ["an operational machine", { operational: true }, "idle"],
    ["a machine reporting nothing", {}, "offline"],
  ] as const

  it.each(cases)("maps %s to %s", (_label, flags, expected) => {
    expect(stateFromFlags(flags)).toBe(expected)
  })
})

describe("job refs", () => {
  it("round-trips a printer and file name", () => {
    const ref = encodeJobRef(IDLE, gcodeFileName("pj_9"))
    expect(decodeJobRef(ref)).toEqual({ ok: true, value: { printerId: IDLE, fileName: "pj_9.gcode" } })
  })

  const malformed = ["", "pj_9.gcode", "octoprint:", "octoprint::pj_9.gcode", "octoprint:prn:a:b"]

  it.each(malformed)("refuses %o as a job ref", (ref) => {
    const decoded = decodeJobRef(ref)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error.code).toBe("not_found")
  })
})

describe("OctoPrintGateway", () => {
  it("uploads the gcode with the bay's own api key, then starts the print", async () => {
    const released = await makeGateway().release(input(IDLE))
    expect(released.ok && released.value.gatewayJobRef).toBe(
      encodeJobRef(IDLE, "pj_1.gcode")
    )

    expect(bay.uploads).toEqual([
      { fileName: "pj_1.gcode", select: "true", body: GCODE },
    ])
    // Select is explicit, and the print command is separate from the upload.
    expect(bay.commands).toEqual([{ command: "select", print: true }])
    expect(bay.apiKeys.every((key) => key === API_KEY)).toBe(true)
  })

  it("reports progress and the loaded file while printing", async () => {
    const gateway = makeGateway()
    await gateway.release(input(IDLE))
    bay.completion = 42.6

    const status = await gateway.printerStatus(IDLE)
    expect(status.ok && status.value).toEqual({
      state: "busy",
      currentJobRef: encodeJobRef(IDLE, "pj_1.gcode"),
      progressPct: 43,
    })
  })

  it("reports busy without progress when the job endpoint omits it", async () => {
    const gateway = makeGateway()
    await gateway.release(input(IDLE))
    server.use(
      http.get(`${IDLE_BASE}/api/job`, () => HttpResponse.json({ job: {}, progress: {} }))
    )

    const status = await gateway.printerStatus(IDLE)
    expect(status.ok && status.value).toEqual({ state: "busy" })
  })

  it("falls back to the file name when the machine reports no stored path", async () => {
    const gateway = makeGateway()
    await gateway.release(input(IDLE))
    server.use(
      http.get(`${IDLE_BASE}/api/job`, () =>
        HttpResponse.json({ job: { file: { name: "pj_1.gcode" } }, progress: { completion: 5 } })
      )
    )

    const status = await gateway.printerStatus(IDLE)
    expect(status.ok && status.value.currentJobRef).toBe(encodeJobRef(IDLE, "pj_1.gcode"))
  })

  it("does not upload a second copy when a dispatch is replayed", async () => {
    const gateway = makeGateway()
    const first = await gateway.release(input(IDLE))
    const second = await gateway.release(input(IDLE))

    expect(first.ok && second.ok && first.value).toEqual(second.ok ? second.value : null)
    expect(bay.uploads).toHaveLength(1)
    expect(bay.commands).toHaveLength(1)
  })

  it("refuses to release to a machine that is printing something else", async () => {
    bay.printing = true
    bay.jobFile = "someone-elses-print.gcode"

    const released = await makeGateway().release(input(IDLE))
    expect(released.ok).toBe(false)
    if (!released.ok) {
      expect(released.error.code).toBe("precondition_failed")
      expect(released.error.message).toBe("the printer is busy with another job")
    }
    expect(bay.uploads).toHaveLength(0)
  })

  it("refuses a printer that is not in the fleet configuration", async () => {
    const gateway = makeGateway()
    for (const result of [
      await gateway.release(input("prn_ghost")),
      await gateway.printerStatus("prn_ghost"),
      await gateway.cancel(encodeJobRef("prn_ghost", "pj_1.gcode")),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe("not_found")
        expect(result.error.message).toBe("printer prn_ghost is not in the gateway configuration")
      }
    }
  })

  it("surfaces a missing gcode file instead of starting a blank print", async () => {
    const gateway = new OctoPrintGateway({ storage: new InMemoryStorage(), config: CONFIG })
    const released = await gateway.release(input(IDLE))
    expect(released.ok).toBe(false)
    expect(bay.uploads).toHaveLength(0)
  })

  it("stops our own print and leaves the bed free", async () => {
    const gateway = makeGateway()
    const released = await gateway.release(input(IDLE))
    if (!released.ok) return expect.unreachable("release failed")

    const cancelled = await gateway.cancel(released.value.gatewayJobRef)
    expect(cancelled.ok).toBe(true)
    expect(bay.commands).toEqual([{ command: "select", print: true }, { command: "cancel" }])
    expect(bay.jobFile).toBeNull()
  })

  it("never stops a print it did not start", async () => {
    bay.printing = true
    bay.jobFile = "someone-elses-print.gcode"

    const cancelled = await makeGateway().cancel(encodeJobRef(IDLE, "pj_1.gcode"))
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) {
      expect(cancelled.error.code).toBe("conflict")
      expect(cancelled.error.message).toBe(
        "the printer is printing someone-elses-print.gcode, not this job"
      )
    }
    expect(bay.commands).toHaveLength(0)
  })

  it("treats cancelling an already-finished print as done", async () => {
    const cancelled = await makeGateway().cancel(encodeJobRef(IDLE, "pj_1.gcode"))
    expect(cancelled.ok).toBe(true)
    expect(bay.commands).toHaveLength(0)
  })

  describe("when the machine misbehaves", () => {
    it("reports a refused upload as a precondition failure", async () => {
      server.use(
        http.post(`${IDLE_BASE}/api/files/local`, () =>
          HttpResponse.json({ error: "conflict" }, { status: 409 })
        )
      )
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) {
        expect(released.error.code).toBe("precondition_failed")
        expect(released.error.message).toBe("the printer refused the upload")
      }
    })

    it("reports a failed upload as a provider error", async () => {
      server.use(
        http.post(`${IDLE_BASE}/api/files/local`, () => new HttpResponse(null, { status: 500 }))
      )
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) {
        expect(released.error.code).toBe("provider_error")
        expect(released.error.message).toMatch(/upload failed with status 500/)
      }
    })

    it("falls back to the uploaded name when the response omits the stored path", async () => {
      server.use(
        http.post(`${IDLE_BASE}/api/files/local`, () =>
          HttpResponse.json({ done: true }, { status: 201 })
        )
      )
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(true)
      expect(bay.jobFile).toBe("pj_1.gcode")
    })

    it("reports a refused print start as a precondition failure", async () => {
      server.use(
        http.post(`${IDLE_BASE}/api/files/local/:path`, () =>
          HttpResponse.json({ error: "already printing" }, { status: 409 })
        )
      )
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) {
        expect(released.error.code).toBe("precondition_failed")
        expect(released.error.message).toBe("the printer refused to start the print")
      }
    })

    it("reports a failed print start as a provider error", async () => {
      server.use(
        http.post(`${IDLE_BASE}/api/files/local/:path`, () => new HttpResponse(null, { status: 500 }))
      )
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) expect(released.error.message).toMatch(/print failed with status 500/)
    })

    it("treats a state response with no flags at all as offline", async () => {
      server.use(http.get(`${IDLE_BASE}/api/printer`, () => HttpResponse.json({})))
      const status = await makeGateway().printerStatus(IDLE)
      expect(status.ok && status.value).toEqual({ state: "offline" })
    })

    it("reports a broken state endpoint as a provider error", async () => {
      server.use(http.get(`${IDLE_BASE}/api/printer`, () => new HttpResponse(null, { status: 500 })))
      const status = await makeGateway().printerStatus(IDLE)
      expect(status.ok).toBe(false)
      if (!status.ok) {
        expect(status.error.code).toBe("provider_error")
        expect(status.error.message).toMatch(/state failed with status 500/)
      }
    })

    it("reports a broken job endpoint as a provider error", async () => {
      const gateway = makeGateway()
      await gateway.release(input(IDLE))
      server.use(http.get(`${IDLE_BASE}/api/job`, () => new HttpResponse(null, { status: 500 })))

      const status = await gateway.printerStatus(IDLE)
      expect(status.ok).toBe(false)
      if (!status.ok) expect(status.error.message).toMatch(/job failed with status 500/)
    })

    it("reports a refused cancel as a precondition failure", async () => {
      const gateway = makeGateway()
      const released = await gateway.release(input(IDLE))
      if (!released.ok) return expect.unreachable("release failed")
      server.use(
        http.post(`${IDLE_BASE}/api/job`, () => HttpResponse.json({ error: "no" }, { status: 409 }))
      )

      const cancelled = await gateway.cancel(released.value.gatewayJobRef)
      expect(cancelled.ok).toBe(false)
      if (!cancelled.ok) {
        expect(cancelled.error.code).toBe("precondition_failed")
        expect(cancelled.error.message).toBe("the printer refused to cancel the print")
      }
    })

    it("reports a failed cancel as a provider error", async () => {
      const gateway = makeGateway()
      const released = await gateway.release(input(IDLE))
      if (!released.ok) return expect.unreachable("release failed")
      server.use(http.post(`${IDLE_BASE}/api/job`, () => new HttpResponse(null, { status: 500 })))

      const cancelled = await gateway.cancel(released.value.gatewayJobRef)
      expect(cancelled.ok).toBe(false)
      if (!cancelled.ok) expect(cancelled.error.message).toMatch(/cancel failed with status 500/)
    })

    it("reports an unreachable machine as a provider error", async () => {
      server.use(http.get(`${IDLE_BASE}/api/printer`, () => HttpResponse.error()))
      const status = await makeGateway().printerStatus(IDLE)
      expect(status.ok).toBe(false)
      if (!status.ok) {
        expect(status.error.code).toBe("provider_error")
        expect(status.error.message).toMatch(/request to \/api\/printer failed/)
      }
    })
  })

  /**
   * Every call can drop mid-flight — the machines are on a workshop LAN. Each
   * step must surface that as a provider error rather than a false success, so
   * the dispatch job retries instead of the order sitting silently unprinted.
   */
  describe("when the network drops", () => {
    async function releaseAndThenBreak(path: string, method: "get" | "post") {
      const gateway = makeGateway()
      const released = await gateway.release(input(IDLE))
      expect(released.ok).toBe(true)
      server.use(http[method](`${IDLE_BASE}${path}`, () => HttpResponse.error()))
      return { gateway, ref: released.ok ? released.value.gatewayJobRef : "" }
    }

    it("during the state check of a release", async () => {
      server.use(http.get(`${IDLE_BASE}/api/printer`, () => HttpResponse.error()))
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) expect(released.error.code).toBe("provider_error")
    })

    it("during the upload", async () => {
      server.use(http.post(`${IDLE_BASE}/api/files/local`, () => HttpResponse.error()))
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) {
        expect(released.error.message).toMatch(/request to \/api\/files\/local failed/)
      }
    })

    it("while starting the print", async () => {
      server.use(http.post(`${IDLE_BASE}/api/files/local/:path`, () => HttpResponse.error()))
      const released = await makeGateway().release(input(IDLE))
      expect(released.ok).toBe(false)
      if (!released.ok) expect(released.error.code).toBe("provider_error")
    })

    it("while reading progress", async () => {
      const { gateway } = await releaseAndThenBreak("/api/job", "get")
      const status = await gateway.printerStatus(IDLE)
      expect(status.ok).toBe(false)
      if (!status.ok) expect(status.error.message).toMatch(/request to \/api\/job failed/)
    })

    it("during the state check of a cancel", async () => {
      const { gateway, ref } = await releaseAndThenBreak("/api/printer", "get")
      const cancelled = await gateway.cancel(ref)
      expect(cancelled.ok).toBe(false)
      if (!cancelled.ok) expect(cancelled.error.code).toBe("provider_error")
    })

    it("while sending the cancel", async () => {
      const { gateway, ref } = await releaseAndThenBreak("/api/job", "post")
      const cancelled = await gateway.cancel(ref)
      expect(cancelled.ok).toBe(false)
      if (!cancelled.ok) expect(cancelled.error.code).toBe("provider_error")
    })

    it("and fails in a way that is not even an Error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue("the router ate it")
      const status = await makeGateway().printerStatus(IDLE)
      expect(status.ok).toBe(false)
      if (!status.ok) expect(status.error.message).toMatch(/failed: unreachable$/)
      vi.restoreAllMocks()
    })
  })
})
