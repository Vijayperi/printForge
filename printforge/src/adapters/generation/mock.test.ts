import { describe, expect, it } from "vitest"

import { generationProviderContract } from "@/src/adapters/generation/contract.spec-factory"
import { MockGenerationProvider } from "@/src/adapters/generation/mock"
import type { StructuredBrief } from "@/src/domain/types"

const BRIEF: StructuredBrief = {
  intendedUse: "gift",
  approxSizeMm: 80,
  style: "cute",
  durability: "display",
  rawPrompt: "a tiny elephant",
}

generationProviderContract(() => new MockGenerationProvider())

describe("MockGenerationProvider", () => {
  it("advances creating → ready over the default two polls", async () => {
    const provider = new MockGenerationProvider()
    const submitted = await provider.submit(BRIEF)
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    const id = submitted.value.providerTaskId
    expect(id).toBe("mock-task-1")

    const first = await provider.poll(id)
    expect(first.ok && first.value).toEqual({ state: "creating", progressPct: 50 })

    const second = await provider.poll(id)
    expect(second.ok && second.value).toEqual({
      state: "ready",
      assets: { glbUrl: "/samples/cube.glb", stlUrl: "/samples/cube.stl" },
    })
  })

  it("issues distinct task ids per submit", async () => {
    const provider = new MockGenerationProvider()
    const a = await provider.submit(BRIEF)
    const b = await provider.submit(BRIEF)
    expect(a.ok && b.ok && a.value.providerTaskId !== b.value.providerTaskId).toBe(true)
  })

  it("honors a custom pollsUntilReady", async () => {
    const provider = new MockGenerationProvider({ pollsUntilReady: 3 })
    const submitted = await provider.submit(BRIEF)
    if (!submitted.ok) throw new Error("submit failed")
    const id = submitted.value.providerTaskId
    expect((await provider.poll(id)).ok && (await provider.poll(id)).ok).toBe(true)
    // third poll → ready
    await provider.poll(id)
    const final = await provider.poll(id)
    expect(final.ok && final.value.state).toBe("ready")
  })

  it("reports failed for a specific failing task id", async () => {
    const provider = new MockGenerationProvider({ failTaskIds: ["mock-task-1"] })
    const submitted = await provider.submit(BRIEF)
    if (!submitted.ok) throw new Error("submit failed")
    const status = await provider.poll(submitted.value.providerTaskId)
    expect(status.ok && status.value).toEqual({ state: "failed", reason: "mock forced failure" })
  })

  it("reports failed for every task when failTaskIds is 'all'", async () => {
    const provider = new MockGenerationProvider({ failTaskIds: "all" })
    const submitted = await provider.submit(BRIEF)
    if (!submitted.ok) throw new Error("submit failed")
    const status = await provider.poll(submitted.value.providerTaskId)
    expect(status.ok && status.value.state).toBe("failed")
  })

  it("reports failed when polling an unknown task id", async () => {
    const provider = new MockGenerationProvider()
    const status = await provider.poll("never-submitted")
    expect(status.ok && status.value).toEqual({
      state: "failed",
      reason: "unknown task never-submitted",
    })
  })
})
