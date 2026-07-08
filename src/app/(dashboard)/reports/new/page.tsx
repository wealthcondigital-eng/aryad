"use client"

import { Suspense, useRef, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Download, CheckCircle2, Loader2,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, Share2, Pencil, LayoutTemplate, Minus, Plus, ChevronDown, ChevronUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ComboInput, StudyComboInput, getSavedDoctors, saveDoctor } from "@/components/combo-input"
import { useRole } from "@/lib/role-context"
import { motion, AnimatePresence } from "framer-motion"
import { REPORT_TEMPLATES, ReportTemplate, TemplateCategory } from "@/lib/report-templates"
import { reportHeaderHtml, reportTitleHtml, drawPdfReportHeader, drawPdfReportTitle } from "@/lib/report-layout"

const SAMPLE_PATIENTS = [
  "Ramesh Kumar (P-1046)", "Priya Sharma (P-1045)", "Arjun Patel (P-1044)",
  "Sunita Devi (P-1043)", "Vikram Singh (P-1042)", "Meena Rao (P-1041)",
]

// ── HTML ↔ DOCX formatting helpers ───────────────────────────────────────────

type Seg = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }

function parseHtml(html: string): Seg[] {
  const segs: Seg[] = []
  if (typeof window === "undefined") return [{ text: html }]
  const doc = new DOMParser().parseFromString(html, "text/html")
  function walk(node: Node, fmt: { bold: boolean; italic: boolean; underline: boolean }) {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ""
      if (t) segs.push({ text: t, ...fmt })
    } else if (node.nodeType === 1) {
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      const f = { ...fmt }
      if (tag === "b" || tag === "strong") f.bold = true
      if (tag === "i" || tag === "em")     f.italic = true
      if (tag === "u")                     f.underline = true
      el.childNodes.forEach((c) => walk(c, f))
      if (["div", "p", "br", "li"].includes(tag)) segs.push({ text: "\n" })
    }
  }
  doc.body.childNodes.forEach((n) => walk(n, { bold: false, italic: false, underline: false }))
  return segs
}

// ── Strip report-edited spans (keep inner content) ───────────────────────────
// Used before comparison so we always diff clean text, never double-wrap

function stripEditedSpans(html: string): string {
  if (typeof window === "undefined") return html
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("span.report-edited").forEach((span) => {
    const parent = span.parentNode
    if (!parent) return
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
  })
  return doc.body.innerHTML
}

// ── Compare original vs edited HTML and wrap changed blocks ──────────────────
// editorName / editedAt are embedded as data attributes so the CSS tooltip can show them on hover

function markChanges(originalHtml: string, newHtml: string, editorName?: string, editedAt?: string): string {
  if (!originalHtml || originalHtml === newHtml) return newHtml
  if (typeof window === "undefined") return newHtml

  // Strip old attribution spans from both sides before diffing
  const cleanOrig = stripEditedSpans(originalHtml)
  const cleanNew  = stripEditedSpans(newHtml)

  const parser  = new DOMParser()
  const origDoc = parser.parseFromString(cleanOrig, "text/html")
  const newDoc  = parser.parseFromString(cleanNew,  "text/html")

  const origTexts = new Set(
    Array.from(origDoc.body.childNodes).map((n) => (n.textContent ?? "").trim())
  )

  const attrs = editorName
    ? ` data-editor="${editorName}" data-edited-at="${editedAt ?? ""}"`
    : ""

  Array.from(newDoc.body.childNodes).forEach((node) => {
    const text = (node.textContent ?? "").trim()
    if (!text) return
    if (!origTexts.has(text)) {
      if (node.nodeType === 1) {
        const el = node as Element
        el.innerHTML = `<span class="report-edited"${attrs}>${el.innerHTML}</span>`
      } else if (node.nodeType === 3) {
        const span = newDoc.createElement("span")
        span.className = "report-edited"
        if (editorName) {
          span.setAttribute("data-editor", editorName)
          span.setAttribute("data-edited-at", editedAt ?? "")
        }
        span.textContent = node.textContent
        node.parentNode?.replaceChild(span, node)
      }
    }
  })

  return newDoc.body.innerHTML
}

// ── Build print/PDF HTML ──────────────────────────────────────────────────────

