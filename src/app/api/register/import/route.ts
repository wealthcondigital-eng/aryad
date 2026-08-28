import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterEntry from "@/models/RegisterEntry"
import { ensureRegisterSheet } from "@/lib/register-sheet"

const MAX_ROWS = 20_000

type IncomingRow = {
  rowNo?: number
  srNo?: number | null
  date?: string | null
  name?: string
  age?: number | null
  gender?: string
  contact?: string
  department?: string
  investigation?: string
  referredBy?: string
  paymentType?: string
  charges?: number
  discount?: number
  paid?: number
  balance?: number
  entryBy?: string
}

const str = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// POST /api/register/import
// Body: { month, sheetName, fileName, importedBy, replace, rows: [...] }
//
// Rows are matched on `importKey` (month + serial no), so re-importing a
// corrected sheet for a month updates those rows rather than duplicating them.
// With `replace: true` the sheet is treated as the source of truth and rows
// previously saved for that month but no longer present are removed.
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()

    const month     = str(body.month)
    const sheetName = str(body.sheetName)
    const fileName  = str(body.fileName)
    const importedBy = str(body.importedBy)
    const replace   = body.replace === true
    const rows: IncomingRow[] = Array.isArray(body.rows) ? body.rows : []

    if (!month)        return NextResponse.json({ error: "month is required" }, { status: 400 })
    if (rows.length === 0) return NextResponse.json({ error: "No rows to import" }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS})` }, { status: 400 })

    const importedAt = new Date()
    const seen = new Set<string>()
    const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert: boolean } }[] = []

    for (const r of rows) {
      const rowNo = num(r.rowNo)
      const srNo  = r.srNo == null || r.srNo === undefined ? null : num(r.srNo)
      const importKey = `${month}::${srNo ?? `r${rowNo}`}`
      if (seen.has(importKey)) continue      // two rows sharing a serial no — first wins
      seen.add(importKey)

      const charges  = num(r.charges)
      const discount = num(r.discount)
      const paid     = num(r.paid)
      const parsedDate = r.date ? new Date(r.date) : null

      ops.push({
        updateOne: {
          filter: { importKey },
          update: {
            $set: {
              month, sheetName, fileName, rowNo, importKey, srNo,
              sourceType: "excel",
              date: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null,
              name:          str(r.name),
              age:           r.age == null ? null : num(r.age),
              gender:        str(r.gender),
              contact:       str(r.contact),
              department:    str(r.department),
              investigation: str(r.investigation),
              referredBy:    str(r.referredBy),
              paymentType:   str(r.paymentType),
              charges, discount, paid,
              balance: r.balance == null ? Math.max(0, charges - discount - paid) : num(r.balance),
              entryBy: str(r.entryBy),
              importedAt, importedBy,
            },
          },
          upsert: true,
        },
      })
    }

    const res = await RegisterEntry.bulkWrite(ops, { ordered: false })

    // The month now has a sheet of its own, so its tab survives row deletions
    await ensureRegisterSheet(month, importedBy)

    let removed = 0
    if (replace) {
      // Only rows that came from a sheet are the sheet's to remove — entries
      // typed into the month by hand, and those mirrored from patients booked
      // in the system, survive a re-import. Matching on the import key rather
      // than sourceType keeps that true for rows written before sourceType
      // existed, since the key itself encodes the origin.
      const stale = await RegisterEntry.deleteMany({
        month,
        importKey: { $nin: Array.from(seen), $not: /(^sys::|::man::)/ },
      })
      removed = stale.deletedCount ?? 0
    }

    return NextResponse.json({
      month,
      saved:    ops.length,
      inserted: res.upsertedCount ?? 0,
      updated:  res.modifiedCount ?? 0,
      removed,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
