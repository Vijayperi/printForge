import { afterEach, describe, expect, it, vi } from "vitest"

const getEnv = vi.fn()
vi.mock("@/src/config/env", () => ({ getEnv: () => getEnv() }))

import { getPrinterGateway } from "@/src/adapters/printerGateway/factory"
import { MockPrinterGateway } from "@/src/adapters/printerGateway/mock"
import { OctoPrintGateway } from "@/src/adapters/printerGateway/octoprint"
import { InMemoryStorage } from "@/src/adapters/storage/memory"

const storage = new InMemoryStorage()
const CONFIG = JSON.stringify({
  prn_1: { baseUrl: "http://octopi.local", apiKey: "octo-key" },
})

afterEach(() => vi.clearAllMocks())

describe("getPrinterGateway", () => {
  it("returns the mock fleet when PRINTER_GATEWAY is mock", () => {
    getEnv.mockReturnValue({ PRINTER_GATEWAY: "mock" })
    expect(getPrinterGateway(storage)).toBeInstanceOf(MockPrinterGateway)
  })

  it("returns the OctoPrint gateway when PRINTER_GATEWAY is octoprint", () => {
    getEnv.mockReturnValue({ PRINTER_GATEWAY: "octoprint", PRINTER_GATEWAY_CONFIG: CONFIG })
    expect(getPrinterGateway(storage)).toBeInstanceOf(OctoPrintGateway)
  })

  it("throws when the fleet config is unusable rather than releasing to nowhere", () => {
    getEnv.mockReturnValue({ PRINTER_GATEWAY: "octoprint", PRINTER_GATEWAY_CONFIG: "{oops" })
    expect(() => getPrinterGateway(storage)).toThrow(/not valid JSON/)
  })
})
