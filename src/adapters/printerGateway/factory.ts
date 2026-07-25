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
  return new MockPrinterGateway()
}
