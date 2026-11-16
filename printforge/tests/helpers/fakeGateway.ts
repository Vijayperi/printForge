import type { MockPrinterScript } from "@/src/adapters/printerGateway/mock"
import { MockPrinterGateway } from "@/src/adapters/printerGateway/mock"

/**
 * The mock fleet, for tests of code that may not import a printer gateway itself
 * (plan §6-S15 step 5 confines it to `src/jobs/**` and the ops release route —
 * ESLint enforces it, and route tests are inside `app/**`).
 *
 * Test files are never bundled for a browser, so borrowing the mock here does
 * not weaken the isolation the rule exists to protect.
 */
export function fakeGateway(scripts: Record<string, MockPrinterScript> = {}): MockPrinterGateway {
  return new MockPrinterGateway(scripts)
}

export { MOCK_SCRIPT_HAPPY, MOCK_SCRIPT_OFFLINE, mockScriptFailsAt } from "@/src/adapters/printerGateway/mock"
export type { MockPrinterGateway, MockPrinterScript }
