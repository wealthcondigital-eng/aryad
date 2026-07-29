import mongoose, { Schema, Document } from "mongoose"

// A month's sheet exists in its own right, not merely as a side effect of having
// rows: a sheet started for next month stays on the tab strip through refreshes,
// empty, until someone removes it deliberately.
export interface IRegisterSheet extends Document {
  month: string          // "Jun 2026"
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

const RegisterSheetSchema = new Schema<IRegisterSheet>(
  {
    month:     { type: String, required: true, unique: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
)

export default mongoose.models.RegisterSheet ||
  mongoose.model<IRegisterSheet>("RegisterSheet", RegisterSheetSchema)
