import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import { CATALOGUE_CATEGORY_MAP } from "@/lib/study-catalogue"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await connectDB()
  const bill = await Bill.findById(id)
  if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ bill })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await connectDB()
  const body = await req.json()
  const { editor = "Receptionist", ...updatedFields } = body

  const current = await Bill.findById(id)
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Compute diff
  const trackFields = ["patientName", "referredBy", "billDate", "charges", "discount", "paid", "paymentMode", "notes", "items"]
  const changedFields: string[] = []
  const previousValues: Record<string, unknown> = {}
  for (const key of trackFields) {
    if (key in updatedFields && JSON.stringify(current.get(key)) !== JSON.stringify(updatedFields[key])) {
      changedFields.push(key)
      previousValues[key] = current.get(key)
    }
  }

  const charges     = updatedFields.charges     ?? current.charges
  const discount    = updatedFields.discount    ?? current.discount
  const paid        = updatedFields.paid        ?? current.paid
  const paymentMode = updatedFields.paymentMode ?? current.paymentMode
  const balance     = charges - discount - paid

  const editEntry = { editor, editedAt: new Date(), changedFields, previousValues }

  const updated = await Bill.findByIdAndUpdate(
    id,
    {
      $set:  { ...updatedFields, balance, charges, discount, paid, paymentMode },
      $push: { editHistory: { $each: [editEntry], $position: 0 } },
    },
    { returnDocument: "after" }
  )

  await Patient.findByIdAndUpdate(current.patientId, { charges, paid, discount, paymentMode })

  // Update Study catalogue prices from updated bill items
  const items: Array<{ study: string; price: number }> = updatedFields.items ?? current.items ?? []
  for (const item of items) {
    if (!item.study || !item.price) continue
    const cat = CATALOGUE_CATEGORY_MAP[item.study] ?? "Other"
    await Study.findOneAndUpdate(
      { name: item.study },
      {
        $set:         { price: item.price, lastBilledAt: new Date() },
        $setOnInsert: { name: item.study, category: cat, fromCatalogue: !!CATALOGUE_CATEGORY_MAP[item.study], firstSeenAt: new Date() },
      },
      { upsert: true }
    )
  }

  return NextResponse.json({ bill: updated })
}
