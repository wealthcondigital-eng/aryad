import { Schema, Document } from "mongoose"
import { defineModel } from "@/lib/model"

// The consultant radiologists who sign off on reports (not to be confused
// with the "Doctors" directory, which tracks referring physicians). There are
// normally just two, seeded by name — each can have a signature image
// uploaded from the desktop, stamped onto reports/Word/PDF output in place of
// the plain-text name when present.
export interface ISignatory extends Document {
  name: string          // e.g. "DR. PRADNYA GORE"
  credentials: string[] // e.g. ["Consultant Radiologist"]
  signatureImage: string // base64 data URL, "" if none uploaded yet
  order: number          // left-to-right position in the two-column block
}

const SignatorySchema = new Schema<ISignatory>(
  {
    name:           { type: String, required: true, trim: true, unique: true },
    credentials:    { type: [String], default: [] },
    signatureImage: { type: String, default: "" },
    order:          { type: Number, default: 0 },
  },
  { timestamps: true }
)

export default defineModel<ISignatory>("Signatory", SignatorySchema)
