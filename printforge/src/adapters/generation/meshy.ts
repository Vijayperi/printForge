import "server-only"

import type { GenerationProvider, GenerationStatus } from "@/src/adapters/generation"
import type { StructuredBrief } from "@/src/domain/types"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

const BASE_URL = "https://api.meshy.ai/openapi/v2/text-to-3d"

type MeshyStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED"

interface MeshyTask {
  id: string
  status: MeshyStatus
  progress: number
  model_urls?: { glb?: string; stl?: string }
  task_error?: { message?: string }
}

/** Meshy Text-to-3D provider (docs.meshy.ai/en/api/text-to-3d). */
export class MeshyProvider implements GenerationProvider {
  constructor(private readonly apiKey: string) {}

  async submit(brief: StructuredBrief): Promise<Result<{ providerTaskId: string }>> {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "preview", prompt: brief.rawPrompt }),
    })
    if (!res.ok) {
      return err(appError("provider_error", `meshy submit failed with status ${res.status}`))
    }
    const body = (await res.json()) as { result?: string }
    if (body.result === undefined) {
      return err(appError("provider_error", "meshy submit returned no result id"))
    }
    return ok({ providerTaskId: body.result })
  }

  async poll(providerTaskId: string): Promise<Result<GenerationStatus>> {
    const res = await fetch(`${BASE_URL}/${providerTaskId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!res.ok) {
      return err(appError("provider_error", `meshy poll failed with status ${res.status}`))
    }
    const task = (await res.json()) as MeshyTask
    return ok(normalize(task))
  }
}

function normalize(task: MeshyTask): GenerationStatus {
  switch (task.status) {
    case "PENDING":
      return { state: "queued", progressPct: task.progress }
    case "IN_PROGRESS":
      return { state: "creating", progressPct: task.progress }
    case "SUCCEEDED": {
      const glbUrl = task.model_urls?.glb
      if (glbUrl === undefined) {
        return { state: "failed", reason: "meshy reported success without a glb url" }
      }
      const stlUrl = task.model_urls?.stl
      return stlUrl === undefined
        ? { state: "ready", assets: { glbUrl } }
        : { state: "ready", assets: { glbUrl, stlUrl } }
    }
    case "FAILED":
    case "CANCELED":
      return { state: "failed", reason: task.task_error?.message ?? `meshy status ${task.status}` }
  }
}
