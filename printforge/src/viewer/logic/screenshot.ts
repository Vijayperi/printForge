import type { Clock } from "@/src/lib/clock"

/** URL/file-safe slug of an arbitrary title. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? slug : "model"
}

/** Deterministic screenshot filename, e.g. printforge-desk-tidy-20260722T100000.png */
export function screenshotFileName(projectTitle: string, clock: Clock): string {
  const stamp = clock.now().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  return `printforge-${slugify(projectTitle)}-${stamp}.png`
}
