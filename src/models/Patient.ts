import mongoose, { Schema, Document } from "mongoose"

export interface IEditHistoryEntry {
  editor: string
  editedAt: Date
  body: string    // clean HTML (no report-edited spans) at the time of this edit
}

export interface IRegistrationEditEntry {
  editor: string
  editedAt: Date
  changedFields: string[]
  previousValues: Record<string, unknown>
}

// One study booked for the patient — each study gets its own separate report
export interface IStudyEntry {
  name: string
  category: string            // "X-Ray" | "Sonography" | "Pathology"
  reportStatus: "pending" | "in_progress" | "completed"
  reportBody: string
  reportDocx: string
  reportPdf: string
  reportSlug: string
  editHistory: IEditHistoryEntry[]
  billId?: mongoose.Types.ObjectId | null
  charges?: number
  paid?: number
  discount?: number
  paymentMode?: string
}

export interface IPatient extends Document {
  srNo: number
  name: string
  age: number
  gender: "Male" | "Female" | "Other"
  contact: string
  address?: string
  referredBy?: string
  study: string               // legacy mirror: name of the first study (kept for backward compat)
  studies: IStudyEntry[]      // all studies for this patient, each with its own report
  reportStatus: "pending" | "in_progress" | "completed"  // aggregate across studies
  reportBody: string          // legacy mirror of studies[0]
  reportDocx: string          // legacy mirror of studies[0]
  reportPdf:  string          // legacy mirror of studies[0]
  reportSlug: string          // legacy mirror of studies[0]
  editHistory: IEditHistoryEntry[]  // legacy mirror of studies[0]
  registrationEditHistory: IRegistrationEditEntry[]  // stack: index 0 = most recent registration edit
  charges: number
  paid: number
  discount: number
  paymentMode: string
  billId?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const EditHistorySchema = new Schema<IEditHistoryEntry>(
  {
    editor:   { type: String, required: true },
    editedAt: { type: Date,   required: true },
    body:     { type: String, default: "" },
  },
  { _id: false }
)

const StudyEntrySchema = new Schema<IStudyEntry>(
  {
    name:         { type: String, required: true, trim: true },
    category:     { type: String, default: "" },
    reportStatus: { type: String, default: "pending", enum: ["pending", "in_progress", "completed"] },
    reportBody:   { type: String, default: "" },
    reportDocx:   { type: String, default: "" },
    reportPdf:    { type: String, default: "" },
    reportSlug:   { type: String, default: "" },
    editHistory:  { type: [EditHistorySchema], default: [] },
    billId:       { type: Schema.Types.ObjectId, ref: "Bill", default: null },
    charges:      { type: Number, default: 0 },
    paid:         { type: Number, default: 0 },
    discount:     { type: Number, default: 0 },
    paymentMode:  { type: String, default: "Cash" },
  },
  { _id: false }
)

const RegistrationEditHistorySchema = new Schema<IRegistrationEditEntry>(
  {
    editor:         { type: String,              required: true },
    editedAt:       { type: Date,                required: true },
    changedFields:  { type: [String],            default: []    },
    previousValues: { type: Schema.Types.Mixed,  default: {}    },
  },
  { _id: false }
)

const PatientSchema = new Schema<IPatient>(
  {
    srNo:                    { type: Number, required: true, unique: true },
    name:                    { type: String, required: true, trim: true },
    age:                     { type: Number, required: true },
    gender:                  { type: String, required: true, enum: ["Male", "Female", "Other"] },
    contact:                 { type: String, required: true },
    address:                 { type: String, default: "" },
    referredBy:              { type: String, default: "Self" },
    study:                   { type: String, required: true },
    studies:                 { type: [StudyEntrySchema], default: [] },
    reportStatus:            { type: String, default: "pending", enum: ["pending", "in_progress", "completed"] },
    reportBody:              { type: String, default: "" },
    reportDocx:              { type: String, default: "" },
    reportPdf:               { type: String, default: "" },
    reportSlug:              { type: String, default: "", sparse: true },
    editHistory:             { type: [EditHistorySchema],             default: [] },
    registrationEditHistory: { type: [RegistrationEditHistorySchema], default: [] },
    charges:                 { type: Number, default: 0 },
    paid:                    { type: Number, default: 0 },
    discount:                { type: Number, default: 0 },
    paymentMode:             { type: String, default: "Cash" },
    billId:                  { type: Schema.Types.ObjectId, ref: "Bill", default: null },
  },
  { timestamps: true }
)

export default mongoose.models.Patient || mongoose.model<IPatient>("Patient", PatientSchema)
