"use client"

import { useState, useEffect, useRef } from "react"
import { Search, FlaskConical, Info, Pencil, Check, X, Loader2, Tag, Plus, Trash2, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useRole } from "@/lib/role-context"
import { useConfirm } from "@/components/confirm-dialog"
import { motion } from "motion/react"
import { UNCATEGORISED_LABEL, canonicalCategory } from "@/lib/study-catalogue"
import { categoryColor, CategorySelect, useCategories } from "@/components/combo-input"

interface StudyDoc {
  _id: string
  name: string
  category: string
  price: number
}

interface Stats {
  total: number
  categories: number
  testsToday: number
  avgRevenue: number
}

export default function StudiesPage() {
  const { confirm } = useConfirm()
  const { user } = useRole()
  const isAdmin  = user?.role === "admin"
  // All staff (receptionist, doctor, admin) can add studies and fix categories
  const canEditCategory = true

  const [studies,    setStudies]    = useState<StudyDoc[]>([])
  const [stats,      setStats]      = useState<Stats | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState("")
  const [catFilter,  setCatFilter]  = useState("All Categories")
  const [categories, addCategory]   = useCategories()

  // Add-study dialog state
  const [addOpen,    setAddOpen]    = useState(false)
  const [newName,    setNewName]    = useState("")
  const [newCat,     setNewCat]     = useState<string>("")
  const [newPrice,   setNewPrice]   = useState("")
  const [addSaving,  setAddSaving]  = useState(false)
  const [addError,   setAddError]   = useState("")

  // Delete state (admin only)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Inline price edit state
  const [editingPriceId,  setEditingPriceId]  = useState<string | null>(null)
  const [editPrice,       setEditPrice]       = useState("")
  const [savingPriceId,   setSavingPriceId]   = useState<string | null>(null)
  const priceInputRef = useRef<HTMLInputElement>(null)

  // Inline category edit state
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editCat,      setEditCat]      = useState("")
  const [savingCatId,  setSavingCatId]  = useState<string | null>(null)
  const [catMoved,     setCatMoved]     = useState("")

  useEffect(() => {
    fetch("/api/studies")
      .then((r) => r.json())
      .then((data) => {
        setStudies(data.studies ?? [])
        setStats(data.stats ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (editingPriceId) setTimeout(() => priceInputRef.current?.select(), 40)
  }, [editingPriceId])

  // ── Price editing ─────────────────────────────────────────────────────────────
  const startEditPrice = (s: StudyDoc) => {
    setEditingCatId(null)
    setEditingPriceId(s._id)
    setEditPrice(String(s.price))
  }
  const cancelEditPrice = () => { setEditingPriceId(null); setEditPrice("") }

  const savePrice = async (s: StudyDoc) => {
    const newPrice = Number(editPrice)
    if (isNaN(newPrice) || newPrice < 0) return
    setSavingPriceId(s._id)
    try {
      const res = await fetch(`/api/studies/${s._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: newPrice }),
      })
      if (res.ok) {
        setStudies((prev) => prev.map((st) => st._id === s._id ? { ...st, price: newPrice } : st))
        setStats((prev) => {
          if (!prev) return prev
          const updated = studies.map((st) => st._id === s._id ? { ...st, price: newPrice } : st)
          const priced  = updated.filter((st) => st.price > 0)
          const avg = priced.length > 0 ? Math.round(priced.reduce((sum, st) => sum + st.price, 0) / priced.length) : 0
          return { ...prev, avgRevenue: avg }
        })
      }
    } finally {
      setSavingPriceId(null); setEditingPriceId(null); setEditPrice("")
    }
  }

  // ── Add / delete studies ───────────────────────────────────────────────────────
  const handleAddStudy = async () => {
    const name = newName.trim()
    if (!name) return
    setAddSaving(true)
    setAddError("")
    try {
      const res = await fetch("/api/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: newCat,
          price: Number(newPrice) || 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add study")
      setStudies((prev) => [...prev, data.study])
      setStats((prev) => prev ? { ...prev, total: prev.total + 1 } : prev)
      setAddOpen(false)
      setNewName(""); setNewCat(""); setNewPrice("")
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add study")
    } finally {
      setAddSaving(false)
    }
  }

  const handleDeleteStudy = async (s: StudyDoc) => {
    if (!(await confirm({
      title: "Remove study?",
      message: `"${s.name}" will be removed from the studies list.`,
      confirmLabel: "Remove",
      danger: true,
    }))) return
    setDeletingId(s._id)
    try {
      const res = await fetch(`/api/studies/${s._id}`, { method: "DELETE" })
      if (res.ok) {
        setStudies((prev) => prev.filter((st) => st._id !== s._id))
        setStats((prev) => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev)
      }
    } finally {
      setDeletingId(null)
    }
  }

  // ── Category editing ──────────────────────────────────────────────────────────
  const startEditCat = (s: StudyDoc) => {
    setEditingPriceId(null)
    setEditingCatId(s._id)
    setEditCat(s.category)
  }
  const cancelEditCat = () => { setEditingCatId(null); setEditCat("") }

  const saveCategory = async (s: StudyDoc) => {
    const category = canonicalCategory(editCat)
    if (!category || category === s.category) { cancelEditCat(); return }
    setSavingCatId(s._id)
    try {
      const res = await fetch(`/api/studies/${s._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setStudies((prev) => prev.map((st) => st._id === s._id ? { ...st, category } : st))
        setStats((prev) => prev ? { ...prev, categories: new Set(studies.map((st) => st._id === s._id ? category : st.category)).size } : prev)
        addCategory(category)
        // Re-filing is retrospective — say how much of the register moved with it.
        setCatMoved(data.movedRows > 0
          ? `${s.name} moved to ${category} — ${data.movedRows} register row${data.movedRows === 1 ? "" : "s"} re-filed.`
          : `${s.name} moved to ${category}.`)
      }
    } finally {
      setSavingCatId(null); setEditingCatId(null); setEditCat("")
    }
  }

  // A study nobody has filed yet groups under "Uncategorised" rather than
  // disappearing into a blank heading.
  const catOf = (s: StudyDoc) => canonicalCategory(s.category) || UNCATEGORISED_LABEL

  const filterCategories = ["All Categories", ...Array.from(new Set(studies.map(catOf))).sort()]

  const filtered = studies.filter((s) => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = catFilter === "All Categories" || catOf(s) === catFilter
    return matchSearch && matchCat
  })

  const grouped: Record<string, StudyDoc[]> = {}
  for (const s of filtered) {
    const cat = catOf(s)
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(s)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Studies &amp; Tests</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Studies added by the staff, filed under the categories the clinic has created.
            Re-filing one here also moves it in the monthly register.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
          <Plus className="h-4 w-4" />Add Study
        </Button>
      </div>

      {catMoved && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <p className="text-sm text-green-700">{catMoved}</p>
          <button onClick={() => setCatMoved("")} className="text-green-600 hover:text-green-800">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Add Study dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); setAddError("") } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Add Study</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Study Name <span className="text-red-500">*</span></Label>
              <Input
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleAddStudy() }}
                placeholder="e.g. X-Ray Chest PA"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category <span className="text-red-500">*</span></Label>
                <CategorySelect
                  value={newCat}
                  onChange={setNewCat}
                  categories={categories}
                  onCategoryAdded={addCategory}
                  placeholder="Select"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Price (₹)</Label>
                <Input
                  type="number" min={0}
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            {addError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{addError}</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={!newName.trim() || !newCat || addSaving} onClick={() => void handleAddStudy()} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
                {addSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add Study
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Tests",       value: loading ? null : String(stats?.total ?? studies.length) },
          { label: "Categories",        value: loading ? null : String(stats?.categories ?? 0) },
          { label: "Tests Today",       value: loading ? null : String(stats?.testsToday ?? 0) },
          { label: "Avg. Revenue/Test", value: loading ? null : `₹${(stats?.avgRevenue ?? 0).toLocaleString()}` },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.3 }}>
            <Card className="h-full">
              <CardContent className="p-4 h-full">
                {s.value === null ? <Skeleton className="h-8 w-16 mb-1" /> : <p className="text-2xl font-bold">{s.value}</p>}
                <p className="text-sm text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          The list starts empty — studies appear here only after staff add them (via the Add Study button
          or during patient registration). Only three categories exist: X-Ray, Sonography and Pathology.
        </span>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Test Catalogue</CardTitle>
              <CardDescription>
                {loading ? "Loading…" : `${filtered.length} test${filtered.length !== 1 ? "s" : ""}${catFilter !== "All Categories" ? ` in ${catFilter}` : ""}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search test name..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {filterCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 pb-2 pt-3">
              {[...Array(8)].map((_, i) => (
                <motion.div key={i} className="flex items-center gap-4 py-3 border-b border-border/40 last:border-0"
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.055, duration: 0.25, ease: "easeOut" }}>
                  <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-44" />
                    <div className="flex items-center gap-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-16 rounded-full" /></div>
                  </div>
                  <div className="text-right space-y-1 shrink-0"><Skeleton className="h-4 w-16" /><Skeleton className="h-3 w-12" /></div>
                </motion.div>
              ))}
            </div>
          ) : (
            <>
              {filtered.length === 0 && (
                <p className="text-center py-10 text-muted-foreground text-sm">
                  {studies.length === 0
                    ? "No studies added yet. Use the Add Study button to add X-Ray, Sonography or Pathology studies."
                    : "No tests match your search."}
                </p>
              )}
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <div className={`px-4 py-2 border-y border-border flex items-center gap-2 ${categoryColor(cat)} bg-opacity-50`}>
                    <p className="text-xs font-bold uppercase tracking-wide">{cat}</p>
                    <span className="text-[10px] font-medium opacity-70">{items.length} test{items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((s) => (
                      <div key={s._id} className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">

                        {/* Icon */}
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${categoryColor(s.category)} bg-opacity-20`}>
                          <FlaskConical className="h-4 w-4" />
                        </div>

                        {/* Name + category */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{s.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {/* Category — editable for admin/doctor */}
                            {editingCatId === s._id ? (
                              <div className="flex items-center gap-1">
                                <CategorySelect
                                  value={editCat}
                                  onChange={setEditCat}
                                  categories={categories}
                                  onCategoryAdded={addCategory}
                                  className="h-6 text-[11px] px-2 w-40"
                                />
                                <button
                                  onClick={() => saveCategory(s)}
                                  disabled={!!savingCatId}
                                  className="h-8 w-8 flex items-center justify-center rounded hover:bg-green-100 text-green-600"
                                >
                                  {savingCatId === s._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                </button>
                                <button onClick={cancelEditCat} className="h-8 w-8 flex items-center justify-center rounded hover:bg-red-100 text-red-500">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${categoryColor(s.category)}`}>
                                  {s.category || UNCATEGORISED_LABEL}
                                </span>
                                {canEditCategory && (
                                  <button
                                    onClick={() => startEditCat(s)}
                                    className="h-7 w-7 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-amber-100 text-amber-500 transition-all"
                                    title="Edit category"
                                  >
                                    <Tag className="h-2.5 w-2.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Price — editable for admin */}
                        <div className="text-right shrink-0 flex items-center gap-1">
                          {editingPriceId === s._id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-muted-foreground">₹</span>
                              <Input
                                ref={priceInputRef}
                                type="number" min={0}
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") savePrice(s); if (e.key === "Escape") cancelEditPrice() }}
                                className="h-7 w-24 text-sm text-right pr-2"
                              />
                              <button onClick={() => savePrice(s)} disabled={!!savingPriceId}
                                className="h-7 w-7 flex items-center justify-center rounded hover:bg-green-100 text-green-600">
                                {savingPriceId === s._id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                              <button onClick={cancelEditPrice} className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-100 text-red-500">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="text-right">
                                <p className="font-semibold text-sm">
                                  {s.price > 0 ? `₹${s.price.toLocaleString()}` : <span className="text-muted-foreground text-xs">—</span>}
                                </p>
                                <p className="text-xs text-muted-foreground">per test</p>
                              </div>
                              {isAdmin && (
                                <button onClick={() => startEditPrice(s)}
                                  className="h-7 w-7 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-blue-100 text-blue-500 transition-all ml-1"
                                  title="Edit price">
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                              {isAdmin && (
                                <button onClick={() => void handleDeleteStudy(s)}
                                  disabled={deletingId === s._id}
                                  className="h-7 w-7 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 text-red-500 transition-all"
                                  title="Delete study">
                                  {deletingId === s._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
