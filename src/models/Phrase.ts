import mongoose, { Schema, Document } from "mongoose"

// Word's AutoText / Quick Parts: a stock sentence a doctor drops into a report
// instead of retyping it. Distinct from a Template, which is a WHOLE report body
// and replaces what's in the editor — a phrase is inserted at the caret.
//
// Stored server-side rather than in the browser so a phrase written on the
// doctor's machine is there on the receptionist's too.
export interface IPhrase extends Document {
  /** What the doctor picks it by, e.g. "Normal liver". */
  name: string
  /** HTML, so a phrase keeps its bold/italic/colour when inserted. */
  body: string
  createdAt: Date
}

const PhraseSchema = new Schema<IPhrase>(
  {
    name: { type: String, required: true, trim: true },
    body: { type: String, required: true },
  },
  { timestamps: true }
)

export default mongoose.models.Phrase || mongoose.model<IPhrase>("Phrase", PhraseSchema)
