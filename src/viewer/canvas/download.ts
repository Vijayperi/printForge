/** Trigger a browser download of a data URL. Pure (document injected). */
export function triggerDownload(dataUrl: string, filename: string, doc: Document): void {
  const anchor = doc.createElement("a")
  anchor.href = dataUrl
  anchor.download = filename
  doc.body.appendChild(anchor)
  anchor.click()
  doc.body.removeChild(anchor)
}
