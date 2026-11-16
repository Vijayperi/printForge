import type { GenerationProvider, GenerationStatus } from "@/src/adapters/generation"
import type { StructuredBrief } from "@/src/domain/types"
import { ok, type Result } from "@/src/lib/result"

export interface MockGenerationOptions {
  /** How many polls before a task reports `ready` (default 2). */
  pollsUntilReady?: number
  /** Task ids whose polls always report `failed` ("all" fails every task). */
  failTaskIds?: string[] | "all"
}

const SAMPLE_ASSETS = { glbUrl: "/samples/cube.glb", stlUrl: "/samples/cube.stl" } as const

/**
 * Deterministic in-memory generation provider for development and tests.
 * Returns stable placeholder sample-asset URLs on `ready`.
 */
export class MockGenerationProvider implements GenerationProvider {
  private counter = 0
  private pollCounts = new Map<string, number>()
  private readonly pollsUntilReady: number
  private readonly failTaskIds: string[] | "all"

  constructor(opts: MockGenerationOptions = {}) {
    this.pollsUntilReady = opts.pollsUntilReady ?? 2
    this.failTaskIds = opts.failTaskIds ?? []
  }

  async submit(_brief: StructuredBrief): Promise<Result<{ providerTaskId: string }>> {
    this.counter += 1
    const providerTaskId = `mock-task-${this.counter}`
    this.pollCounts.set(providerTaskId, 0)
    return ok({ providerTaskId })
  }

  async poll(providerTaskId: string): Promise<Result<GenerationStatus>> {
    if (this.isFailing(providerTaskId)) {
      return ok({ state: "failed", reason: "mock forced failure" })
    }
    const prior = this.pollCounts.get(providerTaskId)
    if (prior === undefined) {
      return ok({ state: "failed", reason: `unknown task ${providerTaskId}` })
    }
    const count = prior + 1
    this.pollCounts.set(providerTaskId, count)
    if (count >= this.pollsUntilReady) {
      return ok({ state: "ready", assets: { ...SAMPLE_ASSETS } })
    }
    return ok({ state: "creating", progressPct: Math.round((count / this.pollsUntilReady) * 100) })
  }

  private isFailing(taskId: string): boolean {
    return this.failTaskIds === "all" || this.failTaskIds.includes(taskId)
  }
}
