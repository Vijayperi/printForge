import type { ScanOutcome, UploadScanner } from "@/src/adapters/scanner"
import { ok, type Result } from "@/src/lib/result"

// The standard EICAR antivirus test signature. Any upload containing it is
// flagged as a threat, so the scan gate is exercisable end-to-end without real
// malware. A real scanner (e.g. a ClamAV endpoint) is an owner-era task (§8).
export const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

export class MockScanner implements UploadScanner {
  async scan(bytes: Uint8Array): Promise<Result<ScanOutcome>> {
    const text = new TextDecoder().decode(bytes)
    if (text.includes(EICAR_SIGNATURE)) {
      return ok({ clean: false, threat: "eicar-test-signature" })
    }
    return ok({ clean: true })
  }
}
