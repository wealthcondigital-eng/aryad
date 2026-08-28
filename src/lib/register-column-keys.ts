// Naming for the columns a clinic adds to a register sheet itself.
//
// Deliberately free of imports: the grid in the browser and the write path on
// the server both need to tell a clinic-added column from one of the
// register's own, and the server-side module that does the writing pulls in
// Mongoose — which has no business in a client bundle.

/**
 * The prefix that marks a column as one the clinic added. It is what tells the
 * two kinds apart everywhere: the register's own fields are named fields on the
 * row, these live together in the row's `extra`.
 */
export const CUSTOM_COLUMN_PREFIX = "x_"

export const isCustomColumn = (key: string) => key.startsWith(CUSTOM_COLUMN_PREFIX)

/** The key a clinic's own column name turns into: "Referral Fee" → "x_referral_fee". */
export function customColumnKey(label: string): string {
  const slug = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return slug ? `${CUSTOM_COLUMN_PREFIX}${slug}` : ""
}
