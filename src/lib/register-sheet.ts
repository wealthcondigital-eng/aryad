// Opening a month's sheet.
//
// A sheet gets created five different ways — the "New sheet" button, importing
// a workbook, typing a row into a month that has none, registering a patient in
// one, and correcting a row's date into one. All of them come through here, so
// a new month always starts the same way whichever door it came in by.
//
// And it starts looking like the month before it. Columns taken off the sheet
// stay off next month, and a column the clinic added carries over — the way
// last month's sheet is what you'd copy to start the new one. Otherwise every
// new month would put back the columns the clinic had just removed.

import RegisterSheet from "@/models/RegisterSheet"

const monthStamp = (label: string) => new Date(`1 ${label}`).getTime() || 0

/**
 * Make sure a month has a sheet, inheriting the newest existing sheet's column
 * layout when it has to create one. Does nothing if the sheet already exists —
 * an established month keeps its own layout.
 */
export async function ensureRegisterSheet(month: string, createdBy = ""): Promise<void> {
  if (!month.trim()) return

  const existing = await RegisterSheet.findOne({ month }).select("_id").lean<{ _id: unknown } | null>()
  if (existing) return

  const sheets = await RegisterSheet.find({ month: { $ne: month } })
    .select("month hiddenColumns customColumns")
    .lean<{ month: string; hiddenColumns?: string[]; customColumns?: { key: string; label: string; after: string }[] }[]>()

  const latest = sheets.sort((a, b) => monthStamp(b.month) - monthStamp(a.month))[0]

  // $setOnInsert, not $set: two people opening the same new month at once both
  // run this, and the second must not overwrite what the first just created.
  await RegisterSheet.updateOne(
    { month },
    {
      $setOnInsert: {
        month,
        createdBy,
        hiddenColumns: latest?.hiddenColumns ?? [],
        customColumns: latest?.customColumns ?? [],
      },
    },
    { upsert: true }
  )
}
