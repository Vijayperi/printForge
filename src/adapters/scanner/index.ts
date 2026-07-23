import type { Result } from "@/src/lib/result"

export interface ScanOutcome {
  clean: boolean
  threat?: string
}

/** Malware scan of an uploaded file's bytes (plan §4.4 / §10 security). */
export interface UploadScanner {
  scan(bytes: Uint8Array): Promise<Result<ScanOutcome>>
}
