import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterEntry from "@/models/RegisterEntry"
import RegisterSheet from "@/models/RegisterSheet"
import Patient from "@/models/Patient"
import { syncPatientToRegister } from "@/lib/register-sync"

// "Jun 2026" → sortable timestamp, so the month list reads newest-first
function monthStamp(month: string) {
  const t = new Date(`1 ${month}`).getTime()
  return Number.isFinite(t) ? t : 0
}

// Patients booked in the system belong on that month's sheet whether or not they
// were registered before this mirroring existed — so opening a month tops it up
// with any patient of that month that has no row yet. Idempotent: rows are keyed
// on patient + study, so a month that is already complete does no writes.
async function backfillSystemRows(month: string) {
  const start = new Date(`1 ${month}`)
  if (isNaN(start.getTime())) return
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)

  const patients = await Patient.find({ createdAt: { $gte: start, $lt: end } })
    .select("srNo name age gender contact referredBy study studies.name studies.category studies.charges studies.paid studies.discount studies.paymentMode charges paid discount paymentMode createdAt")
    .lean<Record<string, unknown>[]>()
  if (patients.length === 0) return

  const existing = await RegisterEntry.find({ month, importKey: { $regex: "^sys::" } }).select("importKey").lean<{ importKey: string }[]>()
  const have = new Set(existing.map((e) => e.importKey))

  for (const p of patients) {
    const studies = (p.studies as unknown[] | undefined) ?? []
    const count   = studies.length || (p.study ? 1 : 0)
    let missing = false
    for (let i = 0; i < count; i++) if (!have.has(`sys::${String(p._id)}::${i}`)) { missing = true; break }
    if (missing) await syncPatientToRegister(p as unknown as Parameters<typeof syncPatientToRegister>[0])
  }
}

// Values already used somewhere in the register, offered as type-ahead while a
// row is typed — so the same doctor, department or investigation is spelled the
// same way every time. `people` lets a repeat patient's age/sex/contact fill in
// from the last time they came.
async function suggestionFacets() {
  const [names, referredBy, departments, investigations, paymentTypes, entryBy] = await Promise.all([
    RegisterEntry.distinct("name"),
    RegisterEntry.distinct("referredBy"),
    RegisterEntry.distinct("department"),
    RegisterEntry.distinct("investigation"),
    RegisterEntry.distinct("paymentType"),
    RegisterEntry.distinct("entryBy"),
  ])

  const clean = (v: string[]) => v.filter((s) => typeof s === "string" && s.trim()).sort((a, b) => a.localeCompare(b))

  // Most recent row per patient name — the details worth reusing
  const recent = await RegisterEntry.find({ name: { $ne: "" } })
    .sort({ date: -1 })
    .select("name age gender contact")
    .limit(4000)
    .lean<{ name: string; age?: number; gender?: string; contact?: string }[]>()

  const people: Record<string, { age: string; gender: string; contact: string }> = {}
  for (const r of recent) {
    const key = r.name.trim().toLowerCase()
    if (!key || people[key]) continue
    people[key] = {
      age:     r.age == null ? "" : String(r.age),
      gender:  r.gender ?? "",
      contact: r.contact ?? "",
    }
  }

  return {
    name:          clean(names),
    referredBy:    clean(referredBy),
    department:    clean(departments),
    investigation: clean(investigations),
    paymentType:   clean(paymentTypes),
    entryBy:       clean(entryBy),
    people,
  }
}

