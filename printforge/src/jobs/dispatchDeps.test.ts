import { afterEach, describe, expect, it, vi } from "vitest"

const getEnv = vi.fn(() => ({ PRINTER_GATEWAY: "mock", STORAGE: "memory" }))
vi.mock("@/src/config/env", () => ({ getEnv: () => getEnv() }))

const db = { from: vi.fn(), rpc: vi.fn() }
vi.mock("@/src/data/supabaseClients", () => ({ getServiceDb: () => db }))

import { MockPrinterGateway } from "@/src/adapters/printerGateway/mock"
import { getDispatchDeps } from "@/src/jobs/dispatchDeps"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"

afterEach(() => vi.clearAllMocks())

describe("getDispatchDeps", () => {
  it("wires the service database, the env-selected gateway, a queue and a clock", () => {
    const deps = getDispatchDeps()
    expect(deps.db).toBe(db)
    expect(deps.gateway).toBeInstanceOf(MockPrinterGateway)
    expect(deps.queue).toBeInstanceOf(PostgresJobQueue)
    expect(deps.clock).toBeInstanceOf(SystemClock)
  })
})
