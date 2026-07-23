import "server-only"

import type { UploadScanner } from "@/src/adapters/scanner"
import { MockScanner } from "@/src/adapters/scanner/mock"

/** Resolve the upload scanner. Only the mock exists until a real one is wired. */
export function getUploadScanner(): UploadScanner {
  return new MockScanner()
}
