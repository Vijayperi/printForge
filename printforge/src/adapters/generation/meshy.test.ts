import { http, HttpResponse } from "msw"
import { beforeEach, describe, expect, it } from "vitest"

import { generationProviderContract } from "@/src/adapters/generation/contract.spec-factory"
import { MeshyProvider } from "@/src/adapters/generation/meshy"
import type { StructuredBrief } from "@/src/domain/types"
import { server } from "@/tests/msw/server"

import submitResponse from "@/tests/fixtures/meshy/submit-response.json"
import pollPending from "@/tests/fixtures/meshy/poll-pending.json"
import pollInProgress from "@/tests/fixtures/meshy/poll-in-progress.json"
import pollSucceeded from "@/tests/fixtures/meshy/poll-succeeded.json"
import pollSucceededGlbOnly from "@/tests/fixtures/meshy/poll-succeeded-glb-only.json"
import pollSucceededNoGlb from "@/tests/fixtures/meshy/poll-succeeded-no-glb.json"
import pollFailed from "@/tests/fixtures/meshy/poll-failed.json"
import pollCanceled from "@/tests/fixtures/meshy/poll-canceled.json"

const SUBMIT_URL = "https://api.meshy.ai/openapi/v2/text-to-3d"
const POLL_URL = "https://api.meshy.ai/openapi/v2/text-to-3d/:id"

const BRIEF: StructuredBrief = {
  intendedUse: "decor",
  approxSizeMm: 100,
  style: "geometric",
  durability: "display",
  rawPrompt: "a small cube",
}

function makeProvider(): MeshyProvider {
  return new MeshyProvider("test-key")
}

function submitOk() {
  return http.post(SUBMIT_URL, () => HttpResponse.json(submitResponse))
}
function pollReturns(body: unknown) {
  return http.get(POLL_URL, () =>
    HttpResponse.json(body as Parameters<typeof HttpResponse.json>[0])
  )
}

describe("MeshyProvider contract (MSW)", () => {
  beforeEach(() => {
    server.use(submitOk(), pollReturns(pollSucceeded))
  })
  generationProviderContract(makeProvider)
})

describe("MeshyProvider.submit", () => {
  it("sends the prompt with a bearer token and returns the result id", async () => {
    let seen: { auth: string | null; body: unknown } | null = null
    server.use(
      http.post(SUBMIT_URL, async ({ request }) => {
        seen = { auth: request.headers.get("Authorization"), body: await request.json() }
        return HttpResponse.json(submitResponse)
      })
    )
    const result = await makeProvider().submit(BRIEF)
    expect(result).toEqual({ ok: true, value: { providerTaskId: submitResponse.result } })
    expect(seen!.auth).toBe("Bearer test-key")
    expect(seen!.body).toEqual({ mode: "preview", prompt: "a small cube" })
  })

  it("maps a non-OK response to provider_error", async () => {
    server.use(http.post(SUBMIT_URL, () => new HttpResponse(null, { status: 401 })))
    const result = await makeProvider().submit(BRIEF)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("errors when the response has no result id", async () => {
    server.use(http.post(SUBMIT_URL, () => HttpResponse.json({})))
    const result = await makeProvider().submit(BRIEF)
    expect(!result.ok && result.error.code).toBe("provider_error")
  })
})

describe("MeshyProvider.poll", () => {
  it("maps a non-OK response to provider_error", async () => {
    server.use(http.get(POLL_URL, () => new HttpResponse(null, { status: 500 })))
    const result = await makeProvider().poll("t1")
    expect(!result.ok && result.error.code).toBe("provider_error")
  })

  it("normalizes PENDING to queued", async () => {
    server.use(pollReturns(pollPending))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value).toEqual({ state: "queued", progressPct: 0 })
  })

  it("normalizes IN_PROGRESS to creating", async () => {
    server.use(pollReturns(pollInProgress))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value).toEqual({ state: "creating", progressPct: 45 })
  })

  it("normalizes SUCCEEDED with glb + stl to ready", async () => {
    server.use(pollReturns(pollSucceeded))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value).toEqual({
      state: "ready",
      assets: {
        glbUrl: "https://assets.meshy.ai/018a210d/model.glb",
        stlUrl: "https://assets.meshy.ai/018a210d/model.stl",
      },
    })
  })

  it("normalizes SUCCEEDED with only a glb to ready without stl", async () => {
    server.use(pollReturns(pollSucceededGlbOnly))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value).toEqual({
      state: "ready",
      assets: { glbUrl: "https://assets.meshy.ai/018a210d/model.glb" },
    })
  })

  it("treats SUCCEEDED without a glb url as failed", async () => {
    server.use(pollReturns(pollSucceededNoGlb))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value.state).toBe("failed")
  })

  it("normalizes FAILED to failed with the task error message", async () => {
    server.use(pollReturns(pollFailed))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value).toEqual({
      state: "failed",
      reason: "generation failed: unsafe prompt",
    })
  })

  it("normalizes CANCELED (no task_error) to failed with a default reason", async () => {
    server.use(pollReturns(pollCanceled))
    const result = await makeProvider().poll("t1")
    expect(result.ok && result.value).toEqual({ state: "failed", reason: "meshy status CANCELED" })
  })
})
