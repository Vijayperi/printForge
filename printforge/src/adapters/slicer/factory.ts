import "server-only"

import type { Slicer } from "@/src/adapters/slicer"
import { MockSlicer } from "@/src/adapters/slicer/mock"
import { nodePrusaRuntime } from "@/src/adapters/slicer/nodeRuntime"
import { PrusaSlicerCli } from "@/src/adapters/slicer/prusa"
import type { AssetStorage } from "@/src/adapters/storage"
import { getEnv } from "@/src/config/env"

/** Directory of PrusaSlicer profile `.ini`s, resolved from the project root. */
export const PRUSA_PROFILE_DIR = "src/config/slicerProfiles"

/** Resolve the slicer from env (plan §4.4). Both impls read the mesh from storage. */
export function getSlicer(storage: AssetStorage): Slicer {
  const env = getEnv()
  if (env.SLICER === "prusa") {
    return new PrusaSlicerCli({
      storage,
      runtime: nodePrusaRuntime,
      slicerPath: env.PRUSA_SLICER_PATH as string,
      profileDir: PRUSA_PROFILE_DIR,
    })
  }
  return new MockSlicer(storage)
}
