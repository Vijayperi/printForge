import { describe, expect, it } from "vitest"

import type { GenerationProvider } from "@/src/adapters/generation"
import type { StructuredBrief } from "@/src/domain/types"

const BRIEF: StructuredBrief = {
  intendedUse: "desk decoration",
  approxSizeMm: 100,
  style: "geometric",
  durability: "display",
  rawPrompt: "a small geometric cube",
}

/**
 * Shared contract every GenerationProvider must satisfy (plan §4.4), so the mock
 * and the real Meshy provider can never drift. The failed-status path is forced
 * differently per provider, so it is asserted in each provider's own test.
 */
export function generationProviderContract(
  makeProvider: () => GenerationProvider | Promise<GenerationProvider>,
  opts: { maxPolls?: number } = {}
): void {
  describe("GenerationProvider contract", () => {
    it("submit returns a non-empty provider task id", async () => {
      const provider = await makeProvider()
      const result = await provider.submit(BRIEF)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.providerTaskId.length).toBeGreaterThan(0)
    })

    it("polling eventually reaches ready with a glb url", async () => {
      const provider = await makeProvider()
      const submitted = await provider.submit(BRIEF)
      expect(submitted.ok).toBe(true)
      if (!submitted.ok) return

      const maxPolls = opts.maxPolls ?? 10
      let reachedReady = false
      for (let i = 0; i < maxPolls; i += 1) {
        const status = await provider.poll(submitted.value.providerTaskId)
        expect(status.ok).toBe(true)
        if (status.ok && status.value.state === "ready") {
          expect(status.value.assets.glbUrl.length).toBeGreaterThan(0)
          reachedReady = true
          break
        }
      }
      expect(reachedReady).toBe(true)
    })
  })
}
