// Legacy .doc -> .docx, via LibreOffice running headless on the server.
//
// Why this exists: 163 of the clinic's 169 template files are binary Word
// 97-2003 .doc, not .docx. The only reader available for that format here is
// `word-extractor`, whose getBody() returns a PLAIN STRING — not degraded
// formatting, none at all. No fonts, tables, images, borders or spacing ever
// reach the app, and doc-import.ts then reconstructs a plausible-looking report
// from the bare text with regexes. No editor or renderer can recover what was
// discarded at that step.
//
// LibreOffice reads the binary format properly, so converting to .docx first
// puts those files onto the same high-fidelity path as real .docx (see
// docx-render.ts) instead of the text-only one.
//
// It runs on the SERVER, not on anyone's machine: a Windows user uploading a
// .doc through the browser never touches LibreOffice. The only requirement is
// that the host allows the binary to be installed — fine on a VPS, Docker,
// Railway, Render or Fly; not possible on plain Vercel serverless, which is why
// this degrades instead of throwing when it isn't found.

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const CONVERT_TIMEOUT_MS = 60_000

/** Candidate binary names, in the order they're worth trying. */
const SOFFICE_BINARIES = ["soffice", "libreoffice"]

let cachedBinary: string | null | undefined

/**
 * The LibreOffice binary, or null when it isn't installed.
 *
 * Cached after the first probe: this runs per upload, and spawning a process
 * only to discover the same answer would add a second or more to every import.
 */
export async function findSoffice(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary
  for (const bin of SOFFICE_BINARIES) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(bin, ["--version"], { stdio: "ignore" })
      p.on("error", () => resolve(false))
      p.on("close", (code) => resolve(code === 0))
    })
    if (ok) return (cachedBinary = bin)
  }
  return (cachedBinary = null)
}

/**
 * Converts a legacy .doc buffer to .docx. Returns null when LibreOffice is
 * unavailable or the conversion fails, so the caller can fall back to the
 * text-only path rather than rejecting the upload outright — a degraded import
 * is a better outcome for the clinic than no import.
 */
export async function convertDocToDocx(buffer: Buffer): Promise<Buffer | null> {
  const soffice = await findSoffice()
  if (!soffice) return null

  const dir = await mkdtemp(path.join(tmpdir(), "aarya-doc-"))
  try {
    const input = path.join(dir, `${randomUUID()}.doc`)
    await writeFile(input, buffer)

    const ok = await new Promise<boolean>((resolve) => {
      const proc = spawn(soffice, [
        "--headless",
        "--norestore",
        // Its own profile per conversion. LibreOffice refuses to start a second
        // headless instance against a profile already in use, so without this a
        // second simultaneous upload would silently fail.
        `-env:UserInstallation=file://${path.join(dir, "profile")}`,
        "--convert-to", "docx:MS Word 2007 XML",
        "--outdir", dir,
        input,
      ], { stdio: "ignore" })

      // A corrupt or password-protected file can leave LibreOffice waiting on a
      // dialog that headless mode never shows, so the process is capped rather
      // than allowed to hold the request open indefinitely.
      const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(false) }, CONVERT_TIMEOUT_MS)
      proc.on("error", () => { clearTimeout(timer); resolve(false) })
      proc.on("close", (code) => { clearTimeout(timer); resolve(code === 0) })
    })
    if (!ok) return null

    // Located by extension rather than by assuming the output name: LibreOffice
    // derives it from the input's own document title for some files, not always
    // from the filename it was given.
    const produced = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".docx"))
    return produced ? await readFile(path.join(dir, produced)) : null
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
