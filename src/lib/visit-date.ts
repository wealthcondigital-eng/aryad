// The date a patient was seen.
//
// The app has always used the patient record's `createdAt` for this: the
// monthly register's DATE column and which month's sheet the row lands on, the
// date on the report, "today's patients", the dashboard and the analytics
// ranges all read it. That works right up until an entry is typed in late —
// the work was done on the 25th, nobody got to the computer until the 29th,
// and the whole system files it under the 29th.
//
// So the registration form asks for the date, and everything above follows it.
// `enteredAt` keeps the real wall clock of when the record was typed, so
// backdating never loses the audit trail.

/** A yyyy-mm-dd string, or "" when there is nothing usable. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Turn the date picked on a form into the timestamp to store.
 *
 * Today keeps the real clock time, so the dashboard's "10:42" and the ordering
 * of the day's registrations are unchanged. Any other date is stored at midday
 * UTC: the register formats its dates in UTC while the month is worked out
 * locally, and midday is the one time of day that reads as the same date under
 * both, in every timezone the clinic could be in.
 *
 * Returns null when the input isn't a usable date, so callers can fall back.
 */
export function visitDateToTimestamp(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]

  const now = new Date()
  const isToday = y === now.getFullYear() && mo === now.getMonth() + 1 && d === now.getDate()
  if (isToday) return now

  const stamp = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0))
  return isNaN(stamp.getTime()) ? null : stamp
}
