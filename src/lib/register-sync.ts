// Mirrors a system-registered patient into the monthly register, so the month's
// sheet in the app is the whole month's work — the rows imported from Excel plus
// every patient booked in the system since — without anyone retyping anything.
//
// One register row per study, keyed on the patient + study index, so re-running
// this after a registration edit or a bill updates the same rows in place.
//
// Each row carries that study's own money, not the whole bill's — the split
// happens in @/lib/bill-allocation when the bill is saved.

import RegisterEntry from "@/models/RegisterEntry"
import RegisterSheet from "@/models/RegisterSheet"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function registerMonthLabel(d: Date) {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

interface SyncStudy {
  name?: string
  category?: string
  charges?: number
  paid?: number
  discount?: number
  paymentMode?: string
}

interface SyncPatient {
  _id: unknown
  srNo?: number
  name?: string
  age?: number
  gender?: string
  contact?: string
  referredBy?: string
  study?: string
  studies?: SyncStudy[]
  charges?: number
  paid?: number
  discount?: number
  paymentMode?: string
  createdAt?: Date | string
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// The money columns, as one group. A row's money is either the patient's or the
// sheet's own — never half of each — so they are kept and dropped together.
const MONEY_FIELDS = ["charges", "discount", "paid", "balance"] as const

interface SyncOptions {
  /**
   * A bill was just raised or edited for this patient. Money typed straight onto
   * the sheet is then overwritten by the bill's own figures and stops counting
   * as a hand correction: a figure entered before any bill existed is a stand-in
   * for one, and leaving it in place would keep a ₹1700 visit reading ₹1700 on
   * the first study and ₹0 on the second after the bill split it 1200 / 500.
   * Everything else typed on the row — a corrected name, doctor or department —
   * is untouched.
   */
  moneyFromBill?: boolean
}

// Never let a bookkeeping mirror break a registration or a bill: every call site
// awaits this, but a failure is logged and swallowed.
export async function syncPatientToRegister(
  patient: SyncPatient,
  entryBy = "",
  opts: SyncOptions = {},
): Promise<void> {
  try {
    const id = String(patient._id)
    const created = patient.createdAt ? new Date(patient.createdAt) : new Date()
    const month = registerMonthLabel(created)

    const studies: SyncStudy[] = patient.studies?.length
      ? patient.studies
      : patient.study
      ? [{
          name: patient.study, charges: patient.charges, paid: patient.paid,
          discount: patient.discount, paymentMode: patient.paymentMode,
        }]
      : []

    if (studies.length === 0) return

    // What has already been typed over by hand on this patient's rows. Those
    // columns are left alone below — a correction made on the sheet must not be
    // undone by the next bill or registration edit.
    const existing = await RegisterEntry.find({ patientId: patient._id })
      .select("importKey editedFields")
      .lean<{ importKey: string; editedFields?: string[] }[]>()
    const editedByKey = new Map(existing.map((e) => [e.importKey, new Set(e.editedFields ?? [])]))

    const ops = studies.map((s, idx) => {
      const charges  = num(s.charges)
      const discount = num(s.discount)
      const paid     = num(s.paid)
      const importKey = `sys::${id}::${idx}`
      const edited = new Set(editedByKey.get(importKey) ?? [])
      if (opts.moneyFromBill) for (const k of MONEY_FIELDS) edited.delete(k)

      const mirrored: Record<string, unknown> = {
        srNo: patient.srNo ?? null,
        date: created,
        name: (patient.name ?? "").trim(),
        age: patient.age ?? null,
        gender: patient.gender ?? "",
        contact: patient.contact ?? "",
        department: s.category ?? "",
        investigation: (s.name ?? "").trim(),
        referredBy: (patient.referredBy ?? "").trim(),
        paymentType: s.paymentMode ?? "",
        charges, discount, paid,
        balance: Math.max(0, charges - discount - paid),
        entryBy,
      }
      for (const k of edited) delete mirrored[k]
      // A hand-set charge/discount/payment has to keep its own balance too,
      // rather than one recomputed from the patient's figures.
      if (MONEY_FIELDS.some((k) => edited.has(k))) delete mirrored.balance
      // The row goes back to tracking the patient for whatever the bill just
      // took back — without rewriting the list, the next sync would restore the
      // hand-typed figure it has just replaced.
      if (opts.moneyFromBill) mirrored.editedFields = Array.from(edited)

      return {
        updateOne: {
          filter: { importKey },
          update: {
            $set: {
              month,
              sourceType: "system",
              patientId: patient._id,
              studyIndex: idx,
              importKey,
              ...mirrored,
              importedAt: new Date(),
              importedBy: entryBy,
            },
            // Only ever set on insert: a row typed over, moved or hidden keeps
            // what it was given here.
            $setOnInsert: { sheetName: "", fileName: "", rowNo: 0 },
          },
          upsert: true,
        },
      }
    })

    await RegisterEntry.bulkWrite(ops, { ordered: false })

    // A booking in a month the register hasn't seen yet opens that month's sheet
    await RegisterSheet.updateOne({ month }, { $setOnInsert: { month, createdBy: "system" } }, { upsert: true })

    // Studies removed from the patient must not linger in the month
    await RegisterEntry.deleteMany({
      sourceType: "system",
      patientId: patient._id,
      studyIndex: { $gte: studies.length },
    })
  } catch (err) {
    console.error("register sync failed", err)
  }
}
