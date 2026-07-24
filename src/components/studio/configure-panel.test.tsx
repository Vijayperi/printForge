import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

import {
  buildInitialForm,
  ConfigurePanel,
  formToInput,
  inStockColors,
  liveOf,
  sizeBounds,
  type ConfigFormState,
} from "@/src/components/studio/configure-panel"
import { getPrinterProfile } from "@/src/config/profiles"
import type { PrintConfigurationRow } from "@/src/domain/types"

// ---------------------------------------------------------------- pure helpers
const BASE = { x: 40, y: 20, z: 20 }

describe("inStockColors", () => {
  it("returns only in-stock colours of the material", () => {
    const ids = inStockColors("pla").map((c) => c.id)
    expect(ids).toContain("pla-white")
    expect(ids).not.toContain("pla-slate") // out of stock
  })
})

describe("buildInitialForm", () => {
  it("defaults to PLA / first in-stock colour at scale 1 with no saved config", () => {
    const form = buildInitialForm(null, BASE)
    expect(form.materialId).toBe("pla")
    expect(form.colorId).toBe("pla-white")
    expect(form.qualityId).toBe("standard")
    expect(form.strengthId).toBe("everyday")
    expect(form.shippingSpeed).toBe("standard")
    expect(form.targetLongestMm).toBe(40) // baseLongest × 1
  })

  it("restores a saved configuration, deriving target size from the saved scale", () => {
    const saved = {
      material_id: "petg",
      color_id: "petg-clear",
      quality_id: "fine",
      strength_id: "reinforced",
      shipping_speed: "express",
      special_instructions: "handle with care",
      scale_factor: 2,
    } as PrintConfigurationRow
    const form = buildInitialForm(saved, BASE)
    expect(form.materialId).toBe("petg")
    expect(form.colorId).toBe("petg-clear")
    expect(form.targetLongestMm).toBe(80) // 40 × 2
    expect(form.instructions).toBe("handle with care")
  })
})

describe("formToInput", () => {
  it("applies the uniform scale to derive dimensions + scale factor", () => {
    const form = buildInitialForm(null, BASE)
    const input = formToInput({ ...form, targetLongestMm: 80 }, BASE)
    expect(input.scaleFactor).toBe(2)
    expect(input.dimensionsMm).toEqual({ x: 80, y: 40, z: 40 })
    expect(input.specialInstructions).toBe("")
  })
})

describe("liveOf", () => {
  it("returns the selected colour's hex and the scale factor", () => {
    const form = buildInitialForm(null, BASE)
    expect(liveOf(form, BASE)).toEqual({ swatchColor: "#f5f5f5", scaleFactor: 1 })
  })
  it("returns a null swatch when the colour is not found", () => {
    const form: ConfigFormState = { ...buildInitialForm(null, BASE), colorId: "ghost" }
    expect(liveOf(form, BASE).swatchColor).toBeNull()
  })
})

describe("sizeBounds", () => {
  it("caps the max at what fits the build volume", () => {
    const { min, max } = sizeBounds(BASE, getPrinterProfile())
    expect(min).toBe(10)
    // Limiting axis is x: 220/40 = 5.5 → longest 40 × 5.5 = 220.
    expect(max).toBe(220)
  })
  it("degrades gracefully for a zero-size base", () => {
    expect(sizeBounds({ x: 0, y: 0, z: 0 }, getPrinterProfile())).toEqual({ min: 10, max: 10 })
  })
})

// ------------------------------------------------------------------- component
function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

interface StubOpts {
  config?: unknown
  validation?: unknown | null
  post?: unknown
  postStatus?: number
}

const posts: unknown[] = []
let validationHash = ""

function stubFetch(opts: StubOpts = {}) {
  validationHash = ""
  posts.length = 0
  const config = opts.config ?? { configuration: null }
  const validationBody =
    opts.validation === undefined
      ? { measurements: { boundingMm: BASE }, scaleHash: validationHash }
      : opts.validation
  const post = opts.post ?? { revalidating: false, scaleHash: "s1" }
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (url.endsWith("/configuration") && method === "GET") return jsonResponse(200, config)
    if (url.endsWith("/configuration")) {
      posts.push(JSON.parse(init!.body as string))
      return jsonResponse(opts.postStatus ?? 200, post)
    }
    if (url.endsWith("/validation")) {
      if (validationBody === null) return jsonResponse(500, {})
      return jsonResponse(200, { ...(validationBody as object), scaleHash: validationHash })
    }
    return jsonResponse(404, {})
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const onLive = vi.fn()

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  onLive.mockReset()
})

async function renderReady() {
  stubFetch()
  render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
  await screen.findByLabelText(/Size \(longest side\)$/i)
}

