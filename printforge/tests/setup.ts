import "@testing-library/jest-dom/vitest"

import { cleanup, configure } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, expect } from "vitest"
import * as axeMatchers from "vitest-axe/matchers"

import { server } from "./msw/server"

expect.extend(axeMatchers)

// Portal + transition driven components (Radix dialogs, useActionState/
// useTransition forms) resolve asynchronously; raise waitFor's default 1s
// timeout so these stay deterministic under heavy parallel/coverage load.
configure({ asyncUtilTimeout: 5000 })

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => server.close())
