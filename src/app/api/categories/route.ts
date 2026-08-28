import { NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Study from "@/models/Study"
import Template from "@/models/Template"
import { mergeCategories } from "@/lib/study-catalogue"

// GET /api/categories — every category a study can be filed under: the five
// bundled ones plus every category the clinic has created, whether it created
// it on a template or on a study. One list so the registration form, the
// Studies page and the register's DEPARTMENT column all offer the same names.
export async function GET() {
  try {
    await connectDB()
    const [templateCats, studyCats] = await Promise.all([
      Template.distinct("category"),
      Study.distinct("category"),
    ])
    return NextResponse.json({ categories: mergeCategories(templateCats, studyCats) })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
