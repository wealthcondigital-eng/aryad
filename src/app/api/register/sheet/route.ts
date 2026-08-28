import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterSheet from "@/models/RegisterSheet"
import { ensureRegisterSheet } from "@/lib/register-sheet"
import RegisterEntry from "@/models/RegisterEntry"
import { customColumnKey, isCustomColumn } from "@/lib/register-cells"

// POST /api/register/sheet — start a month's sheet
//
// Recorded separately from its rows so an empty sheet still has a tab after a
// refresh. Importing or typing into a month creates its sheet too, so the tab
// strip is the same list either way.
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body  = await req.json()
    const month = String(body.month ?? "").trim()
    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 })
    if (isNaN(new Date(`1 ${month}`).getTime())) {
      return NextResponse.json({ error: `"${month}" is not a month` }, { status: 400 })
    }

    // Starts with the same columns as the newest sheet, so a month opened here
    // doesn't put back columns the clinic has taken off.
    await ensureRegisterSheet(month, String(body.createdBy ?? "").trim())
    const sheet = await RegisterSheet.findOne({ month })

    return NextResponse.json({ sheet }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// PATCH /api/register/sheet — change which columns a month's sheet has
//
// Body, one of:
//   { month, hideColumn }               take one of the register's own columns off
//   { month, showColumn }               put one back
//   { month, addColumn: { label, after } }   add a blank column of the clinic's own
//   { month, dropColumn }               delete a clinic-added column outright
//
// The register's own columns are fixed fields, so removing one hides it: the
// values stay in the rows underneath. A column the clinic added is theirs, so
// deleting it removes the column for real. Per sheet either way, the way
// columns in Excel belong to a worksheet.
export async function PATCH(req: NextRequest) {
  try {
    await connectDB()
    const body  = await req.json()
    const month = String(body.month ?? "").trim()
    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 })

    const hide = String(body.hideColumn ?? "").trim()
    const show = String(body.showColumn ?? "").trim()
    const drop = String(body.dropColumn ?? "").trim()
    const add  = body.addColumn as { label?: string; after?: string } | undefined

    let update: Record<string, unknown> | null = null

    if (add) {
      const label = String(add.label ?? "").trim()
      if (!label) return NextResponse.json({ error: "Give the column a name" }, { status: 400 })
      if (label.length > 40) return NextResponse.json({ error: "That name is too long for a column heading" }, { status: 400 })

      const key = customColumnKey(label)
      if (!key) return NextResponse.json({ error: "That name has no letters or numbers in it" }, { status: 400 })

      const existing = await RegisterSheet.findOne({ month }).select("customColumns").lean<{ customColumns?: { key: string }[] }>()
      if ((existing?.customColumns ?? []).some((c) => c.key === key)) {
        return NextResponse.json({ error: `${month} already has a column called "${label}"` }, { status: 409 })
      }
      update = { $push: { customColumns: { key, label, after: String(add.after ?? "").trim() } } }
    } else if (drop) {
      // Only ever a clinic-added column: the register's own are hidden, not dropped.
      if (!isCustomColumn(drop)) return NextResponse.json({ error: "That column can't be deleted" }, { status: 400 })
      update = { $pull: { customColumns: { key: drop } } }
    } else if (hide) {
      update = { $addToSet: { hiddenColumns: hide } }
    } else if (show) {
      update = { $pull: { hiddenColumns: show } }
    } else if (body.showAllColumns) {
      update = { $set: { hiddenColumns: [] } }
    }

    if (!update) return NextResponse.json({ error: "Nothing to change" }, { status: 400 })

    const sheet = await RegisterSheet.findOneAndUpdate(
      { month },
      { ...update, $setOnInsert: { month, createdBy: "" } },
      { upsert: true, returnDocument: "after" }
    )

    // Deleting a clinic-added column takes its values with it — there is no
    // column left for them to belong to, and leaving them would quietly come
    // back if a column of the same name were ever added again.
    if (drop) {
      await RegisterEntry.updateMany({ month }, { $unset: { [`extra.${drop}`]: "" } })
    }

    return NextResponse.json({
      sheet,
      hiddenColumns: sheet.hiddenColumns ?? [],
      customColumns: sheet.customColumns ?? [],
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
