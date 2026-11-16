import "server-only"

import type { GenerationProvider } from "@/src/adapters/generation"
import { MeshyProvider } from "@/src/adapters/generation/meshy"
import { MockGenerationProvider } from "@/src/adapters/generation/mock"
import { getEnv } from "@/src/config/env"

/** Resolve the generation provider from env (plan §4.4). */
export function getGenerationProvider(): GenerationProvider {
  const env = getEnv()
  if (env.GENERATION_PROVIDER === "meshy") {
    return new MeshyProvider(env.MESHY_API_KEY as string)
  }
  return new MockGenerationProvider()
}
