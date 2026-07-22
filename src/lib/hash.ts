/** Hex SHA-256 of a byte buffer via Web Crypto (available in Node 20+ and browsers). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
