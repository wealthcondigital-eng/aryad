// Mirrors a system-registered patient into the monthly register, so the month's
// sheet in the app is the whole month's work — the rows imported from Excel plus
// every patient booked in the system since — without anyone retyping anything.
//
// One register row per study, keyed on the patient + study index, so re-running
// this after a registration edit or a bill updates the same rows in place.

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

// Never let a bookkeeping mirror break a registration or a bill: every call site
// awaits this, but a failure is logged and swallowed.
export async function syncPatientToRegister(patient: SyncPatient, entryBy = ""): Promise<void> {
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

    const ops = studies.map((s, idx) => {
      const charges  = num(s.charges)
      const discount = num(s.discount)
      const paid     = num(s.paid)
      return {
        updateOne: {
          filter: { importKey: `sys::${id}::${idx}` },
          update: {
            $set: {
              month,
              sourceType: "system",
              patientId: patient._id,
              studyIndex: idx,
              sheetName: "",
              fileName: "",
              rowNo: 0,
              importKey: `sys::${id}::${idx}`,
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
              importedAt: new Date(),
              importedBy: entryBy,
            },
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
