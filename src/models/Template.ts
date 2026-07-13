import mongoose, { Schema, Document } from "mongoose"

// A clinic-added report template — created either by typing one up directly
// or by importing a .docx file (converted to HTML on the server via mammoth).
// These sit alongside the built-in templates bundled in src/lib/report-templates.ts.
// `category` is free-form (not limited to the 4 built-in ones) so the clinic
// can create its own categories from the Add Template page.
export interface ITemplate extends Document {
  category: string
  name: string
  heading: string   // study heading shown centered + underlined in the editor
  preview: string   // short plain-text excerpt shown on the template card
  body: string      // HTML for the contentEditable report body
  createdAt: Date
}

const TemplateSchema = new Schema<ITemplate>(
  {
    category: { type: String, required: true, trim: true },
    name:     { type: String, required: true, trim: true },
    heading:  { type: String, required: true, trim: true },
    preview:  { type: String, default: "" },
    body:     { type: String, required: true },
  },
  { timestamps: true }
)

export default mongoose.models.Template || mongoose.model<ITemplate>("Template", TemplateSchema)
