import { describe, expect, it, vi } from "vitest"

import { triggerDownload } from "@/src/viewer/canvas/download"

describe("triggerDownload", () => {
  it("creates a temporary anchor, clicks it, and cleans up", () => {
    const click = vi.fn()
    const anchor = { href: "", download: "", click } as unknown as HTMLAnchorElement
    const doc = {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    } as unknown as Document

    triggerDownload("data:image/png;base64,AAAA", "shot.png", doc)

    expect(anchor.href).toBe("data:image/png;base64,AAAA")
    expect(anchor.download).toBe("shot.png")
    expect(doc.body.appendChild).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(doc.body.removeChild).toHaveBeenCalledWith(anchor)
  })
})
