import mongoose, { Schema, Document } from "mongoose"
import { defineModel } from "@/lib/model"

// A register row that was taken off a sheet by hand.
//
// Rows mirrored from a patient are recreated by the next registration edit or
// bill, and by simply reopening the month — so deleting one outright would put
// it straight back on the sheet. This records that the row was removed on
// purpose, and the sync skips it from then on.
//
// Keyed on the patient AND the study's position in their list AND the study's
// name. All three, because the first two alone would suppress the wrong thing:
// if the patient's studies are later edited so that slot holds a different
// study, that is a genuinely new row and it has to appear as normal.
//
// The row is gone rather than flagged, the way deleting a row in Excel removes
// it. To put it back, type it on the sheet's own entry line.
export interface IRegisterRowRemoval extends Document {
  patientId: mongoose.Types.ObjectId
  studyIndex: number
  studyName: string        // lower-cased, so the match is case-insensitive
  month: string            // the sheet it came off, for tracing
  removedAt: Date
  removedBy: string
}

const RegisterRowRemovalSchema = new Schema<IRegisterRowRemoval>(
  {
    patientId:  { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    studyIndex: { type: Number, required: true, default: 0 },
    studyName:  { type: String, default: "", trim: true, lowercase: true },
    month:      { type: String, default: "" },
    removedAt:  { type: Date,   default: Date.now },
    removedBy:  { type: String, default: "" },
  },
  { timestamps: true }
)

// One removal per patient + study slot: deleting the same row twice (or after
// it was retyped and removed again) updates the record rather than piling up.
RegisterRowRemovalSchema.index({ patientId: 1, studyIndex: 1 }, { unique: true })

export default defineModel<IRegisterRowRemoval>("RegisterRowRemoval", RegisterRowRemovalSchema)
