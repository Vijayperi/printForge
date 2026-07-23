import { describe, expect, it } from "vitest"

import type { UploadScanner } from "@/src/adapters/scanner"
import { EICAR_SIGNATURE } from "@/src/adapters/scanner/mock"

/** Shared contract every UploadScanner implementation must satisfy. */
export function uploadScannerContract(makeScanner: () => UploadScanner): void {
  describe("UploadScanner contract", () => {
    it("passes clean bytes", async () => {
      const result = await makeScanner().scan(new Uint8Array([1, 2, 3, 4]))
      expect(result.ok && result.value.clean).toBe(true)
    })

    it("flags a known threat signature", async () => {
      const bytes = new TextEncoder().encode(`prefix ${EICAR_SIGNATURE} suffix`)
      const result = await makeScanner().scan(bytes)
      expect(result.ok && result.value.clean).toBe(false)
      expect(result.ok && result.value.threat).toBeTruthy()
    })
  })
}
