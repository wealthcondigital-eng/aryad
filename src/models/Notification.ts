import mongoose, { Schema, Document } from "mongoose"

export interface INotification extends Document {
  recipientRole: "doctor" | "receptionist" | "admin"
  type: "patient_registered" | "patient_edited" | "report_submitted" | "report_updated"
  title: string
  message: string
  patientId?: mongoose.Types.ObjectId
  readBy: string[]
  createdAt: Date
  updatedAt: Date
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientRole: {
      type: String,
      enum: ["doctor", "receptionist", "admin"],
      required: true,
    },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient" },
    readBy: { type: [String], default: [] },
  },
  { timestamps: true }
)

export default mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema)
