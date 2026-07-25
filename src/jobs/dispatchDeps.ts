import "server-only"

import { getPrinterGateway } from "@/src/adapters/printerGateway/factory"
import { getAssetStorage } from "@/src/adapters/storage/factory"
import { getServiceDb } from "@/src/data/supabaseClients"
import type { PrintDispatchDeps } from "@/src/jobs/handlers/printDispatch"
import { PostgresJobQueue } from "@/src/jobs/queue"
import { SystemClock } from "@/src/lib/clock"

/**
 * Build the dependencies a print dispatch needs, for callers outside the worker
 * — namely the ops release and cancel routes, which talk to a machine while the
 * operator waits so a refusal ("that printer is busy") reaches them directly
 * rather than being buried in a job that failed silently.
 *
 * It lives in `src/jobs/` because that is one of the two places allowed to name
 * the printer gateway at all (plan §6-S15 step 5, enforced by ESLint): routes
 * ask for the dependencies, and never for the gateway itself.
 */
export function getDispatchDeps(): PrintDispatchDeps {
  const db = getServiceDb()
  return {
    db,
    gateway: getPrinterGateway(getAssetStorage()),
    queue: new PostgresJobQueue(db, new SystemClock()),
    clock: new SystemClock(),
  }
}
