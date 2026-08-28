import { Schema, Document } from "mongoose"
import { defineModel } from "@/lib/model"

// A month's sheet exists in its own right, not merely as a side effect of having
// rows: a sheet started for next month stays on the tab strip through refreshes,
// empty, until someone removes it deliberately.
export interface IRegisterSheet extends Document {
  month: string          // "Jun 2026"
  createdBy: string
  /**
   * Columns taken off this sheet, by column key. The register's columns are
   * fixed fields, so removing one hides it here rather than dropping data —
   * the same as hiding a column in Excel, and per sheet the way Excel does it.
   * Nothing is erased: unhide and the values are all still there.
   */
  hiddenColumns: string[]
  /**
   * Columns the clinic added to this sheet itself — a blank column of its own,
   * typed into like any other. `key` is always prefixed `x_` so it can never
   * collide with one of the register's built-in fields, and the values live in
   * each row's `extra`. `after` is the key of the column it sits behind ("" for
   * the very first), which is how "where should this go?" is remembered.
   */
  customColumns: { key: string; label: string; after: string }[]
  createdAt: Date
  updatedAt: Date
}

const RegisterSheetSchema = new Schema<IRegisterSheet>(
  {
    month:         { type: String, required: true, unique: true },
    createdBy:     { type: String, default: "" },
    hiddenColumns: { type: [String], default: [] },
    customColumns: {
      type: [new Schema({
        key:   { type: String, required: true },
        label: { type: String, required: true, trim: true },
        after: { type: String, default: "" },
      }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true }
)

export default defineModel<IRegisterSheet>("RegisterSheet", RegisterSheetSchema)