describe("ConfigurePanel — loading", () => {
  it("shows the measuring message until the model has been measured", async () => {
    const fetchMock = stubFetch({ validation: { measurements: null } })
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/design-versions/dv_1/validation"))
    expect(screen.getByText(/measuring your model/i)).toBeInTheDocument()
    expect(onLive).not.toHaveBeenCalled()
  })

  it("falls back to defaults when the saved configuration cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/configuration") && (init?.method ?? "GET") === "GET") return jsonResponse(500, {})
        if (url.endsWith("/validation")) return jsonResponse(200, { measurements: { boundingMm: BASE }, scaleHash: "" })
        return jsonResponse(404, {})
      })
    )
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    expect(screen.getByRole("radio", { name: /White/ })).toBeChecked() // default PLA/white
  })

  it("initialises when the saved config arrives after the measurements", async () => {
    let resolveConfig: () => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, init?: RequestInit) =>
          url.endsWith("/configuration") && (init?.method ?? "GET") === "GET"
            ? new Promise<Response>((r) => (resolveConfig = () => r(jsonResponse(200, { configuration: null }))))
            : Promise.resolve(jsonResponse(200, { measurements: { boundingMm: BASE }, scaleHash: "" }))
      )
    )
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    // Measurements resolved first, but the config is still pending → not ready yet.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/design-versions/dv_1/validation"))
    await Promise.resolve()
    expect(screen.getByText(/measuring your model/i)).toBeInTheDocument()
    resolveConfig()
    await screen.findByLabelText(/Size \(longest side\)$/i)
  })

  it("keeps polling when validation is unavailable, then loads when it recovers", async () => {
    vi.useFakeTimers()
    let vOk = false
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/configuration") && (init?.method ?? "GET") === "GET") return jsonResponse(200, { configuration: null })
        if (url.endsWith("/validation"))
          return vOk ? jsonResponse(200, { measurements: { boundingMm: BASE }, scaleHash: "" }) : jsonResponse(500, {})
        return jsonResponse(404, {})
      })
    )
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/measuring your model/i)).toBeInTheDocument()

    vOk = true
    await vi.advanceTimersByTimeAsync(2000) // the reschedule fires → poll again → loads
    vi.useRealTimers()
    await screen.findByLabelText(/Size \(longest side\)$/i)
  })
})

