import { z } from "zod"

const title = z
  .string()
  .trim()
  .min(1, "enter a project name")
  .max(120, "project name is too long")

export const createProjectSchema = z.object({ title })
export const renameProjectSchema = z.object({ id: z.string().min(1), title })
export const archiveProjectSchema = z.object({ id: z.string().min(1) })
