import mongoose, { Schema, Document } from "mongoose"

export interface IStudy extends Document {
  name: string
  category: string
  price: number
  fromCatalogue: boolean
  firstSeenAt: Date
  lastBilledAt?: Date
}

const StudySchema = new Schema<IStudy>(
  {
    name:          { type: String, required: true, unique: true, trim: true },
    category:      { type: String, required: true, default: "Other" },
    price:         { type: Number, default: 0 },
    fromCatalogue: { type: Boolean, default: false },
    firstSeenAt:   { type: Date, default: () => new Date() },
    lastBilledAt:  { type: Date },
  },
  { timestamps: true }
)

export default mongoose.models.Study || mongoose.model<IStudy>("Study", StudySchema)
