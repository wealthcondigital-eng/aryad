import mongoose, { Schema, Document } from "mongoose"

export interface IBillItem {
  study: string
  quantity: number
  price: number
  discount: number
}

export interface IBillEditEntry {
  editor: string
  editedAt: Date
  changedFields: string[]
  previousValues: Record<string, unknown>
}

export interface IBill extends Document {
  patientId: mongoose.Types.ObjectId
  srNo: number
  patientName: string
  age: number
  gender: string
  contact: string
  referredBy: string
  items: IBillItem[]
  charges: number
  discount: number
  paid: number
  balance: number
  paymentMode: string
  billDate: string
  notes?: string
  billPdf?: string
  billSlug?: string
  editHistory: IBillEditEntry[]
  createdAt: Date
  updatedAt: Date
}

const BillEditHistorySchema = new Schema(
  {
    editor:         { type: String },
    editedAt:       { type: Date },
    changedFields:  [String],
    previousValues: { type: Schema.Types.Mixed },
  },
  { _id: false }
)

const BillSchema = new Schema<IBill>(
  {
    patientId:   { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    srNo:        { type: Number, required: true },
    patientName: { type: String, required: true },
    age:         { type: Number },
    gender:      { type: String },
    contact:     { type: String },
    referredBy:  { type: String, default: "Self" },
    items: [
      {
        study:    { type: String, required: true },
        quantity: { type: Number, default: 1 },
        price:    { type: Number, required: true },
        discount: { type: Number, default: 0 },
      },
    ],
    charges:     { type: Number, required: true },
    // Whole-bill discount — kept in sync as the sum of each item's own
    // discount, since Net Amount/Balance Due calculations elsewhere already
    // read this single field rather than re-summing the items every time.
    discount:    { type: Number, default: 0 },
    paid:        { type: Number, required: true },
    balance:     { type: Number, default: 0 },
    paymentMode: { type: String, default: "Cash" },
    billDate:    { type: String },
    notes:       { type: String, default: "" },
    billPdf:     { type: String, default: "" },
    billSlug:    { type: String, sparse: true },
    editHistory: { type: [BillEditHistorySchema], default: [] },
  },
  { timestamps: true }
)

export default mongoose.models.Bill || mongoose.model<IBill>("Bill", BillSchema)
