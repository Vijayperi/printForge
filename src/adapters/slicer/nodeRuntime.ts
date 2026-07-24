import "server-only"

import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PrusaRuntime } from "@/src/adapters/slicer/prusa"
import { appError } from "@/src/lib/errors"
import { err, ok } from "@/src/lib/result"

/**
 * Real child_process + filesystem implementation of `PrusaRuntime`. This is pure
 * I/O wiring — like `scripts/worker.ts` it is excluded from coverage (plan §5.1);
 * the `PrusaSlicerCli` logic that uses it is fully covered against a fake runtime.
 */
export const nodePrusaRuntime: PrusaRuntime = {
  async writeTempMesh(bytes) {
    const dir = await mkdtemp(join(tmpdir(), "printforge-slice-"))
    const inputPath = join(dir, "model.stl")
    await writeFile(inputPath, bytes)
    return { inputPath, outputPath: join(dir, "model.gcode") }
  },

  run(command, args) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: "ignore" })
      child.on("error", (e) => resolve(err(appError("provider_error", `slicer failed to start: ${e.message}`))))
      child.on("close", (code) =>
        resolve(code === 0 ? ok(undefined) : err(appError("provider_error", `slicer exited with code ${code}`)))
      )
    })
  },

  async readGcode(path) {
    try {
      return ok(await readFile(path, "utf8"))
    } catch (cause) {
      return err(appError("provider_error", `could not read slicer output: ${path}`, cause))
    }
  },

  async cleanup(paths) {
    await Promise.all(paths.map((p) => rm(p, { force: true }).catch(() => undefined)))
  },
}
