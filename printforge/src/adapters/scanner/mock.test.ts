import { describe, expect, it } from "vitest"

import { getUploadScanner } from "@/src/adapters/scanner/factory"
import { MockScanner } from "@/src/adapters/scanner/mock"
import { uploadScannerContract } from "@/src/adapters/scanner/contract.spec-factory"

uploadScannerContract(() => new MockScanner())

describe("getUploadScanner", () => {
  it("returns the mock scanner", () => {
    expect(getUploadScanner()).toBeInstanceOf(MockScanner)
  })
})
