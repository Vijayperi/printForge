import "server-only"

import type { AuthGateway } from "@/src/adapters/auth"
import { MockAuthGateway } from "@/src/adapters/auth/mock"
import { SupabaseAuthGateway, type MinimalSupabase } from "@/src/adapters/auth/supabase"
import { getEnv } from "@/src/config/env"
import { createServerSupabase, supabaseConfigured } from "@/src/data/supabaseClients"

let mockSingleton: MockAuthGateway | null = null

/**
 * Resolve the auth gateway for this request. With Supabase env configured the
 * real cookie-bound gateway is used; otherwise a process-wide mock (demo mode).
 */
export async function getAuthGateway(): Promise<AuthGateway> {
  if (supabaseConfigured()) {
    // The SSR client is a superset of the narrow slice this gateway uses;
    // the adapter boundary intentionally depends only on MinimalSupabase.
    const client = (await createServerSupabase()) as unknown as MinimalSupabase
    return new SupabaseAuthGateway(client, getEnv().APP_URL)
  }
  if (mockSingleton === null) {
    mockSingleton = new MockAuthGateway()
  }
  return mockSingleton
}

/** Test-only: drops the mock singleton so suites start clean. */
export function resetAuthGatewayForTests(): void {
  mockSingleton = null
}
