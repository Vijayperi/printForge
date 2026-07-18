import { ulid } from "ulid"

export const ID_PREFIXES = [
  "proj",
  "dv",
  "ast",
  "vr",
  "cfg",
  "qt",
  "ord",
  "pj",
  "shp",
  "job",
  "ntf",
] as const

export type IdPrefix = (typeof ID_PREFIXES)[number]

const ULID_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}"

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`
}

export function isId(prefix: IdPrefix, value: string): boolean {
  return new RegExp(`^${prefix}_${ULID_PATTERN}$`).test(value)
}