// GET /api/register
//   (no params)        → month summaries only
//   ?month=Jun%202026  → summaries + that month's rows (topped up from patients)
//   ?month=all         → summaries + every row
//   &facets=1          → adds the type-ahead lists for typing rows
export async function GET(req: NextRequest) {
  try {
    await connectDB()
    const month = req.nextUrl.searchParams.get("month")?.trim()
    const wantFacets = req.nextUrl.searchParams.get("facets") === "1"

    if (month && month !== "all") await backfillSystemRows(month)

    const grouped = await RegisterEntry.aggregate([
      // Rows taken off a sheet by hand are gone as far as the register is
      // concerned — they must not count towards the month's totals either.
      { $match: { hidden: { $ne: true } } },
      {
        $group: {
          _id:        "$month",
          rows:       { $sum: 1 },
          charges:    { $sum: "$charges" },
          paid:       { $sum: "$paid" },
          balance:    { $sum: "$balance" },
          doctors:    { $addToSet: "$referredBy" },
          sheetName:  { $last: "$sheetName" },
          fileName:   { $last: "$fileName" },
          importedAt: { $max: "$importedAt" },
        },
      },
    ])

    // Sheets started but not yet filled in belong on the list too
    const started = await RegisterSheet.find().select("month").lean<{ month: string }[]>()
    const withRows = new Set(grouped.map((g) => g._id as string))
    const empties = started
      .filter((s) => !withRows.has(s.month))
      .map((s) => ({
        month: s.month, rows: 0, charges: 0, paid: 0, balance: 0, doctors: 0,
        sheetName: "", fileName: "", importedAt: null as Date | null,
      }))

    const months = [...grouped
      .map((g) => ({
        month:      g._id as string,
        rows:       g.rows as number,
        charges:    g.charges as number,
        paid:       g.paid as number,
        balance:    g.balance as number,
        doctors:    (g.doctors as string[]).filter((d) => d && d.trim()).length,
        sheetName:  g.sheetName as string,
        fileName:   g.fileName as string,
        importedAt: g.importedAt as Date | null,
      })), ...empties]
      .sort((a, b) => monthStamp(b.month) - monthStamp(a.month))

    // Sheet order, not serial order: these registers put a patient's second
    // investigation on the next line with the Sr No left blank, so sorting by
    // srNo would tear those continuation rows away from the patient they belong
    // to. Date-then-row keeps the month reading exactly as the sheet does, and
    // lets hand-added and system rows fall into place chronologically.
    let entries: unknown[] = []
    const visible = { hidden: { $ne: true } }
    if (month === "all") {
      entries = await RegisterEntry.find(visible).sort({ date: 1, rowNo: 1, srNo: 1 }).lean()
    } else if (month) {
      entries = await RegisterEntry.find({ month, ...visible }).sort({ date: 1, rowNo: 1, srNo: 1 }).lean()
    }

    return NextResponse.json({
      months,
      entries,
      ...(wantFacets ? { facets: await suggestionFacets() } : {}),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

const str = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// POST /api/register — add a single row to a month by hand
// The serial number defaults to one past the highest already in that month, so
// hand-typed rows continue the sheet's own numbering.
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const month = str(body.month)
    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 })
    if (!str(body.name)) return NextResponse.json({ error: "Patient name is required" }, { status: 400 })

    let srNo = body.srNo == null || str(body.srNo) === "" ? null : num(body.srNo)
    if (srNo == null) {
      const top = await RegisterEntry.findOne({ month }).sort({ srNo: -1 }).select("srNo").lean<{ srNo?: number }>()
      srNo = (top?.srNo ?? 0) + 1
    }

    const charges  = num(body.charges)
    const discount = num(body.discount)
    const paid     = num(body.paid)
    const date     = body.date ? new Date(body.date) : new Date(`1 ${month}`)

    const entry = await RegisterEntry.create({
      month,
      sourceType: "manual",
      importKey: `${month}::man::${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      sheetName: "",
      fileName: "",
      rowNo: 0,
      srNo,
      date: isNaN(date.getTime()) ? null : date,
      name:          str(body.name),
      age:           body.age == null || str(body.age) === "" ? null : num(body.age),
      gender:        str(body.gender),
      contact:       str(body.contact),
      department:    str(body.department),
      investigation: str(body.investigation),
      referredBy:    str(body.referredBy),
      paymentType:   str(body.paymentType),
      charges, discount, paid,
      balance: body.balance == null || str(body.balance) === "" ? Math.max(0, charges - discount - paid) : num(body.balance),
      entryBy:    str(body.entryBy),
      importedAt: new Date(),
      importedBy: str(body.entryBy),
    })

    // Typing into a month is also how a sheet gets started
    await RegisterSheet.updateOne({ month }, { $setOnInsert: { month, createdBy: str(body.entryBy) } }, { upsert: true })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/register?month=Jun%202026 — remove a month's sheet and its rows.
// This is the only thing that takes a sheet off the tab strip.
export async function DELETE(req: NextRequest) {
  try {
    await connectDB()
    const month = req.nextUrl.searchParams.get("month")?.trim()
    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 })

    const res = await RegisterEntry.deleteMany({ month })
    await RegisterSheet.deleteOne({ month })
    return NextResponse.json({ deleted: res.deletedCount ?? 0 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