// The print output matches the clinic's printed report design: a
// double-bordered patient info box (NAME / REF. BY | DATE / AGE / SEX),
// then the bordered underlined study heading, body and signatures.
function buildPrintHtml(opts: {
  patient: string; study: string; body: string; age?: string; gender?: string; contact?: string; refBy?: string; date?: string; srNo?: string
}): string {
  const { patient, study, body, age, gender, refBy, date, srNo } = opts
  const displayDate = date || new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${patient}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; padding: 15mm 20mm; color: #111; }
.sigs { display: flex; gap: 30px; margin-top: 80px; }
.sig { flex: 1; }
.sig-name { font-weight: bold; font-size: 10pt; text-transform: uppercase; }
.sig-title { font-size: 8pt; color: #333; margin-top: 2px; text-transform: uppercase; }
@media print { body { padding: 8mm 12mm; } }
</style></head><body>
${reportHeaderHtml({ name: patient, refBy, date: displayDate, age, gender, srNo })}
${reportTitleHtml(study)}
<div class="body" style="font-size:10pt;line-height:1.6;">${body}</div>
<div class="sigs">
  <div class="sig">
    <div style="height: 55px;"></div>
    <p class="sig-name">DR. PRADNYA GORE</p>
    <p class="sig-title">Consultant Radiologist</p>
  </div>
  <div class="sig">
    <div style="height: 55px;"></div>
    <p class="sig-name">DR. RAMNATH GHUTE</p>
    <p class="sig-title">Consultant Radiologist</p>
    <p class="sig-title">M.D. Radiology</p>
  </div>
</div>
</body></html>`
}

const FONT_FAMILIES = [
  "Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Calibri",
  "Tahoma", "Trebuchet MS", "Garamond", "Bookman", "Palatino", "Impact"
]

// ── Formatting toolbar button ─────────────────────────────────────────────────

function FmtBtn({ cmd, label, title, value }: { cmd: string; label: React.ReactNode; title: string; value?: string }) {
  return (
    <button
      type="button" title={title}
      onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd, false, value) }}
      className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors"
    >
      {label}
    </button>
  )
}

function Sep() { return <span className="w-px h-4 bg-gray-300 mx-0.5" /> }

const getDisplayTitle = (studyName: string) => {
  if (!studyName) return ""
  for (const cat of Object.keys(REPORT_TEMPLATES)) {
    const list = REPORT_TEMPLATES[cat as keyof typeof REPORT_TEMPLATES]
    const found = list.find(t => t.name.toLowerCase() === studyName.toLowerCase())
    if (found) return found.heading
  }
  return studyName
}

// ── Main editor ───────────────────────────────────────────────────────────────

function ReportEditorInner() {
  const { user } = useRole()
  const sp = useSearchParams()

  const paramPatient = sp.get("patient") ?? ""
  const paramStudy   = sp.get("study")   ?? ""
  const paramRefBy   = sp.get("refBy")   ?? ""
  const paramDate    = sp.get("date")    ?? ""
  const paramAge     = sp.get("age")     ?? ""
  const paramGender  = sp.get("gender")  ?? ""
  const paramSrNo    = sp.get("srNo")    ?? ""
  const paramContact = sp.get("contact") ?? ""
  const paramId      = sp.get("id")     ?? ""   // MongoDB _id of the patient
  const paramSidx    = Math.max(0, parseInt(sp.get("sidx") ?? "0", 10) || 0)  // which study of the patient
  const paramLoad    = sp.get("load")  === "1"  // edit mode — loads + editable
  const paramView    = sp.get("view")  === "1"  // view mode — loads, read-only
  const isReadOnly   = paramView && !paramLoad

  const hasPatient = !!paramPatient

  // "No params" picker state
  const [selPatient,   setSelPatient]   = useState("")
  const [selStudy,     setSelStudy]     = useState("")
  const [selRefBy,     setSelRefBy]     = useState("")
  const [selDate,      setSelDate]      = useState(new Date().toISOString().split("T")[0])
  const [selAge,       setSelAge]       = useState("")
  const [selGender,    setSelGender]    = useState("")
  const [selContact,   setSelContact]   = useState("")
  const [savedDoctors, setSavedDoctors] = useState<string[]>(() => getSavedDoctors())
  const [pickerDone,   setPickerDone]   = useState(false)

  // For patient with no study yet (came from registration without study)
  const [extraStudy,  setExtraStudy]  = useState("")

  const [currentStudy, setCurrentStudy] = useState(() => paramStudy)

  useEffect(() => {
    if (paramStudy) {
      setCurrentStudy(paramStudy)
    }
  }, [paramStudy])

  // Resolved values
  const patient = hasPatient ? paramPatient : selPatient
  const study   = currentStudy || (hasPatient ? extraStudy : selStudy)
  const refBy   = hasPatient ? paramRefBy   : selRefBy
  const date    = hasPatient ? paramDate    : selDate
  const age     = hasPatient ? paramAge     : selAge
  const gender  = hasPatient ? paramGender  : selGender
  const contact = hasPatient ? paramContact : selContact
  const srNo    = paramSrNo

  const [localSrNo,   setLocalSrNo]   = useState(paramSrNo)
  const [editingSrNo, setEditingSrNo] = useState(false)

  // Template picker
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateTab,   setTemplateTab]   = useState<TemplateCategory>(() => {
    const s = (paramStudy || "").toLowerCase()
    if (s.includes("x") && (s.includes("ray") || s.includes("-ray"))) return "xray"
    if (["cbc","lft","kft","blood","thyroid","path","urine","hb"].some((k) => s.includes(k))) return "pathology"
    if (/doppler|carotid|venous|arterial|portal|renal artery/.test(s)) return "doppler"
    return "usg"
  })

  // Toolbar extras
  const [fontSize,   setFontSize]   = useState(14)
  const [fontFamily, setFontFamily] = useState("Arial")

  const showDoc   = hasPatient || pickerDone
  const needStudy = showDoc && !study

  const bodyRef         = useRef<HTMLDivElement | null>(null)
  const titleRef        = useRef<HTMLDivElement | null>(null)
  const originalBodyRef = useRef<string>("")
  const submittedRef    = useRef(false)

  const paperRef        = useRef<HTMLDivElement | null>(null)
  const [numPages, setNumPages] = useState(1)

  useEffect(() => {
    const el = paperRef.current
    if (!el) return
    const checkHeight = () => {
      const h = el.scrollHeight
      const pages = Math.ceil(h / 1122)
      setNumPages(pages)
    }
    const observer = new ResizeObserver(checkHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showDoc])

  // Current heading text (falls back to the study name)
  const getDocTitle = () => (titleRef.current?.innerText ?? "").trim() || getDisplayTitle(study).toUpperCase()
  const [docxLoading,        setDocxLoading]        = useState(false)
  const [submitting,         setSubmitting]          = useState(false)
  const [submitted,          setSubmitted]           = useState(false)
  const [submittedDocxBase64, setSubmittedDocxBase64] = useState("")
  const [shareLoading,       setShareLoading]        = useState(false)

  // Storage key for this patient's report (per study — a patient can have several)
  const storageKey = `aarya_report_${srNo || patient.replace(/\s+/g, "_")}${paramSidx > 0 ? `_s${paramSidx}` : ""}`

  // ── Set in_progress when the form is opened (not view/edit mode) ─────────
  useEffect(() => {
    if (paramId && !paramView && !paramLoad) {
      fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportStatus: "in_progress", studyIndex: paramSidx }),
      }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramId])

  // ── Auto-save draft to localStorage on unmount (navigate away) ───────────────
  useEffect(() => {
    return () => {
      if (!submittedRef.current && bodyRef.current?.innerHTML) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            body: bodyRef.current.innerHTML,
            docTitle: titleRef.current?.innerText?.trim() || undefined,
            patient, study, date, age, gender, contact, srNo, refBy,
            savedAt: new Date().toISOString(),
          }))
        } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy])

  // ── Load report body: localStorage draft first, then the submitted body from DB ──
  useEffect(() => {
    if (!showDoc) return

    const setBody = (html: string, title?: string) => {
      if (bodyRef.current) {
        bodyRef.current.innerHTML = html
        if (paramLoad || paramView) originalBodyRef.current = html
      }
      if (title && titleRef.current) titleRef.current.innerText = title
    }

    let draft: { body?: string; docTitle?: string; study?: string } | null = null
    try { draft = JSON.parse(localStorage.getItem(storageKey) || "null") } catch {}

    if (draft?.body) {
      const d = draft
      setTimeout(() => {
        setBody(d.body!, d.docTitle)
        if (d.study) setCurrentStudy(d.study)
      }, 80)
      return
    }

    // View / edit mode without a local draft — pull the submitted body for this study
    if (paramId && (paramView || paramLoad)) {
      fetch(`/api/patients/${paramId}`)
        .then((r) => r.json())
        .then((d) => {
          const p = d.patient
          if (!p) return
          const entry = p.studies?.[paramSidx]
          const html: string = entry?.reportBody || p.reportBody || ""
          if (html) setTimeout(() => setBody(html), 80)
          if (entry?.name) setCurrentStudy(entry.name)
        })
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDoc])

  // ── Seed the editable heading with the study name (drafts/templates override it) ──
  useEffect(() => {
    if (!showDoc || !study) return
    if (titleRef.current && !titleRef.current.innerText.trim()) {
      titleRef.current.innerText = getDisplayTitle(study).toUpperCase()
    }
  }, [showDoc, study])

  // ── Save draft on browser close / hard refresh (belt-and-suspenders) ─────────
  useEffect(() => {
    const save = () => {
      if (submittedRef.current) return
      const html = bodyRef.current?.innerHTML
      if (!html || html === "<br>") return
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          body: html,
          docTitle: titleRef.current?.innerText?.trim() || undefined,
          patient, study, date, age, gender, contact, srNo, refBy,
          savedAt: new Date().toISOString(),
        }))
      } catch {}
    }
    window.addEventListener("beforeunload", save)
    return () => window.removeEventListener("beforeunload", save)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy])

  // ── Build DOCX blob from current report body ─────────────────────────────────
  const buildDocxBase64 = async (bodyHtml: string): Promise<string> => {
    const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } = await import("docx")

    const makeParas = (html: string, size = 20) => {
      const segs = parseHtml(html)
      const paras: InstanceType<typeof Paragraph>[] = []
      let line: InstanceType<typeof TextRun>[] = []
      const flush = () => {
        paras.push(new Paragraph({
          children: line.length ? line : [new TextRun({ text: "", size })],
          spacing: { after: 80 },
        }))
        line = []
      }
      segs.forEach((s) => {
        if (s.text === "\n") { flush() }
        else { line.push(new TextRun({ text: s.text, bold: s.bold, italics: s.italic, underline: s.underline ? {} : undefined, size })) }
      })
      if (line.length) flush()
      return paras.length ? paras : [new Paragraph({ children: [new TextRun({ text: "", size })] })]
    }

    const { Table, TableRow, TableCell, WidthType } = await import("docx")

    const noBorder     = { style: BorderStyle.NONE,   size: 0, color: "ffffff" }
    const doubleBorder = { style: BorderStyle.DOUBLE, size: 4, color: "333333" }
    const boldLine = (text: string, spaceAfter = 0) =>
      new Paragraph({ children: [new TextRun({ text, bold: true, size: 22 })], spacing: { after: spaceAfter } })

    // The Word file matches the clinic's printed design: a double-bordered
    // patient info box (NAME / REF. BY | DATE / AGE / SEX), then the
    // bordered underlined (editable) study heading, body and signatures.
    const children = [
      // ── Patient info box ──
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: doubleBorder, bottom: doubleBorder, left: doubleBorder, right: doubleBorder,
          insideHorizontal: noBorder, insideVertical: noBorder,
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 62, type: WidthType.PERCENTAGE },
                margins: { top: 160, bottom: 160, left: 200, right: 200 },
                children: [
                  boldLine(`NAME - ${patient.toUpperCase()}`, 60),
                  boldLine(`REF. BY - ${(refBy || "SELF").toUpperCase()}`, 60),
                  ...(localSrNo || srNo ? [boldLine(`SR. NO - #${localSrNo || srNo}`)] : []),
                ],
              }),
              new TableCell({
                width: { size: 38, type: WidthType.PERCENTAGE },
                margins: { top: 160, bottom: 160, left: 200, right: 200 },
                children: [
                  boldLine(`DATE - ${date || ""}`, 60),
                  boldLine(`AGE - ${age ? `${age} YRS` : "—"}`, 60),
                  boldLine(`SEX - ${(gender || "—").toUpperCase()}`),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 120, after: 120 } }),
      // ── Study heading (editable in the editor) — centered bordered box ──
      new Table({
        alignment: AlignmentType.CENTER,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
          left: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
          right: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
          insideHorizontal: noBorder, insideVertical: noBorder,
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                margins: { top: 80, bottom: 80, left: 500, right: 500 },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: getDocTitle().toUpperCase(), bold: true, size: 26, underline: {} })],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 120, after: 120 } }),
      // ── Report body ──
      ...makeParas(bodyHtml),
      // ── Spacer before signatures ──
      new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 1000 } }),
      // ── Two-doctor signature block (as in the clinic's Word formats) ──
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
          bottom: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
          left: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
          right: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ children: [new TextRun({ text: "DR. PRADNYA GORE", bold: true, size: 20 })], spacing: { after: 40 } }),
                  new Paragraph({ children: [new TextRun({ text: "CONSULTANT RADIOLOGIST", size: 16 })] }),
                ],
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({ children: [new TextRun({ text: "DR. RAMNATH GHUTE", bold: true, size: 20 })], spacing: { after: 40 } }),
                  new Paragraph({ children: [new TextRun({ text: "CONSULTANT RADIOLOGIST", size: 16 })] }),
                  new Paragraph({ children: [new TextRun({ text: "M.D. RADIOLOGY", size: 16 })] }),
                ],
              }),
            ],
          }),
        ],
      }),
    ]

    return await Packer.toBase64String(new Document({
      sections: [{
        properties: { page: { margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } },
        children,
      }],
    }))
  }

  // ── Submit: mark edits, save to localStorage + MongoDB ──────────────────────
  const handleSubmit = async () => {
    if (!showDoc || !study || !patient) return
    setSubmitting(true)

    const editorName = user?.name || "Doctor"
    const now = new Date()
    const editedAtDisplay = now.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })

    // When editing a submitted report, stamp attribution on changed sections
    if (paramLoad && originalBodyRef.current && bodyRef.current) {
      const marked = markChanges(originalBodyRef.current, bodyRef.current.innerHTML, editorName, editedAtDisplay)
      bodyRef.current.innerHTML = marked
    }

    // Final body HTML (with attribution spans if edit mode)
    const finalBody = bodyRef.current?.innerHTML ?? ""

    // Save to localStorage
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        body: finalBody,
        docTitle: titleRef.current?.innerText?.trim() || undefined,
        patient, study, date, age, gender, contact, srNo, refBy,
        savedAt: now.toISOString(),
      }))
    } catch {}

    // Generate DOCX and save everything to MongoDB
    if (paramId) {
      try {
        const cleanBody = stripEditedSpans(finalBody)

        // Generate DOCX from the clean body and stash it for the success screen
        let reportDocx = ""
        try {
          reportDocx = await buildDocxBase64(cleanBody)
          setSubmittedDocxBase64(reportDocx)
        } catch {}

        await fetch(`/api/patients/${paramId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studyIndex:   paramSidx,
            reportStatus: "completed",
            reportBody:   cleanBody,
            reportDocx,
            studyName:    study,
            ...(localSrNo ? { srNo: Number(localSrNo) } : {}),
            editHistoryEntry: {
              editor:   editorName,
              editedAt: now.toISOString(),
              body:     cleanBody,
            },
          }),
        })
      } catch {}
    }

    submittedRef.current = true
    setSubmitting(false)
    setSubmitted(true)
  }

  // ── Template apply ───────────────────────────────────────────────────────────
  const applyTemplate = (tpl: ReportTemplate) => {
    if (!bodyRef.current) return
    const hasContent = bodyRef.current.innerHTML.trim() !== "" && bodyRef.current.innerHTML !== "<br>"
    if (hasContent && !confirm(`Replace current report content with "${tpl.name}"?`)) return
    bodyRef.current.innerHTML = tpl.body
    // Update local study state
    setCurrentStudy(tpl.name)
    // Template always drives the heading (falls back to the study name)
    if (titleRef.current) titleRef.current.textContent = tpl.heading || tpl.name.toUpperCase()
    // Persist immediately so a stale draft can't bring the old heading back
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        body: tpl.body,
        docTitle: tpl.heading || tpl.name.toUpperCase(),
        patient, study: tpl.name, date, age, gender, contact, srNo, refBy,
        savedAt: new Date().toISOString(),
      }))
    } catch {}
    setShowTemplates(false)
    bodyRef.current.focus()
  }

  // ── Font size change (applies to selection or sets cursor default) ────────────
  const changeFontSize = (delta: number) => {
    const newSize = Math.max(8, Math.min(72, fontSize + delta))
    setFontSize(newSize)
    bodyRef.current?.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const span  = document.createElement("span")
    span.style.fontSize = `${newSize}px`
    try {
      range.surroundContents(span)
    } catch {
      const frag = range.extractContents()
      span.appendChild(frag)
      range.insertNode(span)
    }
  }

  // ── Font family apply ─────────────────────────────────────────────────────────
  const applyFontFamily = (family: string) => {
    setFontFamily(family)
    bodyRef.current?.focus()
    document.execCommand("fontName", false, family)
  }

  // ── Persist SR. NO change to backend immediately on blur/enter ──────────────
  const handleSrNoSave = async (value: string) => {
    if (!paramId || !value || value === paramSrNo) return
    try {
      await fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ srNo: Number(value) }),
      })
    } catch {}
  }

  // ── Save draft to localStorage ───────────────────────────────────────────────
  const saveReport = () => {
    let bodyHtml = bodyRef.current?.innerHTML ?? ""
    // If editing an existing report, mark changed blocks with underline
    if (paramLoad && originalBodyRef.current) {
      bodyHtml = markChanges(originalBodyRef.current, bodyHtml)
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        body: bodyHtml,
        docTitle: titleRef.current?.innerText?.trim() || undefined,
        patient, study, date, age, gender, contact, srNo, refBy,
        savedAt: new Date().toISOString(),
      }))
    } catch {}
  }

  // ── Print / PDF ──────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const html = buildPrintHtml({
      patient,
      study: getDocTitle(),
      body: bodyRef.current?.innerHTML ?? "",
      age,
      gender,
      contact,
      refBy,
      date,
      srNo: localSrNo || srNo,
    })
    const win = window.open("", "_blank", "width=820,height=1000")
    if (!win) { alert("Please allow pop-ups."); return }
    win.document.write(html)
    win.document.close()
    win.focus()
    win.onafterprint = () => win.close()
    setTimeout(() => win.print(), 500)
  }

  // ── Build a PDF Blob from the clean report HTML ──────────────────────────────
  const buildPdfBlob = async (bodyHtml: string): Promise<Blob> => {
    const { jsPDF } = await import("jspdf")
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
    const W = 210, M = 20, CW = W - M * 2
    let y = 18

    const ln = (pt: number) => pt * 0.352778 * 1.4   // pt → mm with 1.4× leading
    const checkPage = (need = 8) => { if (y + need > 282) { doc.addPage(); y = 18 } }

    // The PDF matches the printed report design: double-bordered patient
    // info box, then the bordered underlined study heading
    y = drawPdfReportHeader(doc, { name: patient, refBy, date, age, gender, srNo: localSrNo || srNo })
    y = drawPdfReportTitle(doc, getDocTitle(), y)

    // ── Report body (HTML-aware, preserves bold labels) ──
    const { renderHtmlToPdf } = await import("@/lib/pdf-html-renderer")
    y = renderHtmlToPdf(doc, bodyHtml, M, CW, y, checkPage, 5.5)

    // ── Two-doctor signature block, matching the Word format ──
    checkPage(28); y += 22
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0)
    doc.text("DR. PRADNYA GORE", M, y)
    doc.text("DR. RAMNATH GHUTE", W / 2 + 5, y); y += ln(9)
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(60)
    doc.text("CONSULTANT RADIOLOGIST", M, y)
    doc.text("CONSULTANT RADIOLOGIST", W / 2 + 5, y); y += ln(7.5)
    doc.text("M.D. RADIOLOGY", W / 2 + 5, y)

    return doc.output("blob")
  }

  // ── Share on WhatsApp: upload PDF → share download link ─────────────────────
  const handleShare = async (to: "patient" | "doctor") => {
    if (!paramId) return
    setShareLoading(true)

    const cleanHtml = stripEditedSpans(bodyRef.current?.innerHTML ?? "")
    const num       = to === "patient" ? contact.replace(/\D/g, "") : ""

    try {
      const pdfBlob  = await buildPdfBlob(cleanHtml)
      const arrayBuf = await pdfBlob.arrayBuffer()
      const bytes    = new Uint8Array(arrayBuf)
      let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
      const base64   = btoa(binary)

      const res  = await fetch(`/api/patients/${paramId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reportPdf: base64, studyIndex: paramSidx }),
      })
      const data   = await res.json()
      const slug   = data?.patient?.studies?.[paramSidx]?.reportSlug || data?.patient?.reportSlug
      const pdfUrl = slug
        ? `${window.location.origin}/${slug}/pdf`
        : `${window.location.origin}/api/patients/${paramId}/pdf?sidx=${paramSidx}`

      const msg = to === "patient"
        ? `Dear ${patient},\n\nYour *${study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
        : `*Aarya Diagnostics Center*\nReport: *${patient}* — *${study}*\nDate: ${date}\n\n📄 Download PDF:\n${pdfUrl}`

      // Mobile Direct Share
      if (navigator.share && navigator.canShare) {
        const file = new File([pdfBlob], `Report_${patient.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Report - ${patient}`,
            text: to === "patient"
              ? `Dear ${patient}, your ${study} report from Aarya Diagnostics Center is ready.`
              : `Aarya Diagnostics Center: Report ${patient} — ${study}`,
          })
          setShareLoading(false)
          return
        }
      }

      const waUrl = num
        ? `https://wa.me/91${num}?text=${encodeURIComponent(msg)}`
        : `https://wa.me/?text=${encodeURIComponent(msg)}`

      setShareLoading(false)
      window.open(waUrl, "_blank")
      return
    } catch {}

    setShareLoading(false)
  }

  // ── Decode base64 and trigger browser download ──────────────────────────────
  const downloadDocxFromBase64 = (base64: string, filename: string) => {
    const binary = atob(base64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  // ── Save as DOCX (download) — only used while editor is open ─────────────────
  const handleSave = async () => {
    setDocxLoading(true)
    try {
      const base64 = await buildDocxBase64(bodyRef.current?.innerHTML ?? "")
      downloadDocxFromBase64(base64, `Report_${(patient || "Patient").replace(/\s+/g, "_")}${study ? `_${study.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.docx`)
    } finally { setDocxLoading(false) }
  }

  // ── Submit success screen ─────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center space-y-4">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold">Report Submitted</h2>
          <p className="text-muted-foreground text-sm">
            The report for <strong>{patient}</strong> has been submitted. The receptionist can now print and share it.
          </p>
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            <Button
              variant="outline"
              disabled={docxLoading || !submittedDocxBase64}
              onClick={() => {
                if (submittedDocxBase64) {
                  downloadDocxFromBase64(
                    submittedDocxBase64,
                    `Report_${(patient || "Patient").replace(/\s+/g, "_")}${study ? `_${study.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.docx`
                  )
                }
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download DOCX
            </Button>
            <Button onClick={() => handleShare("patient")} disabled={shareLoading} className="bg-green-600 hover:bg-green-700">
              {shareLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Share2 className="h-4 w-4 mr-2" />}
              {shareLoading ? "Preparing..." : "WhatsApp Patient"}
            </Button>
            <Button asChild><Link href="/reports">Back to Reports</Link></Button>
          </div>
        </div>
    )
  }

  // ── Document editor ───────────────────────────────────────────────────────────
  return (
    <div className="-mx-4 lg:-mx-6 -mt-4 lg:-mt-6 flex flex-col">

      {/* ── Sticky header: title bar + formatting toolbar ── */}
      <div className="sticky -top-4 lg:-top-6 z-20 bg-white border-b shadow-sm">

        {/* Title / action row */}
        <div className="flex items-center gap-3 px-4 lg:px-6 py-2.5 border-b border-gray-100">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/reports"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {patient ? `Fill Report – ${patient}` : "Fill Report"}
            </p>
            {study && <p className="text-xs text-muted-foreground truncate">{study}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isReadOnly && showDoc && (
              <motion.button
                type="button"
                onClick={() => setShowTemplates((v) => !v)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shadow-sm ${
                  showTemplates
                    ? "bg-blue-600 text-white border-blue-600 shadow-blue-200"
                    : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                Templates
                <motion.span animate={{ rotate: showTemplates ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="h-3 w-3" />
                </motion.span>
              </motion.button>
            )}
            {!isReadOnly && (
              <Button size="sm" onClick={handleSubmit} disabled={!showDoc || !study || !patient || submitting} className="bg-green-600 hover:bg-green-700 gap-1.5">
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {submitting ? "Saving..." : "Submit"}
              </Button>
            )}
          </div>
        </div>

        {/* Formatting toolbar — hidden in view mode */}
        {!isReadOnly && (
          <div className="flex items-center gap-0.5 px-4 lg:px-6 py-1.5 overflow-x-auto">
            {/* Font family */}
            <select
              value={fontFamily}
              onChange={(e) => applyFontFamily(e.target.value)}
              className="h-7 text-[11px] border border-gray-200 rounded px-1.5 mr-1 bg-white text-gray-700 cursor-pointer focus:outline-none focus:border-blue-400"
              title="Font family"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>

            {/* Font size */}
            <div className="flex items-center border border-gray-200 rounded overflow-hidden mr-1 bg-white">
              <button
                type="button" title="Decrease font size"
                onMouseDown={(e) => { e.preventDefault(); changeFontSize(-2) }}
                className="h-7 px-2 flex items-center justify-center hover:bg-gray-100 text-gray-600 gap-0.5 border-r border-gray-200"
              >
                <span className="text-[10px] font-bold">A</span>
                <ChevronDown className="h-2.5 w-2.5 text-blue-500" />
              </button>
              <span className="w-8 text-center text-[11px] font-medium text-gray-700 select-none">
                {fontSize}
              </span>
              <button
                type="button" title="Increase font size"
                onMouseDown={(e) => { e.preventDefault(); changeFontSize(2) }}
                className="h-7 px-2 flex items-center justify-center hover:bg-gray-100 text-gray-600 gap-0.5 border-l border-gray-200"
              >
                <span className="text-xs font-bold text-gray-700">A</span>
                <ChevronUp className="h-2.5 w-2.5 text-blue-500" />
              </button>
            </div>

            <Sep />
            <FmtBtn cmd="bold"      label={<Bold      className="h-3.5 w-3.5 stroke-[2.5]" />} title="Bold (Ctrl+B)" />
            <FmtBtn cmd="italic"    label={<Italic    className="h-3.5 w-3.5" />}              title="Italic (Ctrl+I)" />
            <FmtBtn cmd="underline" label={<Underline className="h-3.5 w-3.5" />}              title="Underline (Ctrl+U)" />
            <Sep />
            <FmtBtn cmd="justifyLeft"   label={<AlignLeft   className="h-3.5 w-3.5" />} title="Align left" />
            <FmtBtn cmd="justifyCenter" label={<AlignCenter className="h-3.5 w-3.5" />} title="Center" />
            <FmtBtn cmd="justifyRight"  label={<AlignRight  className="h-3.5 w-3.5" />} title="Align right" />
            <Sep />
            <FmtBtn cmd="insertUnorderedList" label={<List className="h-3.5 w-3.5" />}                    title="Bullet list" />
            <FmtBtn cmd="insertOrderedList"   label={<span className="text-[11px] font-semibold">1.</span>} title="Numbered list" />
            <Sep />
            <FmtBtn cmd="removeFormat" label={<span className="text-[11px] text-gray-400 font-medium">Clear</span>} title="Clear formatting" />
          </div>
        )}
      </div>

      {/* ── Document area ── */}
      <div className="bg-slate-200 py-8 px-4 flex-1 min-h-screen">

        {/* ── Template picker panel ── */}
        <AnimatePresence>
          {showTemplates && (
            <motion.div
              key="template-panel"
              initial={{ opacity: 0, y: -16, scaleY: 0.95 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              exit={{ opacity: 0, y: -12, scaleY: 0.96 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              style={{ transformOrigin: "top" }}
              className="max-w-[794px] mx-auto mb-5 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden"
            >
              {/* Category tabs */}
              <div className="flex items-center border-b border-gray-100 px-5 pt-0 bg-gray-50/60">
                {(["usg", "doppler", "xray", "pathology"] as TemplateCategory[]).map((cat) => {
                  const labels: Record<TemplateCategory, string> = {
                    usg: "USG / Sonography",
                    doppler: "Doppler",
                    xray: "X-Ray",
                    pathology: "Pathology",
                  }
                  const active = templateTab === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTemplateTab(cat)}
                      className={`relative px-5 py-3.5 text-xs font-semibold transition-colors ${
                        active ? "text-blue-600" : "text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      {labels[cat]}
                      {active && (
                        <motion.div
                          layoutId="tab-underline"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                    </button>
                  )
                })}
                <div className="ml-auto flex items-center gap-2 pr-1">
                  <span className="text-[11px] text-gray-400">
                    {REPORT_TEMPLATES[templateTab].length} template{REPORT_TEMPLATES[templateTab].length !== 1 ? "s" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowTemplates(false)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors text-base font-light"
                    title="Close"
                  >×</button>
                </div>
              </div>

              {/* Template cards — horizontal PowerPoint-style scroll */}
              <div className="px-5 py-5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={templateTab}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="flex gap-4 pb-1"
                    style={{ width: "max-content" }}
                  >
                    {REPORT_TEMPLATES[templateTab].map((tpl, i) => (
                      <motion.button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.05, ease: "easeOut" }}
                        whileHover={{ y: -4, boxShadow: "0 12px 28px rgba(59,130,246,0.18)" }}
                        whileTap={{ scale: 0.97 }}
                        className="group w-56 shrink-0 rounded-xl border-2 border-gray-200 hover:border-blue-400 bg-white overflow-hidden text-left cursor-pointer"
                        style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}
                      >
                        {/* Mini document preview */}
                        <div className="h-36 bg-gradient-to-b from-gray-50 to-white p-3 overflow-hidden border-b border-gray-100 relative">
                          {/* Paper header */}
                          <div className="flex flex-col items-center gap-0.5 mb-2 pb-1.5 border-b border-gray-200">
                            <div className="h-2 w-2 rounded-full bg-gray-300 mb-0.5" />
                            <div className="h-1 w-16 bg-gray-700 rounded-sm" />
                            <div className="h-px w-10 bg-gray-300 rounded" />
                            <div className="h-px w-12 bg-gray-300 rounded" />
                          </div>
                          {/* Content lines simulating field labels + values */}
                          <div className="space-y-1">
                            {[
                              { w: "55%",  dark: true  },
                              { w: "85%",  dark: false },
                              { w: "50%",  dark: true  },
                              { w: "90%",  dark: false },
                              { w: "45%",  dark: true  },
                              { w: "80%",  dark: false },
                              { w: "70%",  dark: false },
                              { w: "35%",  dark: true  },
                              { w: "65%",  dark: false },
                            ].map((line, li) => (
                              <div
                                key={li}
                                className={`h-px rounded-full ${line.dark ? "bg-gray-600" : "bg-gray-200"}`}
                                style={{ width: line.w }}
                              />
                            ))}
                          </div>
                          {/* Blue hover overlay */}
                          <div className="absolute inset-0 bg-blue-500/0 group-hover:bg-blue-500/5 transition-colors" />
                        </div>

                        {/* Template name footer */}
                        <div className="px-3 py-2.5 bg-white">
                          <p className="text-xs font-semibold text-gray-800 group-hover:text-blue-600 leading-snug transition-colors">
                            {tpl.name}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5 group-hover:text-blue-400 transition-colors">
                            Click to apply
                          </p>
                        </div>
                      </motion.button>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={paperRef} className="relative max-w-[794px] mx-auto bg-white shadow-xl rounded-sm px-4 sm:px-14 py-6 sm:py-12 min-h-[1122px]">

          {/* Patient picker — no URL params */}
          {!hasPatient && !pickerDone && (
            <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-semibold text-blue-900 mb-3">Select patient and study to begin</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Patient</Label>
                  <ComboInput value={selPatient} onChange={setSelPatient} suggestions={SAMPLE_PATIENTS} placeholder="Search patient..." />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Study / Test</Label>
                  <StudyComboInput value={selStudy} onChange={setSelStudy} onSelect={setSelStudy} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Age</Label>
                  <Input type="number" value={selAge} onChange={(e) => setSelAge(e.target.value)} placeholder="e.g. 45" className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sex</Label>
                  <Select value={selGender} onValueChange={setSelGender}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Mobile No.</Label>
                  <Input type="tel" value={selContact} onChange={(e) => setSelContact(e.target.value)} placeholder="10-digit mobile" className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Referred By</Label>
                  <ComboInput value={selRefBy} onChange={setSelRefBy} suggestions={savedDoctors} placeholder="Referring doctor (optional)" onSelect={setSelRefBy} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={selDate} onChange={(e) => setSelDate(e.target.value)} className="h-9" />
                </div>
              </div>
              <Button
                className="mt-3 bg-blue-600 hover:bg-blue-700" size="sm"
                disabled={!selPatient || !selStudy}
                onClick={() => { setSavedDoctors((prev) => saveDoctor(selRefBy, prev)); setPickerDone(true) }}
              >
                Start Report
              </Button>
            </div>
          )}

          {/* Study picker — patient from registration but no study yet */}
          {hasPatient && needStudy && (
            <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-semibold text-amber-900 mb-2">Select the study / test for this patient</p>
              <div className="max-w-xs">
                <StudyComboInput value={extraStudy} onChange={setExtraStudy} onSelect={setExtraStudy} />
              </div>
            </div>
          )}

          {/* ── Document body ── */}
          {showDoc && study && (
            <>
              {/* Dynamic Page Break Markers (editor only) */}
              {!isReadOnly && Array.from({ length: numPages - 1 }).map((_, i) => (
                <div
                  key={i}
                  style={{ top: `${(i + 1) * 1122}px` }}
                  className="absolute left-0 right-0 border-t border-dashed border-blue-400 pointer-events-none flex justify-center items-center select-none print:hidden z-10"
                >
                  <span className="bg-blue-50 text-blue-600 font-bold text-[9px] px-2 py-0.5 rounded border border-blue-200 uppercase tracking-wider -translate-y-1/2">
                    A4 Page Break (Page {i + 2})
                  </span>
                </div>
              ))}
              {/* Patient info — NON-EDITABLE (except SR. NO), matches the printed report header */}
              <div className="select-none mb-5 border-4 border-double border-gray-700 px-3.5 sm:px-5 py-2.5 sm:py-3.5 flex flex-col sm:flex-row justify-between gap-3 sm:gap-6 text-[13px] font-bold text-gray-900">
                <div className="space-y-1 min-w-0">
                  <p className="truncate">NAME - {patient.toUpperCase()}</p>
                  <p className="truncate">REF. BY - {(refBy || "SELF").toUpperCase()}</p>
                  {/* SR. NO — inside the box like the Word file, editable by doctor */}
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0">SR. NO -</span>
                    {!isReadOnly && editingSrNo ? (
                      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <span>#</span>
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          value={localSrNo}
                          onChange={(e) => setLocalSrNo(e.target.value.replace(/\D/g, ""))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { setEditingSrNo(false); void handleSrNoSave(localSrNo) }
                            if (e.key === "Escape") { setLocalSrNo(paramSrNo); setEditingSrNo(false) }
                          }}
                          onBlur={() => { setEditingSrNo(false); void handleSrNoSave(localSrNo) }}
                          className="w-20 border-0 border-b border-blue-400 text-[13px] font-bold text-gray-900 bg-transparent focus:outline-none px-0 py-px"
                          placeholder="e.g. 1001"
                        />
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span>
                          {localSrNo ? `#${localSrNo}` : <span className="text-gray-400 italic font-normal">not set</span>}
                        </span>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => setEditingSrNo(true)}
                            className="flex items-center gap-0.5 text-blue-500 hover:text-blue-700 transition-colors"
                            title={localSrNo ? "Edit SR. No" : "Add SR. No"}
                          >
                            <Pencil className="h-2.5 w-2.5" />
                            <span className="text-[10px] underline underline-offset-2">
                              {localSrNo ? "edit" : "add"}
                            </span>
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1 shrink-0 text-left">
                  <p>DATE - {date}</p>
                  <p>AGE - {age ? `${age} YRS` : "—"}</p>
                  <p>SEX - {(gender || "—").toUpperCase()}</p>
                </div>
              </div>

              {/* Study heading — editable, boxed like the printed report */}
              <div className="flex justify-center mb-6">
                <div
                  ref={titleRef}
                  contentEditable={!isReadOnly}
                  suppressContentEditableWarning
                  spellCheck={false}
                  title={isReadOnly ? undefined : "Click to edit the study heading"}
                  className={`text-center font-bold uppercase text-base py-1.5 px-10 min-w-[280px] border-[1.5px] border-gray-700 underline underline-offset-4 tracking-wide text-gray-900 focus:outline-none${
                    isReadOnly ? "" : " hover:bg-blue-50/60 focus:bg-blue-50/60 transition-colors cursor-text"
                  }`}
                />
              </div>

              {/* Report body — editable or read-only depending on mode */}
              <div
                ref={bodyRef}
                contentEditable={!isReadOnly}
                suppressContentEditableWarning
                data-placeholder="Start typing the report here..."
                className={`doc-field min-h-[400px] text-sm leading-relaxed text-gray-900 focus:outline-none${isReadOnly ? " cursor-default select-text" : ""}`}
              />

              {/* Two-doctor signature block — NON-EDITABLE, matches print / Word */}
              <div className="mt-24 grid grid-cols-2 gap-8 select-none text-gray-900">
                <div>
                  <div className="h-12" /> {/* Visual spacing for signing */}
                  <p className="font-bold text-[13px] uppercase">DR. PRADNYA GORE</p>
                  <p className="text-[10px] uppercase text-gray-600 mt-0.5">Consultant Radiologist</p>
                </div>
                <div>
                  <div className="h-12" /> {/* Visual spacing for signing */}
                  <p className="font-bold text-[13px] uppercase">DR. RAMNATH GHUTE</p>
                  <p className="text-[10px] uppercase text-gray-600 mt-0.5">Consultant Radiologist</p>
                  <p className="text-[10px] uppercase text-gray-600">M.D. Radiology</p>
                </div>
              </div>

              {/* Mobile share buttons (visible below document on small screens) */}
              <div className="mt-8 pt-5 border-t border-gray-100 flex flex-wrap gap-2 sm:hidden">
                <Button size="sm" disabled={shareLoading} onClick={() => handleShare("patient")} className="bg-green-600 hover:bg-green-700 gap-1.5 flex-1">
                  {shareLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                  {shareLoading ? "Preparing..." : "WhatsApp Patient"}
                </Button>
                <Button variant="outline" size="sm" disabled={shareLoading} onClick={() => handleShare("doctor")} className="gap-1.5 flex-1">
                  {shareLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                  {shareLoading ? "Preparing..." : "WhatsApp Doctor"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function NewReportPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    }>
      <ReportEditorInner />
    </Suspense>
  )
}
