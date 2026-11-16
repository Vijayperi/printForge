import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

/** `glTF` little-endian, the first four bytes of every GLB. */
const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

export interface GlbOptimization {
  bytes: Uint8Array
  originalBytes: number
  optimizedBytes: number
}

interface Chunk {
  type: number
  data: Uint8Array
}

/** Chunks are 4-byte aligned; JSON pads with spaces and BIN with zeroes. */
function padTo4(length: number): number {
  return (4 - (length % 4)) % 4
}

/**
 * Split a GLB container into its chunks, rejecting anything that is not one.
 *
 * Deliberately strict: this runs on bytes a third-party generator produced, and
 * silently "optimizing" a file we cannot fully parse is how a viewer ends up
 * with a model that loads everywhere except production.
 */
export function readGlbChunks(glb: Uint8Array): Result<Chunk[]> {
  if (glb.byteLength < HEADER_BYTES) return err(appError("validation", "not a GLB: too short"))
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)

  if (view.getUint32(0, true) !== GLB_MAGIC) return err(appError("validation", "not a GLB: bad magic"))
  const version = view.getUint32(4, true)
  if (version !== 2) return err(appError("validation", `unsupported GLB version ${version}`))
  if (view.getUint32(8, true) !== glb.byteLength) {
    return err(appError("validation", "GLB length header disagrees with the file"))
  }

  const chunks: Chunk[] = []
  let offset = HEADER_BYTES
  while (offset + CHUNK_HEADER_BYTES <= glb.byteLength) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const start = offset + CHUNK_HEADER_BYTES
    if (start + length > glb.byteLength) {
      return err(appError("validation", "GLB chunk runs past the end of the file"))
    }
    chunks.push({ type, data: glb.subarray(start, start + length) })
    offset = start + length + padTo4(length)
  }
  if (chunks.length === 0) return err(appError("validation", "GLB has no chunks"))
  if (chunks[0]?.type !== CHUNK_JSON) return err(appError("validation", "GLB does not start with JSON"))
  return ok(chunks)
}

/** Re-assemble a GLB from its JSON and (optional) BIN chunk. */
export function writeGlb(json: Uint8Array, bin: Uint8Array | null): Uint8Array {
  const jsonPad = padTo4(json.byteLength)
  const binPad = bin === null ? 0 : padTo4(bin.byteLength)
  const total =
    HEADER_BYTES +
    CHUNK_HEADER_BYTES +
    json.byteLength +
    jsonPad +
    (bin === null ? 0 : CHUNK_HEADER_BYTES + bin.byteLength + binPad)

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)

  let offset = HEADER_BYTES
  view.setUint32(offset, json.byteLength + jsonPad, true)
  view.setUint32(offset + 4, CHUNK_JSON, true)
  out.set(json, offset + CHUNK_HEADER_BYTES)
  // JSON padding is spaces, so the chunk stays parseable as-is.
  out.fill(0x20, offset + CHUNK_HEADER_BYTES + json.byteLength, offset + CHUNK_HEADER_BYTES + json.byteLength + jsonPad)
  offset += CHUNK_HEADER_BYTES + json.byteLength + jsonPad

  if (bin !== null) {
    view.setUint32(offset, bin.byteLength + binPad, true)
    view.setUint32(offset + 4, CHUNK_BIN, true)
    out.set(bin, offset + CHUNK_HEADER_BYTES)
    // BIN padding is zeroes, which the spec requires.
  }
  return out
}

/** The JSON chunk's text, without the padding an exporter appended to it. */
export function decodeJsonChunk(data: Uint8Array): string {
  return new TextDecoder().decode(data).replace(/[\s\0]+$/, "")
}

/**
 * Shrink a viewer GLB without touching its geometry (plan §6-S16 step 3).
 *
 * Three lossless wins, all at the container level: the JSON chunk is re-emitted
 * with no insignificant whitespace, chunks the glTF spec tells clients to ignore
 * are dropped, and both chunks are re-padded to the spec minimum. Nothing that
 * changes what is rendered is touched.
 *
 * Geometry-level compression (meshopt/draco quantization) is deliberately *not*
 * here: it needs a mesh library and real provider output to tune against, so it
 * belongs to the owner era — this is the seam it will land in (DECISIONS.md).
 */
export function optimizeGlb(glb: Uint8Array): Result<GlbOptimization> {
  const chunks = readGlbChunks(glb)
  if (!chunks.ok) return chunks

  const jsonChunk = chunks.value[0] as Chunk
  let parsed: unknown
  try {
    // The spec pads the JSON chunk with spaces, but exporters in the wild pad
    // with NULs, which `JSON.parse` refuses. Trim both rather than reject a
    // model that every viewer opens happily.
    parsed = JSON.parse(decodeJsonChunk(jsonChunk.data)) as unknown
  } catch {
    return err(appError("validation", "GLB JSON chunk is not valid JSON"))
  }

  const json = new TextEncoder().encode(JSON.stringify(parsed))
  const binChunk = chunks.value.find((chunk) => chunk.type === CHUNK_BIN)
  const bin = binChunk === undefined ? null : binChunk.data

  const bytes = writeGlb(json, bin)
  // A GLB that is already minimal can come out a few bytes larger once re-padded;
  // keeping the original is both smaller and one less transformation to trust.
  if (bytes.byteLength >= glb.byteLength) {
    return ok({ bytes: glb, originalBytes: glb.byteLength, optimizedBytes: glb.byteLength })
  }
  return ok({ bytes, originalBytes: glb.byteLength, optimizedBytes: bytes.byteLength })
}
