// Minimal reader for OLE2 / Compound File Binary — the container a Word
// 97-2003 .doc actually is.
//
// A .doc is not one blob: it's a little filesystem holding "WordDocument"
// (text + the FIB that indexes everything), "0Table"/"1Table" (the formatting
// tables) and "Data". Anything that wants the formatting out of a .doc has to
// open those streams first, which is all this file does — enough of the spec to
// find named streams, and nothing more.

const SIGNATURE = "d0cf11e0a1b11ae1"
const FREESECT = 0xFFFFFFFF
const ENDOFCHAIN = 0xFFFFFFFE
const DIFSECT = 0xFFFFFFFC
const FATSECT = 0xFFFFFFFD

export interface CfbFile {
  /** Stream contents by name ("WordDocument", "1Table", …), as stored. */
  streams: Map<string, Buffer>
}

export function isCfb(buffer: Buffer): boolean {
  return buffer.length > 512 && buffer.subarray(0, 8).toString("hex") === SIGNATURE
}

export function readCfb(buffer: Buffer): CfbFile | null {
  if (!isCfb(buffer)) return null
  try {
    const sectorShift = buffer.readUInt16LE(30)
    const miniSectorShift = buffer.readUInt16LE(32)
    const sectorSize = 1 << sectorShift
    const miniSectorSize = 1 << miniSectorShift
    const dirStart = buffer.readUInt32LE(48)
    const miniCutoff = buffer.readUInt32LE(56)
    const miniFatStart = buffer.readUInt32LE(60)
    const difatStart = buffer.readUInt32LE(68)
    const difatCount = buffer.readUInt32LE(72)

    const sectorOffset = (sector: number) => (sector + 1) * sectorSize
    const readSector = (sector: number): Buffer => {
      const start = sectorOffset(sector)
      if (start < 0 || start + sectorSize > buffer.length) throw new Error("sector out of range")
      return buffer.subarray(start, start + sectorSize)
    }

    // The DIFAT lists the FAT sectors: the first 109 entries live in the header,
    // the rest in a chain of their own sectors.
    const fatSectors: number[] = []
    for (let i = 0; i < 109; i++) {
      const sector = buffer.readUInt32LE(76 + i * 4)
      if (sector === FREESECT || sector === ENDOFCHAIN) break
      fatSectors.push(sector)
    }
    let next = difatStart
    for (let n = 0; n < difatCount && next !== ENDOFCHAIN && next !== FREESECT; n++) {
      const sector = readSector(next)
      const perSector = sectorSize / 4 - 1
      for (let i = 0; i < perSector; i++) {
        const entry = sector.readUInt32LE(i * 4)
        if (entry === FREESECT || entry === ENDOFCHAIN) continue
        fatSectors.push(entry)
      }
      next = sector.readUInt32LE(sectorSize - 4)
    }

    const fat: number[] = []
    for (const sector of fatSectors) {
      const data = readSector(sector)
      for (let i = 0; i < sectorSize / 4; i++) fat.push(data.readUInt32LE(i * 4))
    }
    if (!fat.length) return null

    const chain = (start: number, table: number[]): number[] => {
      const out: number[] = []
      let sector = start
      // A corrupt file can point a chain at itself; the sector count is the
      // natural ceiling on how long any honest chain can be.
      while (sector !== ENDOFCHAIN && sector !== FREESECT && sector !== DIFSECT && sector !== FATSECT) {
        if (out.length > table.length) break
        out.push(sector)
        sector = table[sector] ?? ENDOFCHAIN
      }
      return out
    }

    const readChain = (start: number, size: number): Buffer => {
      const parts = chain(start, fat).map(readSector)
      const all = Buffer.concat(parts)
      return size >= 0 && size <= all.length ? all.subarray(0, size) : all
    }

    // The directory is itself a stream of 128-byte entries.
    const dirBuf = readChain(dirStart, -1)
    const entries: { name: string; type: number; start: number; size: number }[] = []
    for (let off = 0; off + 128 <= dirBuf.length; off += 128) {
      const nameLen = dirBuf.readUInt16LE(off + 64)
      const type = dirBuf.readUInt8(off + 66)
      if (type !== 1 && type !== 2 && type !== 5) continue
      const name = nameLen > 2
        ? dirBuf.subarray(off, off + nameLen - 2).toString("utf16le")
        : ""
      entries.push({
        name,
        type,
        start: dirBuf.readUInt32LE(off + 116),
        size: dirBuf.readUInt32LE(off + 120),
      })
    }

    const root = entries.find((e) => e.type === 5)
    if (!root) return null

    // Streams under the mini-stream cutoff (4KB) are packed into the root
    // entry's own stream, indexed by a second, smaller allocation table.
    const miniFat: number[] = []
    if (miniFatStart !== ENDOFCHAIN && miniFatStart !== FREESECT) {
      const miniFatBuf = readChain(miniFatStart, -1)
      for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(miniFatBuf.readUInt32LE(i))
    }
    const miniStream = root.size > 0 ? readChain(root.start, root.size) : Buffer.alloc(0)
    const readMini = (start: number, size: number): Buffer => {
      const parts = chain(start, miniFat).map((sector) => {
        const at = sector * miniSectorSize
        return miniStream.subarray(at, at + miniSectorSize)
      })
      const all = Buffer.concat(parts)
      return size <= all.length ? all.subarray(0, size) : all
    }

    const streams = new Map<string, Buffer>()
    for (const entry of entries) {
      if (entry.type !== 2 || !entry.name) continue
      try {
        streams.set(entry.name, entry.size < miniCutoff ? readMini(entry.start, entry.size) : readChain(entry.start, entry.size))
      } catch {
        // One unreadable stream shouldn't cost the caller the others.
      }
    }
    return streams.size ? { streams } : null
  } catch {
    return null
  }
}
