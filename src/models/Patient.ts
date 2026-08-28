import mongoose, { Schema, Document } from "mongoose"
import { defineModel } from "@/lib/model"

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

// Per-report drag/resize override for a signatory's signature image (index 0/1
// matches the two signature-block columns) — left/top are unset until the
// signature has been manually dragged; width/height until manually resized.
export interface ISignatureLayout {
  left?: number
  top?: number
  width?: number
  height?: number
  hidden?: boolean
  hiddenSignatory?: boolean
  overrideImage?: string
  nameHtml?: string        // per-report rich text for the doctor's name line
  credentialsHtml?: string // per-report rich text for the credential lines
}

// One study booked for the patient — each study gets its own separate report
export interface IStudyEntry {
  name: string
  category: string            // "X-Ray" | "Sonography" | "Pathology"
  heading?: string            // doctor-edited report heading (falls back to the study name if unset)
  headingFont?: string        // font family chosen for the heading, applied in print/DOCX output
  patientBoxFont?: string     // font family chosen for the NAME/REF.BY/DATE/AGE/SEX box, applied in print/DOCX output
  topSpacerLines?: number      // blank lines above the patient box
  headerHeightPx?: number     // resized top letterhead band (editor/print/PDF); unset falls back to LETTERHEAD_TOP_PX
  footerHeightPx?: number     // resized bottom letterhead band (editor/print/PDF); unset falls back to LETTERHEAD_BOTTOM_PX
  reportDate?: string         // per-study override for the date shown in the patient box (falls back to the patient's registration date)
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
  signatureLayout?: (ISignatureLayout | null)[]
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
  heading?: string            // legacy mirror of studies[0].heading
  headingFont?: string        // legacy mirror of studies[0].headingFont
  patientBoxFont?: string     // legacy mirror of studies[0].patientBoxFont
  headerHeightPx?: number     // legacy mirror of studies[0].headerHeightPx
  footerHeightPx?: number     // legacy mirror of studies[0].footerHeightPx
  reportDate?: string        // legacy mirror of studies[0].reportDate
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
  /**
   * The date the patient was seen — settable on the registration form, so an
   * entry typed in days later still files under the day the work was done.
   * Everything downstream reads this: the register's DATE and which month's
   * sheet the row sits on, the report date, "today's patients", the dashboard
   * and analytics. See lib/visit-date.ts.
   */
  createdAt: Date
  /** When the record was actually typed. Never backdated — the audit trail. */
  enteredAt?: Date
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
    heading:      { type: String, default: "" },
    headingFont:  { type: String, default: "" },
    patientBoxFont: { type: String, default: "" },
    topSpacerLines: { type: Number },
    headerHeightPx: { type: Number },
    footerHeightPx: { type: Number },
    reportDate:   { type: String, default: "" },
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
    signatureLayout: { type: [Schema.Types.Mixed], default: undefined },
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
    heading:                 { type: String, default: "" },
    headingFont:             { type: String, default: "" },
    patientBoxFont:          { type: String, default: "" },
    headerHeightPx:          { type: Number },
    footerHeightPx:          { type: Number },
    reportDate:              { type: String, default: "" },
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
    enteredAt:               { type: Date },
  },
  { timestamps: true }
)

export default defineModel<IPatient>("Patient", PatientSchema)
