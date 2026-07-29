import mongoose, { Schema, Document } from "mongoose"

// One row of an imported monthly Excel register (the JAN/FEB/.../JUN sheets the
// centre has always kept by hand). These are historical bookkeeping rows, kept
// deliberately separate from `Patient`: importing a month must never mint
// reports, bills or doctor notifications for work that was completed months ago.
//
// `importKey` is what makes a re-import an update instead of a duplicate — drop
// a corrected sheet for the same month back in and each row is matched by
// month + serial number and overwritten in place.
export interface IRegisterEntry extends Document {
  month: string            // "Jun 2026" — the bucket the whole sheet belongs to
  // Where the row came from:
  //   excel  — read out of an imported sheet
  //   manual — typed straight into the month from the Monthly Register page
  //   system — mirrored from a patient registered in the system
  sourceType: "excel" | "manual" | "system"
  patientId?: mongoose.Types.ObjectId | null   // system rows only
  studyIndex?: number                          // system rows only
  sheetName: string        // original tab name, e.g. "JUN - 2026"
  fileName: string
  rowNo: number            // row number in the sheet, for tracing back
  importKey: string        // `${month}::${srNo || "r" + rowNo}`, or `sys::${patientId}::${studyIndex}`
  srNo: number | null
  date: Date | null
  name: string
  age: number | null
  gender: string
  contact: string
  department: string
  investigation: string
  referredBy: string
  paymentType: string
  charges: number
  discount: number
  paid: number
  balance: number
  entryBy: string
  importedAt: Date
  importedBy: string
  createdAt: Date
  updatedAt: Date
}

const RegisterEntrySchema = new Schema<IRegisterEntry>(
  {
    month:         { type: String, required: true, index: true },
    sourceType:    { type: String, default: "excel", enum: ["excel", "manual", "system"], index: true },
    patientId:     { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
    studyIndex:    { type: Number, default: 0 },
    sheetName:     { type: String, default: "" },
    fileName:      { type: String, default: "" },
    rowNo:         { type: Number, default: 0 },
    importKey:     { type: String, required: true, unique: true },
    srNo:          { type: Number, default: null },
    date:          { type: Date,   default: null },
    name:          { type: String, default: "", trim: true },
    age:           { type: Number, default: null },
    gender:        { type: String, default: "" },
    contact:       { type: String, default: "" },
    department:    { type: String, default: "" },
    investigation: { type: String, default: "" },
    referredBy:    { type: String, default: "", trim: true, index: true },
    paymentType:   { type: String, default: "" },
    charges:       { type: Number, default: 0 },
    discount:      { type: Number, default: 0 },
    paid:          { type: Number, default: 0 },
    balance:       { type: Number, default: 0 },
    entryBy:       { type: String, default: "" },
    importedAt:    { type: Date,   default: Date.now },
    importedBy:    { type: String, default: "" },
  },
  { timestamps: true }
)

export default mongoose.models.RegisterEntry ||
  mongoose.model<IRegisterEntry>("RegisterEntry", RegisterEntrySchema)
