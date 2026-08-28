import { Schema, Document } from "mongoose"
import { defineModel } from "@/lib/model"

// A built-in template the clinic has removed.
//
// Built-ins are bundled in src/lib/report-templates.ts, not stored in Mongo, so
// there is no row to delete — instead the id is recorded here and every list
// (Add Template page, the editor's Templates panel) filters it out. Keeping the
// removal as its own record rather than editing the bundle means a deploy can
// still ship new/updated built-ins, and a removal can be undone.
export interface IHiddenTemplate extends Document {
  templateId: string  // the built-in's slug id, e.g. "anomaly-scan"
  name: string        // kept for the "removed templates" list, so it can be shown without loading the bundle
  category: string
  createdAt: Date
}

const HiddenTemplateSchema = new Schema<IHiddenTemplate>(
  {
    templateId: { type: String, required: true, unique: true, trim: true },
    name:       { type: String, default: "" },
    category:   { type: String, default: "" },
  },
  { timestamps: true }
)

export default defineModel<IHiddenTemplate>("HiddenTemplate", HiddenTemplateSchema)
