import "vitest"

import type { AxeMatchers } from "vitest-axe/matchers"

declare module "vitest" {
  // Module augmentation requires the empty-extends pattern.
  /* eslint-disable @typescript-eslint/no-empty-object-type */
  interface Assertion extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}