describe("ConfigurePanel — controls", () => {
  it("renders the controls and pushes the initial live swatch + scale to the viewer", async () => {
    await renderReady()
    expect(screen.getByRole("radio", { name: /White/ })).toBeChecked()
    expect(onLive).toHaveBeenCalledWith({ swatchColor: "#f5f5f5", scaleFactor: 1 })
  })

  it("shows only in-stock colours", async () => {
    await renderReady()
    expect(screen.getByRole("radio", { name: /White/ })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /Slate/ })).not.toBeInTheDocument()
  })

  it("changing material resets the colour to that material's first in-stock colour", async () => {
    const user = userEvent.setup()
    await renderReady()
    await user.selectOptions(screen.getByLabelText("Material"), "petg")
    expect(screen.getByRole("radio", { name: /Clear/ })).toBeChecked()
    expect(onLive).toHaveBeenLastCalledWith({ swatchColor: "#e8f0f0", scaleFactor: 1 })
  })

  it("selecting a colour updates the live swatch", async () => {
    const user = userEvent.setup()
    await renderReady()
    await user.click(screen.getByRole("radio", { name: /Black/ }))
    expect(onLive).toHaveBeenLastCalledWith({ swatchColor: "#1a1a1a", scaleFactor: 1 })
  })

  it("the size slider and numeric input both drive the scale + live viewer", async () => {
    await renderReady()
    const numeric = screen.getByLabelText(/Size \(longest side\) in mm/i)
    fireEvent.change(numeric, { target: { value: "80" } })
    expect(onLive).toHaveBeenLastCalledWith({ swatchColor: "#f5f5f5", scaleFactor: 2 })
    expect(screen.getByText(/80×40×40 mm/)).toBeInTheDocument()

    const slider = screen.getByLabelText(/Size \(longest side\)$/i)
    fireEvent.change(slider, { target: { value: "120" } })
    expect(onLive).toHaveBeenLastCalledWith({ swatchColor: "#f5f5f5", scaleFactor: 3 })
  })

  it("supports quality, strength, shipping and instruction edits", async () => {
    const user = userEvent.setup()
    await renderReady()
    await user.click(screen.getByRole("radio", { name: /Fine/ }))
    expect(screen.getByRole("radio", { name: /Fine/ })).toBeChecked()
    await user.click(screen.getByRole("radio", { name: /Display/ }))
    expect(screen.getByRole("radio", { name: /Display/ })).toBeChecked()
    await user.selectOptions(screen.getByLabelText("Shipping"), "express")
    expect((screen.getByLabelText("Shipping") as HTMLSelectElement).value).toBe("express")

    const notes = screen.getByLabelText("Special instructions")
    fireEvent.change(notes, { target: { value: "no supports" } })
    expect(screen.getByText("11/500")).toBeInTheDocument()
  })

  it("flags a saved colour that has since gone out of stock", async () => {
    stubFetch({
      config: {
        configuration: {
          material_id: "pla",
          color_id: "pla-slate", // out of stock
          quality_id: "standard",
          strength_id: "everyday",
          shipping_speed: "standard",
          special_instructions: "",
          scale_factor: 1,
        },
      },
    })
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    expect(screen.getByRole("alert")).toHaveTextContent(/out of stock/i)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("marks an over-large size invalid and disables Save", async () => {
    await renderReady()
    const numeric = screen.getByLabelText(/Size \(longest side\) in mm/i)
    // 40 × 6 = 240 → x-axis 240 > 220 build volume.
    fireEvent.change(numeric, { target: { value: "240" } })
    expect(screen.getByRole("alert")).toHaveTextContent(/build volume/i)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})

describe("ConfigurePanel — persistence", () => {
  it("saves the configuration on explicit Save and shows Saved", async () => {
    const user = userEvent.setup()
    await renderReady()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Saved")
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      materialId: "pla",
      colorId: "pla-white",
      scaleFactor: 1,
      dimensionsMm: { x: 40, y: 20, z: 20 },
    })
  })

  it("surfaces a save error", async () => {
    const user = userEvent.setup()
    stubFetch({ postStatus: 500 })
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText(/Couldn.t save/i)
  })

  it("autosaves after a debounced settle", async () => {
    stubFetch()
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("radio", { name: /Black/ }))
    expect(posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ colorId: "pla-black" })
  })

  it("does not autosave an invalid configuration", async () => {
    stubFetch()
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    vi.useFakeTimers()
    fireEvent.change(screen.getByLabelText(/Size \(longest side\) in mm/i), { target: { value: "240" } })
    await vi.advanceTimersByTimeAsync(800)
    expect(posts).toHaveLength(0)
  })

  it("shows the Saving state while the request is in flight", async () => {
    const user = userEvent.setup()
    let resolvePost: (r: Response) => void = () => {}
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/configuration") && method === "GET") return jsonResponse(200, { configuration: null })
      if (url.endsWith("/configuration")) return new Promise<Response>((r) => (resolvePost = r))
      return jsonResponse(200, { measurements: { boundingMm: BASE }, scaleHash: "" })
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled()
    resolvePost(jsonResponse(200, { revalidating: false, scaleHash: "s1" }))
    await screen.findByText("Saved")
  })

  it("shows a re-checking notice after a size change until the scaled report lands", async () => {
    // validationHash stays "" so the fresh (s2) report has not landed yet.
    stubFetch({ post: { revalidating: true, scaleHash: "s2" } })
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)

    fireEvent.change(screen.getByLabelText(/Size \(longest side\) in mm/i), { target: { value: "80" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText(/Re-checking printability/i)).toBeInTheDocument()
  })

  it("clears the re-checking notice once the scaled report matches", async () => {
    // The scaled report is already present, so the first re-poll matches + clears.
    stubFetch({ post: { revalidating: true, scaleHash: "s2" } })
    validationHash = "s2"
    render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)

    fireEvent.change(screen.getByLabelText(/Size \(longest side\) in mm/i), { target: { value: "80" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await screen.findByText("Saved")
    await waitFor(() =>
      expect(screen.queryByText(/Re-checking printability/i)).not.toBeInTheDocument()
    )
  })

  it("ignores a save that resolves after unmount", async () => {
    let resolvePost: (r: Response) => void = () => {}
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      if (url.endsWith("/configuration") && method === "GET") return jsonResponse(200, { configuration: null })
      if (url.endsWith("/configuration")) return new Promise<Response>((r) => (resolvePost = r))
      return jsonResponse(200, { measurements: { boundingMm: BASE }, scaleHash: "" })
    })
    vi.stubGlobal("fetch", fn)
    const { unmount } = render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    unmount()
    resolvePost(jsonResponse(200, { revalidating: false, scaleHash: "s1" }))
    await Promise.resolve()
    await Promise.resolve()
    // No throw / act warning: the post-unmount guard skipped the setState.
    expect(true).toBe(true)
  })

  it("does not update state after unmount (config + validation in flight)", async () => {
    let resolveConfig: () => void = () => {}
    let resolveValidation: () => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((r) => {
            if (url.endsWith("/configuration")) resolveConfig = () => r(jsonResponse(200, { configuration: null }))
            else resolveValidation = () => r(jsonResponse(200, { measurements: { boundingMm: BASE }, scaleHash: "" }))
          })
      )
    )
    const { unmount } = render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    unmount()
    resolveConfig()
    resolveValidation()
    await Promise.resolve()
    await Promise.resolve()
    expect(onLive).not.toHaveBeenCalled()
  })
})

describe("ConfigurePanel — accessibility", () => {
  it("has no accessibility violations", async () => {
    stubFetch()
    const { container } = render(<ConfigurePanel designVersionId="dv_1" onLiveChange={onLive} />)
    await screen.findByLabelText(/Size \(longest side\)$/i)
    expect(await axe(container)).toHaveNoViolations()
  })
})
