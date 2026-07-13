import mongoose, { Schema, Document } from "mongoose"

export interface IUser extends Document {
  name: string
  email: string
  password: string
  role: "admin" | "doctor" | "receptionist"
  active: boolean
  permissions: {
    patients: { view: boolean; create: boolean; edit: boolean }
    billing:  { view: boolean; create: boolean; edit: boolean }
    reports:  { view: boolean; create: boolean; edit: boolean }
    analytics:{ view: boolean }
    users:    { view: boolean; create: boolean; edit: boolean }
  }
  resetOtpHash?: string
  resetOtpExpiresAt?: Date
  resetOtpAttempts?: number
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role:     { type: String, required: true, enum: ["admin", "doctor", "receptionist"] },
    active:   { type: Boolean, default: true },
    permissions: {
      patients:  { view: Boolean, create: Boolean, edit: Boolean },
      billing:   { view: Boolean, create: Boolean, edit: Boolean },
      reports:   { view: Boolean, create: Boolean, edit: Boolean },
      analytics: { view: Boolean },
      users:     { view: Boolean, create: Boolean, edit: Boolean },
    },
    resetOtpHash:      { type: String, select: false },
    resetOtpExpiresAt: { type: Date, select: false },
    resetOtpAttempts:  { type: Number, default: 0, select: false },
  },
  { timestamps: true }
)

export default mongoose.models.User || mongoose.model<IUser>("User", UserSchema)
