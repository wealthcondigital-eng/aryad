import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import { CATALOGUE_CATEGORY_MAP } from "@/lib/study-catalogue"

// GET /api/billing
export async function GET() {
  try {
    await connectDB()
    const bills = await Bill.find().sort({ createdAt: -1 })
    return NextResponse.json({ bills })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/billing — create a new bill
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const balance = (body.charges ?? 0) - (body.discount ?? 0) - (body.paid ?? 0)
    const bill = await Bill.create({ ...body, balance })

    // Update patient paid/charges and link bill
    await Patient.findByIdAndUpdate(body.patientId, {
      charges: body.charges,
      paid: body.paid,
      discount: body.discount,
      paymentMode: body.paymentMode,
      billId: bill._id,
    })

    // Update Study catalogue prices from bill items
    for (const item of body.items ?? []) {
      if (!item.study || !item.price) continue
      const cat = CATALOGUE_CATEGORY_MAP[item.study] ?? "Other"
      await Study.findOneAndUpdate(
        { name: item.study },
        {
          $set:        { price: item.price, lastBilledAt: new Date() },
          $setOnInsert: { name: item.study, category: cat, fromCatalogue: !!CATALOGUE_CATEGORY_MAP[item.study], firstSeenAt: new Date() },
        },
        { upsert: true }
      )
    }

    return NextResponse.json({ bill }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
