/**
 * Job-worker entrypoint. Bootstraps real dependencies and runs the processing
 * loop. Its logic lives in src/jobs/worker.ts (fully covered); this file is
 * just wiring (excluded from coverage per plan §5.1).
 *
 * Run locally with the worker deps loaded:
 *   node --env-file=.env.local --import tsx scripts/worker.ts
 */
import { getGenerationProvider } from "@/src/adapters/generation/factory"
import { getGlbConverter } from "@/src/adapters/conversion/factory"
import { getPrinterGateway } from "@/src/adapters/printerGateway/factory"
import { getSlicer } from "@/src/adapters/slicer/factory"
import { getAssetStorage } from "@/src/adapters/storage/factory"
import { getEnv } from "@/src/config/env"
import { getServiceDb } from "@/src/data/supabaseClients"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { runLoop, type WorkerDeps } from "@/src/jobs/worker"
import { SystemClock } from "@/src/lib/clock"
import { newId } from "@/src/lib/ids"
import { logger } from "@/src/lib/logger"

async function main(): Promise<void> {
  const clock = new SystemClock()
  const db = getServiceDb()
  const queue = new PostgresJobQueue(db, clock)
  const storage = getAssetStorage()
  const deps: WorkerDeps = {
    db,
    queue,
    provider: getGenerationProvider(),
    clock,
    workerId: newId("job"),
    storage,
    converter: getGlbConverter(),
    slicer: getSlicer(storage),
    gateway: getPrinterGateway(storage),
    appUrl: getEnv().APP_URL,
  }

  let running = true
  const stop = (): void => {
    running = false
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  logger.info("worker started", { workerId: deps.workerId })
  await runLoop(deps, {
    intervalMs: 2000,
    reapThresholdSeconds: 600,
    keepRunning: () => running,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  logger.info("worker stopped")
}

void main()
