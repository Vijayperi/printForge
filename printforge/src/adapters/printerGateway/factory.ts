import "server-only"

import type { PrinterGateway } from "@/src/adapters/printerGateway"
import { MockPrinterGateway } from "@/src/adapters/printerGateway/mock"
import {
  OctoPrintGateway,
  parsePrinterGatewayConfig,
} from "@/src/adapters/printerGateway/octoprint"
import type { AssetStorage } from "@/src/adapters/storage"
import { getEnv } from "@/src/config/env"

/**
 * The mock fleet is memoized per process, because it *is* the state of the
 * machines: a fresh instance per request would forget the print it started a
 * moment ago, so releasing and then cancelling a job would fail in development.
 * The real gateway keeps no state of its own — the printers do — so it is built
 * per call.
 */
let mockFleet: MockPrinterGateway | null = null

/**
 * Resolve the printer gateway from env (plan §4.4). `PRINTER_GATEWAY_CONFIG` is
 * already required and JSON-checked by `src/config/env.ts` when the gateway is
 * `octoprint`, so a malformed fleet config fails at boot rather than at the
 * moment an operator presses release.
 */
export function getPrinterGateway(storage: AssetStorage): PrinterGateway {
  const env = getEnv()
  if (env.PRINTER_GATEWAY === "octoprint") {
    const config = parsePrinterGatewayConfig(env.PRINTER_GATEWAY_CONFIG as string)
    if (!config.ok) throw config.error
    return new OctoPrintGateway({ storage, config: config.value })
  }
  if (mockFleet === null) mockFleet = new MockPrinterGateway()
  return mockFleet
}

/** Test-only: forget the simulated fleet's state. */
export function resetMockFleet(): void {
  mockFleet = null
}
