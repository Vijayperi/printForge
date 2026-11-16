import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Scene } from "three"
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js"

import { parseStl } from "@/src/domain/geometry/stlParse"
import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

interface FileReaderHost {
  FileReader?: unknown
}

/**
 * GLTFExporter reads its binary output through a FileReader, which exists in the
 * browser and jsdom but not in a plain Node server runtime. Inject a minimal
 * polyfill when absent.
 */
export function ensureFileReader(host: FileReaderHost): void {
  if (host.FileReader !== undefined) return
  host.FileReader = class {
    onloadend: (() => void) | null = null
    result: ArrayBuffer | null = null
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
  }
}

/** Build a single-mesh scene from raw STL bytes. */
export function buildSceneFromStl(bytes: Uint8Array): Result<Scene> {
  const parsed = parseStl(bytes)
  if (!parsed.ok) return err(appError("validation", `invalid STL: ${parsed.error.kind}`))
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(parsed.value.positions, 3))
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: "#c0c4cc", metalness: 0.1, roughness: 0.7 }))
  const scene = new Scene()
  scene.add(mesh)
  return ok(scene)
}

/** Export a scene to binary GLB bytes. */
export function exportGlb(scene: Scene): Promise<Result<Uint8Array>> {
  ensureFileReader(globalThis as FileReaderHost)
  return new Promise((resolve) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(ok(new Uint8Array(result as ArrayBuffer))),
      (error) => resolve(err(appError("internal", `GLB export failed: ${String(error)}`))),
      { binary: true }
    )
  })
}

/** Convert an uploaded STL into a viewer-ready GLB. */
export async function convertStlToGlb(bytes: Uint8Array): Promise<Result<Uint8Array>> {
  const scene = buildSceneFromStl(bytes)
  if (!scene.ok) return scene
  return exportGlb(scene.value)
}
