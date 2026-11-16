import { z } from "zod"

/** Guided creation brief (plan §7.2) → StructuredBrief. */
export const generationRequestSchema = z.object({
  rawPrompt: z.string().trim().min(1, "describe what you want to create").max(2000),
  intendedUse: z.string().trim().min(1, "tell us the intended use").max(200),
  approxSizeMm: z.number().positive("size must be positive").max(1000),
  style: z.string().trim().min(1, "choose a style").max(200),
  durability: z.enum(["display", "everyday", "reinforced"]),
  materialPref: z.string().trim().max(100).optional(),
  colorPref: z.string().trim().max(100).optional(),
})

export type GenerationRequest = z.infer<typeof generationRequestSchema>
