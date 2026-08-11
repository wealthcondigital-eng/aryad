/**
 * Splitting one bill's money across the studies it covers.
 *
 * A bill carries three whole-bill numbers — charges, discount, paid — plus a
 * line per study. Every place that mirrored a bill onto a patient's studies used
 * to copy those whole-bill numbers onto EVERY study it covered, so a patient
 * with a ₹1500 scan and a ₹700 scan ended up with ₹2200 recorded against each
 * of them. The monthly register reads those per-study figures, which is where it
 * showed ₹2200 twice for a ₹2200 bill and totalled the month at ₹4400.
 *
 * Four call sites mirrored a bill that way (raising a bill, editing one, and
 * adding or removing a study from a billed patient), so the split lives here
 * rather than in any one of them.
 */

export interface BillLine {
  study?: string
  quantity?: number
  price?: number
  discount?: number
}

export interface BillTotals {
  charges?: number
  discount?: number
  paid?: number
  paymentMode?: string
}

export interface StudyMoney {
  charges: number
  discount: number
  paid: number
  paymentMode: string
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const key = (v: unknown) => String(v ?? "").trim().toLowerCase()

/**
 * What each of `studyNames` is worth on this bill, in the same order.
 *
 * The three numbers always add back up to the bill: the register, the patient
 * screens and the analytics all read these, and a split that didn't sum to the
 * bill would simply move the wrong total somewhere else.
 */
export function splitBillAcrossStudies(
  studyNames: string[],
  items: BillLine[] | undefined,
  totals: BillTotals,
): StudyMoney[] {
  const paymentMode = totals.paymentMode ?? "Cash"
  const charges  = num(totals.charges)
  const discount = num(totals.discount)
  const paid     = num(totals.paid)

  // One study on the bill: it owns the whole bill, line items or not. This is
  // also the single-study path every older record takes.
  if (studyNames.length <= 1) {
    return studyNames.map(() => ({ charges, discount, paid, paymentMode }))
  }

  const lines = new Map<string, { charges: number; discount: number }>()
  for (const i of items ?? []) {
    const k = key(i.study)
    if (!k) continue
    const cur = lines.get(k) ?? { charges: 0, discount: 0 }
    // quantity defaults to 1 — an old line saved without one is still one scan
    cur.charges  += num(i.price) * (num(i.quantity) || 1)
    cur.discount += num(i.discount)
    lines.set(k, cur)
  }

  // Nothing on the bill names any of these studies — a study renamed after it
  // was billed, or a bill from before line items were itemised. The whole bill
  // lands on the first study rather than on all of them, so the month still
  // totals to the bill instead of to a multiple of it.
  if (!studyNames.some((n) => lines.has(key(n)))) {
    return studyNames.map((_, i) =>
      i === 0
        ? { charges, discount, paid, paymentMode }
        : { charges: 0, discount: 0, paid: 0, paymentMode })
  }

  const out: StudyMoney[] = studyNames.map((n) => {
    const line = lines.get(key(n))
    return { charges: line?.charges ?? 0, discount: line?.discount ?? 0, paid: 0, paymentMode }
  })

  // Item discounts are the truth when they add up to the bill's own discount —
  // that is exactly how the billing screen writes them. A bill carrying only a
  // whole-bill discount (they pre-date per-item discounts) is spread the same
  // way the payment is, so the parts still sum to the bill.
  const lineDiscount = out.reduce((s, o) => s + o.discount, 0)
  if (Math.abs(lineDiscount - discount) > 0.5) {
    let left = discount
    for (const o of out) {
      const take = Math.max(0, Math.min(left, o.charges))
      o.discount = take
      left -= take
    }
    if (left > 0) out[out.length - 1].discount += left
  }

  // The payment is one amount for the whole bill, so it is settled line by line:
  // the first study is paid off, then the next, and what is left unpaid falls to
  // the last ones as their balance. Anything paid over the total sits on the
  // last study so the parts still add up to what was taken.
  let left = paid
  for (const o of out) {
    const take = Math.max(0, Math.min(left, o.charges - o.discount))
    o.paid = take
    left -= take
  }
  if (left > 0) out[out.length - 1].paid += left

  return out
}

/** The shape of a study entry this can write to — the Patient sub-document. */
export interface StudyMoneyTarget {
  name?: string
  charges?: number
  discount?: number
  paid?: number
  paymentMode?: string
}

/**
 * Writes each study's own share of the bill onto it. Callers still own
 * `markModified("studies")` and the save.
 */
export function applyBillToStudies(
  entries: StudyMoneyTarget[],
  items: BillLine[] | undefined,
  totals: BillTotals,
): void {
  const split = splitBillAcrossStudies(entries.map((e) => e.name ?? ""), items, totals)
  entries.forEach((entry, i) => {
    const money = split[i]
    if (!money) return
    entry.charges     = money.charges
    entry.discount    = money.discount
    entry.paid        = money.paid
    entry.paymentMode = money.paymentMode
  })
}

/** A patient's own totals — the sum of their studies, whatever the bill split. */
export function patientTotals(entries: StudyMoneyTarget[]) {
  return {
    charges:  entries.reduce((s, e) => s + num(e.charges), 0),
    discount: entries.reduce((s, e) => s + num(e.discount), 0),
    paid:     entries.reduce((s, e) => s + num(e.paid), 0),
  }
}
