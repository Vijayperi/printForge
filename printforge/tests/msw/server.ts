import { setupServer } from "msw/node"

// Handlers are registered per-suite via server.use(...). Starts empty.
export const server = setupServer()
