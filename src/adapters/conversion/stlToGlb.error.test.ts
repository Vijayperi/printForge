import { Scene } from "three"
import { describe, expect, it, vi } from "vitest"

vi.mock("three/addons/exporters/GLTFExporter.js", () => ({
  GLTFExporter: class {
    parse(_scene: unknown, _onDone: unknown, onError: (e: unknown) => void): void {
      onError(new Error("exporter blew up"))
    }
  },
}))

import { exportGlb } from "@/src/adapters/conversion/stlToGlb"

describe("exportGlb error path", () => {
  it("maps a GLTFExporter failure to an internal error", async () => {
    const result = await exportGlb(new Scene())
    expect(!result.ok && result.error.code).toBe("internal")
  })
})
