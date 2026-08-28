import mongoose, { Schema, Document } from "mongoose"
import { defineModel } from "@/lib/model"

export interface IReport extends Document {
  patientId: mongoose.Types.ObjectId
  srNo: number
  patientName: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  reportDate: string
  reportingDoctor: string
  fields: Record<string, string>
  impression: string
  status: "pending" | "in_progress" | "submitted"
  createdAt: Date
  updatedAt: Date
}

const ReportSchema = new Schema<IReport>(
  {
    patientId:       { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    srNo:            { type: Number, required: true },
    patientName:     { type: String, required: true },
    age:             { type: Number },
    gender:          { type: String },
    contact:         { type: String },
    referredBy:      { type: String, default: "Self" },
    study:           { type: String, required: true },
    reportDate:      { type: String },
    reportingDoctor: { type: String },
    fields:          { type: Map, of: String, default: {} },
    impression:      { type: String, default: "" },
    status:          { type: String, default: "pending", enum: ["pending", "in_progress", "submitted"] },
  },
  { timestamps: true }
)

export default defineModel<IReport>("Report", ReportSchema)
