import { describe, expect, it } from "vitest"

import {
  getConfiguration,
  getConfigurationById,
  upsertConfiguration,
  type ConfigurationValues,
} from "@/src/data/printConfigurations"
import { isId } from "@/src/lib/ids"
import { createFakeDb } from "@/tests/helpers/fakeDb"

function db(rows: Record<string, unknown>[] = []) {
  return createFakeDb({ print_configurations: { rows, unique: ["id"] } })
}

const values: ConfigurationValues = {
  materialId: "pla",
  colorId: "pla-white",
  dimensionsMm: { x: 50, y: 50, z: 50 },
  scaleFactor: 1,
  qualityId: "standard",
  strengthId: "everyday",
  shippingSpeed: "standard",
  specialInstructions: "leave the base unpainted",
}

describe("getConfiguration", () => {
  it("returns the newest configuration for a design version", async () => {
    const fake = db([
      { id: "cfg_1", design_version_id: "dv_1", created_at: "2026-01-01" },
      { id: "cfg_2", design_version_id: "dv_1", created_at: "2026-01-05" },
      { id: "cfg_3", design_version_id: "dv_2", created_at: "2026-01-09" },
    ])
    const result = await getConfiguration(fake, "dv_1")
    expect(result.ok && result.value?.id).toBe("cfg_2")
  })

  it("returns null when a design version has no configuration", async () => {
    const result = await getConfiguration(db(), "dv_none")
    expect(result.ok && result.value).toBeNull()
  })

  it("propagates a read error", async () => {
    const fake = db()
    fake.failNext({ message: "read boom" })
    const result = await getConfiguration(fake, "dv_1")
    expect(result.ok).toBe(false)
  })
})

describe("getConfigurationById", () => {
  it("returns the configuration a quote points at", async () => {
    const fake = db([
      { id: "cfg_1", design_version_id: "dv_1", created_at: "2026-01-01" },
      { id: "cfg_2", design_version_id: "dv_1", created_at: "2026-01-05" },
    ])
    const result = await getConfigurationById(fake, "cfg_1")
    expect(result.ok && result.value?.id).toBe("cfg_1")
  })

  it("returns null when the id is unknown", async () => {
    const result = await getConfigurationById(db(), "cfg_none")
    expect(result.ok && result.value).toBeNull()
  })

  it("propagates a read error", async () => {
    const fake = db()
    fake.failNext({ message: "read boom" })
    expect((await getConfigurationById(fake, "cfg_1")).ok).toBe(false)
  })
})

describe("upsertConfiguration", () => {
  it("inserts a new cfg_ row when none exists", async () => {
    const fake = db()
    const result = await upsertConfiguration(fake, "dv_1", values)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isId("cfg", result.value.id)).toBe(true)
    expect(result.value.design_version_id).toBe("dv_1")
    expect(result.value.material_id).toBe("pla")
    expect(result.value.dimensions_mm).toEqual({ x: 50, y: 50, z: 50 })
    expect(result.value.special_instructions).toBe("leave the base unpainted")
    expect(fake.rows("print_configurations")).toHaveLength(1)
  })

  it("updates in place when a configuration already exists (no duplicate row)", async () => {
    const fake = db([
      {
        id: "cfg_1",
        design_version_id: "dv_1",
        material_id: "pla",
        color_id: "pla-white",
        scale_factor: 1,
        created_at: "2026-01-01",
      },
    ])
    const result = await upsertConfiguration(fake, "dv_1", {
      ...values,
      materialId: "petg",
      colorId: "petg-clear",
      scaleFactor: 2,
    })
    expect(result.ok && result.value.id).toBe("cfg_1")
    expect(result.ok && result.value.material_id).toBe("petg")
    expect(result.ok && result.value.scale_factor).toBe(2)
    expect(fake.rows("print_configurations")).toHaveLength(1)
  })

  it("propagates a lookup error before writing", async () => {
    const fake = db()
    fake.failNext({ message: "lookup boom" })
    const result = await upsertConfiguration(fake, "dv_1", values)
    expect(result.ok).toBe(false)
  })
})
