"use client"

import { Suspense, useRef, useState, useEffect, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Download, CheckCircle2, Loader2,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, Share2, Pencil, LayoutTemplate, Minus, Plus, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight,
  Search, X, Upload, PenTool, Table2, Trash2,
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
import { reportHeaderHtml, reportTitleHtml, printShellHtml, getDisplayTitle, LETTERHEAD_TOP_PX, LETTERHEAD_BOTTOM_PX, A4_PAGE_PX } from "@/lib/report-layout"
import { fetchSignatories, signatureColumnsHtml, buildDocxSignatureCells, dataUrlToBytes, imageFormat, type Signatory, type SignatureLayout } from "@/lib/report-signatures"
import { SignatureColumns } from "@/components/signature-columns"
import { SignaturePadDialog } from "@/components/signature-pad-dialog"
import { useEditor, EditorContent } from "@tiptap/react"
import type { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { TextStyleKit } from "@tiptap/extension-text-style"
import TextAlign from "@tiptap/extension-text-align"
import { Table } from "@tiptap/extension-table"
import TableRow from "@tiptap/extension-table-row"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import Placeholder from "@tiptap/extension-placeholder"
import { SignatureExtension, type SignatureAttrs } from "@/lib/tiptap-signature-extension"
import { PaginationExtension, computeBodyPageDecorations, paginationPluginKey } from "@/lib/tiptap-pagination-extension"
import { LineHeight } from "@/lib/tiptap-line-height-extension"

// ── HTML ↔ DOCX formatting helpers ───────────────────────────────────────────

type Seg = {
  text: string; bold?: boolean; italic?: boolean; underline?: boolean; font?: string
  image?: string; imgWidth?: number; imgHeight?: number
}

// Reads the font a run was set to via execCommand("fontName", ...), which
// Chrome/Firefox represent as a legacy <font face="..."> wrapper.
function fontOf(el: HTMLElement): string | undefined {
  if (el.tagName.toLowerCase() === "font" && el.getAttribute("face")) return el.getAttribute("face") || undefined
  const styleFont = el.style?.fontFamily
  return styleFont ? styleFont.split(",")[0].trim().replace(/^["']|["']$/g, "") : undefined
}

// Tiptap's HTML parser only recognizes font-family as `<span style="font-family:...">`
// — it silently drops legacy `<font face="...">` wrappers entirely (confirmed:
// loading `<font face="Arial">text</font>` into the editor comes back out as
// plain `<p>text</p>`, no font info at all). Since that's exactly the shape
// execCommand("fontName", ...) produces — and therefore what every existing
// saved report and template body already contains — anything loaded straight
// into editor.commands.setContent() would silently lose all its font-family
// styling. This rewrites `<font face>` to the `<span style>` shape Tiptap
// does understand before content ever reaches the editor.
function normalizeLegacyHtml(html: string): string {
  if (typeof window === "undefined" || !html) return html
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("font[face]").forEach((el) => {
    const face = el.getAttribute("face")
    const span = doc.createElement("span")
    if (face) span.style.fontFamily = face
    while (el.firstChild) span.appendChild(el.firstChild)
    el.replaceWith(span)
  })
  // The old editor treated a top-level <div> exactly like a <p> (its own
  // line-spacing code applied to whichever of P/DIV/LI was closest), but
  // Tiptap's schema only has a paragraph node — a raw <div> doesn't match
  // its parse rule, so any line-height (or other) styling on it would
  // otherwise be silently dropped instead of just losing the tag name.
  Array.from(doc.body.children).forEach((el) => {
    if (el.tagName === "DIV") {
      const p = doc.createElement("p")
      if (el.getAttribute("style")) p.setAttribute("style", el.getAttribute("style")!)
      while (el.firstChild) p.appendChild(el.firstChild)
      el.replaceWith(p)
    }
  })
  return doc.body.innerHTML
}

function parseHtml(html: string): Seg[] {
  const segs: Seg[] = []
  if (typeof window === "undefined") return [{ text: html }]
  const doc = new DOMParser().parseFromString(html, "text/html")
  function walk(node: Node, fmt: { bold: boolean; italic: boolean; underline: boolean; font?: string }) {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ""
      if (t) segs.push({ text: t, ...fmt })
    } else if (node.nodeType === 1) {
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === "img") {
        const src = el.getAttribute("src") || ""
        if (src) {
          const w = parseFloat(el.style.width) || parseFloat(el.getAttribute("width") || "") || 0
          const h = parseFloat(el.style.height) || parseFloat(el.getAttribute("height") || "") || 0
          segs.push({ text: "", image: src, imgWidth: w, imgHeight: h })
        }
        return
      }
      const f = { ...fmt }
      if (tag === "b" || tag === "strong") f.bold = true
      if (tag === "i" || tag === "em")     f.italic = true
      if (tag === "u")                     f.underline = true
      f.font = fontOf(el) ?? f.font
      el.childNodes.forEach((c) => walk(c, f))
      // Table cells/rows have no natural line-break tag of their own, so a
      // DOCX/plain-text export would otherwise run every cell's text together
      // with no separator at all — space cells with a tab and end each row
      // with a newline so an exported table still reads as a table.
      if (tag === "td" || tag === "th") segs.push({ text: "\t" })
      if (["div", "p", "br", "li", "tr"].includes(tag)) segs.push({ text: "\n" })
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
  titleFont?: string
  signatories: Signatory[]
  signatureLayouts?: (SignatureLayout | null | undefined)[]
}): string {
  const { patient, study, body, age, gender, refBy, date, srNo, titleFont, signatories, signatureLayouts } = opts
  const displayDate = date || new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  const extraCss = `
.sigs { display: flex; gap: 30px; margin-top: 80px; page-break-inside: avoid; break-inside: avoid; }`

  return printShellHtml(`Report – ${patient}`, `
${reportHeaderHtml({ name: patient, refBy, date: displayDate, age, gender, srNo })}
${reportTitleHtml(study, titleFont)}
<div class="body" style="font-size:10pt;line-height:1.6;">${body}</div>
<div class="sigs">${signatureColumnsHtml(signatories, signatureLayouts)}</div>`, extraCss)
}

const FONT_FAMILIES = [
  "Arial", "Arial Black", "Arial Narrow", "Times New Roman", "Courier New",
  "Georgia", "Verdana", "Calibri", "Cambria", "Candara", "Consolas", "Constantia",
  "Corbel", "Tahoma", "Trebuchet MS", "Segoe UI", "Segoe Print", "Segoe Script",
  "Garamond", "Book Antiqua", "Bookman Old Style", "Century Gothic",
  "Franklin Gothic Medium", "Palatino Linotype", "Lucida Sans Unicode",
  "Lucida Console", "Comic Sans MS", "Impact", "Rockwell", "Perpetua"
]

// ── Formatting toolbar button ─────────────────────────────────────────────────

function FmtBtn({ onRun, label, title }: { onRun: () => void; label: React.ReactNode; title: string }) {
  return (
    <button
      type="button" title={title}
      onMouseDown={(e) => { e.preventDefault(); onRun() }}
      className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors"
    >
      {label}
    </button>
  )
}

function Sep() { return <span className="w-px h-4 bg-gray-300 mx-0.5" /> }

// ── Template picker card ───────────────────────────────────────────────────────
// Compact text card (name + preview excerpt) so a whole category's worth of
// templates is scannable at a glance instead of needing a wide scroll strip.
// Browse-and-apply only — adding/removing templates lives on the dedicated
// Report Templates page, not in this picker.
function TemplateCard({
  tpl, categoryLabel, onApply,
}: {
  tpl: ReportTemplate
  categoryLabel?: string
  onApply: () => void
}) {
  return (
    <button
      type="button"
      onClick={onApply}
      className="group w-full text-left p-3.5 rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-sm bg-white transition-all"
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        {categoryLabel && (
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{categoryLabel}</span>
        )}
        {tpl._id && (
          <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Custom</span>
        )}
      </div>
      <p className="text-xs font-semibold text-gray-800 group-hover:text-blue-600 leading-snug line-clamp-2">
        {tpl.name}
      </p>
      <p className="text-[11px] text-gray-400 mt-1 leading-relaxed line-clamp-2">
        {tpl.preview}
      </p>
    </button>
  )
}

// Friendly label for a category tab — the 4 built-in ones get a short display
// name, clinic-created categories (free-form strings) are shown as typed.
const BUILT_IN_TAB_LABEL: Record<string, string> = {
  usg: "USG", doppler: "Doppler", xray: "X-Ray", pathology: "Pathology",
}
const categoryTabLabel = (cat: string) => BUILT_IN_TAB_LABEL[cat] ?? cat

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
  const [patientNames, setPatientNames] = useState<string[]>([])

  useEffect(() => {
    if (hasPatient) return
    fetch("/api/patients")
      .then((r) => r.json())
      .then((d) => setPatientNames((d.patients ?? []).map((p: { name: string; srNo: number }) => `${p.name} (#${p.srNo})`)))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [templateTab,   setTemplateTab]   = useState<string>(() => {
    const s = (paramStudy || "").toLowerCase()
    if (s.includes("x") && (s.includes("ray") || s.includes("-ray"))) return "xray"
    if (["cbc","lft","kft","blood","thyroid","path","urine","hb"].some((k) => s.includes(k))) return "pathology"
    if (/doppler|carotid|venous|arterial|portal|renal artery/.test(s)) return "doppler"
    return "usg"
  })
  const [templateSearch, setTemplateSearch] = useState("")
  // Clinic-added templates (imported from Word via the Add Template page),
  // merged in alongside the built-in bundled ones. This picker is browse/apply
  // only — adding or removing templates happens on the Add Template page.
  // Keyed by category string rather than the narrow 4-value union, since the
  // clinic can create its own categories from that page.
  const [customTemplates, setCustomTemplates] = useState<Record<string, ReportTemplate[]>>({})
  const [templatesLoaded, setTemplatesLoaded] = useState(false)

  useEffect(() => {
    if (!showTemplates || templatesLoaded) return
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => {
        const grouped: Record<string, ReportTemplate[]> = {}
        for (const t of d.templates ?? []) {
          const cat = String(t.category)
          if (!grouped[cat]) grouped[cat] = []
          grouped[cat].push({ id: t._id, _id: t._id, name: t.name, heading: t.heading, preview: t.preview, body: t.body })
        }
        setCustomTemplates(grouped)
      })
      .catch(() => {})
      .finally(() => setTemplatesLoaded(true))
  }, [showTemplates, templatesLoaded])

  const [signatories, setSignatories] = useState<Signatory[]>([])
  useEffect(() => { fetchSignatories().then(setSignatories) }, [])

  const BUILTIN_CATS: TemplateCategory[] = ["usg", "doppler", "xray", "pathology"]
  const customCategoryKeys = Object.keys(customTemplates).filter((c) => !(BUILTIN_CATS as string[]).includes(c))
  // Every browsable category — the 4 built-ins plus any the clinic has created.
  const allCategoryTabs: string[] = [...BUILTIN_CATS, ...customCategoryKeys]

  const allTemplates = (cat: string) => [
    ...((BUILTIN_CATS as string[]).includes(cat) ? REPORT_TEMPLATES[cat as TemplateCategory] : []),
    ...(customTemplates[cat] ?? []),
  ]

  // Flat, cross-category search results — lets a doctor find a template by
  // name without needing to remember (or scroll through) the right category tab.
  const templateSearchResults = (() => {
    const q = templateSearch.trim().toLowerCase()
    if (!q) return null
    return allCategoryTabs.flatMap((cat) =>
      allTemplates(cat)
        .filter((t) => t.name.toLowerCase().includes(q) || t.heading.toLowerCase().includes(q))
        .map((t) => ({ ...t, category: cat }))
    )
  })()

  // Toolbar extras
  const [fontSize,   setFontSize]   = useState(14)
  const [fontFamily, setFontFamily] = useState("Arial")
  // The heading is still plain text under the hood (getDocTitle() reads
  // .innerText, and print/DOCX generation always render it bold+underlined+
  // centered regardless of anything else typed into it) — but unlike the
  // rest of the heading's formatting, the chosen font family is tracked here
  // as its own value so it can actually persist through save/print/DOCX.
  const [headingFont, setHeadingFont] = useState<string | undefined>(undefined)

  const showDoc   = hasPatient || pickerDone
  const needStudy = showDoc && !study

  const titleRef        = useRef<HTMLDivElement | null>(null)
  const originalBodyRef = useRef<string>("")
  const submittedRef    = useRef(false)

  // Which editable region the toolbar's next action should target — heading
  // (still plain contentEditable + execCommand) or body (Tiptap). Toolbar
  // buttons use onMouseDown+preventDefault so focus never actually leaves
  // whichever region is currently focused; a native <select> does steal
  // focus though, so this flag is what lets font/spacing dropdowns route
  // correctly even after that.
  const lastActiveRef = useRef<"heading" | "body">("body")

  // Heading-only selection capture — Tiptap keeps its own selection
  // internally even once DOM focus moves to a toolbar control, so unlike
  // execCommand, body-targeted commands need no equivalent save/restore.
  const toolbarSelRangeRef = useRef<Range | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    editable: !isReadOnly,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        code: false,
        strike: false,
      }),
      TextStyleKit.configure({ lineHeight: false }),
      LineHeight.configure({ types: ["paragraph"] }),
      TextAlign.configure({ types: ["paragraph"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      SignatureExtension,
      PaginationExtension,
      Placeholder.configure({ placeholder: "Start typing the report here..." }),
    ],
    onFocus: () => { lastActiveRef.current = "body" },
  })

  useEffect(() => {
    editor?.setEditable(!isReadOnly)
  }, [editor, isReadOnly])

  // Saved per-report drag/resize override for the two doctor-signature images
  // (index 0/1 matches the columns; overrideImage holds custom drawn dataUrls)
  const [loadedSigLayout, setLoadedSigLayout] = useState<(SignatureLayout | null | undefined)[]>([
    { hidden: true },
    { hidden: true }
  ])

  const paperRef        = useRef<HTMLDivElement | null>(null)
  // Pagination: the document is laid out as real A4 sheets — content that would
  // fall into a page's footer band is pushed to the top of the next sheet, just
  // like Microsoft Word's Print Layout view.
  const wrapRef         = useRef<HTMLDivElement | null>(null)
  const patientBoxRef   = useRef<HTMLDivElement | null>(null)
  const titleWrapRef    = useRef<HTMLDivElement | null>(null)
  const sigsRef         = useRef<HTMLDivElement | null>(null)
  const rafRef          = useRef<number | undefined>(undefined)
  const [numPages, setNumPages] = useState(1)


  const A4_GAP_PX  = 28                                    // grey gap drawn between sheets
  const A4_STRIDE  = A4_PAGE_PX + A4_GAP_PX                // sheet-to-sheet distance

  // Pagination margins for the body are ProseMirror decorations now (see
  // tiptap-pagination-extension.ts) — they were never part of the document,
  // so editor.getHTML() already excludes them without any stripping step.
  const readCleanBody = useCallback(() => {
    return editor?.getHTML() ?? ""
  }, [editor])

  // Push a single non-ProseMirror-owned block (patient box / heading /
  // signature block) to the next page if it overflows the current page's
  // footer band. Same footer-band-overflow check the body uses via
  // computeBodyPageDecorations, just applied as a direct style write since
  // these blocks are plain React-rendered DOM, not ProseMirror-owned.
  const pushIfOverflowing = useCallback((it: HTMLElement, wrapTop: number, page: number): number => {
    if (it.dataset.pgb) {
      it.style.marginTop = it.getAttribute("data-pgb-base") || ""
      delete it.dataset.pgb
      it.removeAttribute("data-pgb-base")
    }
    const r      = it.getBoundingClientRect()
    const top    = r.top - wrapTop
    const bottom = top + r.height
    const footerLimit = page * A4_STRIDE + (A4_PAGE_PX - LETTERHEAD_BOTTOM_PX)
    const pageTop      = page * A4_STRIDE + LETTERHEAD_TOP_PX
    if (bottom > footerLimit + 1 && top > pageTop + 2) {
      page++
      const target = page * A4_STRIDE + LETTERHEAD_TOP_PX
      const delta  = target - top
      if (delta > 0) {
        const base = parseFloat(getComputedStyle(it).marginTop) || 0
        it.setAttribute("data-pgb-base", it.style.marginTop || "")
        it.dataset.pgb = "1"
        it.style.marginTop = `${base + delta}px`
      }
    }
    return page
  }, [A4_STRIDE])

  // Measure the flowing blocks and push any that would cross a page's footer band
  // down to the next sheet's content area. Sets the sheet count for the backdrop.
  // The report body's own blocks are computed as ProseMirror decorations
  // (computeBodyPageDecorations) rather than direct style writes, since that
  // content is ProseMirror-owned — see tiptap-pagination-extension.ts.
  const paginate = useCallback(() => {
    const wrap = wrapRef.current
    const view = editor?.view
    if (!wrap || !view) return

    const wrapTop = wrap.getBoundingClientRect().top
    let page = 0

    if (patientBoxRef.current) page = pushIfOverflowing(patientBoxRef.current, wrapTop, page)
    if (titleWrapRef.current)  page = pushIfOverflowing(titleWrapRef.current, wrapTop, page)

    const bodyEntryTop = view.dom.getBoundingClientRect().top - wrapTop
    const { decorationSet, exitPage } = computeBodyPageDecorations(view, {
      wrapTop, entryPage: page, entryTopPx: bodyEntryTop,
      stride: A4_STRIDE, a4PagePx: A4_PAGE_PX,
      letterheadTopPx: LETTERHEAD_TOP_PX, letterheadBottomPx: LETTERHEAD_BOTTOM_PX,
    })
    view.dispatch(view.state.tr.setMeta(paginationPluginKey, decorationSet))
    page = exitPage

    if (sigsRef.current) page = pushIfOverflowing(sigsRef.current, wrapTop, page)

    setNumPages(page + 1)
  }, [A4_STRIDE, editor, pushIfOverflowing])

  const schedulePaginate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => paginate())
  }, [paginate])

  // ── Insert Signature ─────────────────────────────────────────────────────────
  // Tiptap/ProseMirror keeps its own selection internally even once DOM focus
  // moves into the signature-pad dialog, so — unlike the old raw-DOM
  // insertion — no Range needs to be manually saved/restored here.
  const [sigPadOpen, setSigPadOpen] = useState(false)
  // Remounts the dialog fresh each time it opens (rather than resetting state
  // in an effect) so a leftover drawn/typed/uploaded signature from a
  // previous session can never be re-inserted by mistake.
  const [sigPadKey, setSigPadKey] = useState(0)

  const openSignaturePad = () => {
    setSigPadKey((k) => k + 1)
    setSigPadOpen(true)
  }

  // Inserted as a signature node at the caret — an atomic Tiptap node whose
  // position/size live in its attrs (not raw style), so drag/resize survive
  // ProseMirror's own redraws and undo/redo. See tiptap-signature-extension.ts.
  const insertSignature = ({ dataUrl, width, height }: { dataUrl: string; width: number; height: number }) => {
    const attrs: SignatureAttrs = { src: dataUrl, width, height, left: 0, top: 0, kind: "stamp" }
    editor?.chain().focus().insertSignature(attrs).run()
    setSigPadOpen(false)
  }

  // ── Drag / resize / nudge for an inserted signature stamp ────────────────────
  // Clicking a stamp shows a small floating toolbar plus a resize handle at its
  // bottom-right corner (positioned against wrapRef, the same relatively-
  // positioned ancestor the page-sheet overlay uses). Holding down directly on
  // the stamp drags it anywhere on the page (e.g. up into the signature block
  // above a doctor's name); the corner handle scales it up or down. The nudge
  // buttons stay as a precise fallback for small adjustments.
  // The selected DOM node itself lives in a ref (mutable handle, not render
  // data); only the overlay's screen position is real state, since that's
  // what the render actually needs to react to.
  const selectedSigRef = useRef<HTMLImageElement | null>(null)
  const [sigOverlayPos, setSigOverlayPos] = useState<{
    toolbarTop: number; toolbarLeft: number; handleTop: number; handleLeft: number; kind: "stamp" | "doctor"
  } | null>(null)

  const updateSigOverlayPos = (img: HTMLImageElement) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const wrapRect = wrap.getBoundingClientRect()
    const imgRect  = img.getBoundingClientRect()
    setSigOverlayPos({
      toolbarTop:  imgRect.top - wrapRect.top - 34,
      toolbarLeft: Math.max(0, imgRect.left - wrapRect.left),
      handleTop:   imgRect.bottom - wrapRect.top - 7,
      handleLeft:  imgRect.right - wrapRect.left - 7,
      kind: img.dataset.sigKind === "doctor" ? "doctor" : "stamp",
    })
  }

  const selectSigStamp = (img: HTMLImageElement) => {
    selectedSigRef.current = img
    updateSigOverlayPos(img)
  }

  // Reads the current drag/resize state of the two signature-block images
  // straight off the DOM (mirrors readCleanBody()'s "imperative source of
  // truth, read at save time" pattern) so it can be persisted and threaded
  // into the DOCX/PDF/print exports.
  const readSignatureLayout = (): (SignatureLayout | null)[] => {
    const layout: (SignatureLayout | null)[] = [null, null]
    for (let i = 0; i < 2; i++) {
      const img = sigsRef.current?.querySelector<HTMLImageElement>(`img[data-sig-idx="${i}"]`)
      if (!img) {
        // A hidden/removed signature unmounts its <img> entirely (replaced by
        // the "+ Add Signature" placeholder) — state is the only remaining
        // record of that removal, so fall back to it instead of dropping it.
        layout[i] = loadedSigLayout[i] ?? null
        continue
      }
      const left   = parseFloat(img.style.left)   || 0
      const top    = parseFloat(img.style.top)    || 0
      const width  = parseFloat(img.style.width)  || 0
      const height = parseFloat(img.style.height) || 0
      const hidden = img.style.display === "none" || img.getAttribute("data-sig-hidden") === "true"
      const overrideImage = loadedSigLayout[i]?.overrideImage || (img.src?.startsWith("data:") ? img.src : undefined)
      if (left || top || width || height || hidden || overrideImage) {
        layout[i] = {
          ...(left ? { left } : {}),
          ...(top ? { top } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(hidden ? { hidden } : {}),
          ...(overrideImage ? { overrideImage } : {}),
        }
      }
    }
    return layout
  }

  const deselectSig = () => {
    selectedSigRef.current = null
    setSigOverlayPos(null)
  }

  // Only the two fixed "doctor" signature slots (outside the editor, in
  // <SignatureColumns>) still go through this generic overlay system —
  // in-body stamps are now a Tiptap node with their own self-contained
  // drag/resize/delete (see tiptap-signature-extension.ts).
  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === "IMG" && target.getAttribute("data-sig-kind") === "doctor") {
      selectSigStamp(target as HTMLImageElement)
    } else {
      deselectSig()
    }
  }

  const nudgeSig = (dx: number, dy: number) => {
    const img = selectedSigRef.current
    if (!img) return
    const curLeft = parseFloat(img.style.left) || 0
    const curTop  = parseFloat(img.style.top) || 0
    let newLeft = curLeft + dx
    let newTop  = curTop + dy
    if (img.dataset.sigKind === "doctor") {
      newLeft = Math.max(-150, Math.min(150, newLeft))
      newTop  = Math.max(-60, Math.min(0, newTop))
    } else {
      newLeft = Math.max(-200, Math.min(200, newLeft))
      newTop  = Math.max(-100, Math.min(100, newTop))
    }
    img.style.left = `${newLeft}px`
    img.style.top  = `${newTop}px`
    updateSigOverlayPos(img)
    if (img.dataset.sigKind === "doctor") {
      const idx = parseInt(img.dataset.sigIdx || "0")
      const copy = [...loadedSigLayout]
      const layout = copy[idx]
      copy[idx] = {
        ...(layout || {}),
        left: newLeft,
        top: newTop,
      }
      setLoadedSigLayout(copy)
    }
  }

  const removeSelectedSig = () => {
    const img = selectedSigRef.current
    if (!img) return
    if (img.dataset.sigKind === "doctor") {
      const idx = Number(img.dataset.sigIdx)
      setLoadedSigLayout((prev) => {
        const next = [...prev]
        next[idx] = { ...next[idx], hidden: true }
        return next
      })
      deselectSig()
      schedulePaginate()
      return
    }
    img.remove()
    deselectSig()
    schedulePaginate()
  }

  // Click-and-hold drag: a pair of listeners scoped to this single drag
  // gesture (no persistent ref needed) moves the stamp by the same relative
  // left/top offset the nudge buttons use, continuously while the pointer moves.
  const beginDragSig = (e: React.PointerEvent, img: HTMLImageElement) => {
    e.preventDefault()
    e.stopPropagation()
    selectSigStamp(img)
    const startX = e.clientX, startY = e.clientY
    const baseLeft = parseFloat(img.style.left) || 0
    const baseTop  = parseFloat(img.style.top)  || 0
    const isDoctor = img.dataset.sigKind === "doctor"

    const onMove = (ev: PointerEvent) => {
      let newLeft = baseLeft + (ev.clientX - startX)
      let newTop  = baseTop  + (ev.clientY - startY)
      if (isDoctor) {
        newLeft = Math.max(-150, Math.min(150, newLeft))
        newTop  = Math.max(-60, Math.min(0, newTop))
      } else {
        newLeft = Math.max(-200, Math.min(200, newLeft))
        newTop  = Math.max(-100, Math.min(100, newTop))
      }
      img.style.left = `${newLeft}px`
      img.style.top  = `${newTop}px`
      updateSigOverlayPos(img)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      if (isDoctor) {
        const idx = parseInt(img.dataset.sigIdx || "0")
        const copy = [...loadedSigLayout]
        const layout = copy[idx]
        copy[idx] = {
          ...(layout || {}),
          left: parseFloat(img.style.left) || 0,
          top: parseFloat(img.style.top) || 0,
        }
        setLoadedSigLayout(copy)
      }
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Corner-handle resize: scales width/height together, keeping aspect ratio.
  const beginResizeSig = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const img = selectedSigRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    const startX = e.clientX
    const startW = rect.width, startH = rect.height
    const isDoctor = img.dataset.sigKind === "doctor"

    const onMove = (ev: PointerEvent) => {
      let newW = Math.max(24, startW + (ev.clientX - startX))
      if (isDoctor) {
        newW = Math.min(220, newW)
      } else {
        newW = Math.min(350, newW)
      }
      const scale = newW / startW
      // Inline style (not the width/height attribute) so this also overrides
      // the signature-block image's own CSS height class when resizing that.
      img.style.width  = `${Math.round(newW)}px`
      img.style.height = `${Math.round(Math.max(12, startH * scale))}px`
      updateSigOverlayPos(img)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      if (isDoctor) {
        const idx = parseInt(img.dataset.sigIdx || "0")
        const copy = [...loadedSigLayout]
        const layout = copy[idx]
        copy[idx] = {
          ...(layout || {}),
          width: parseFloat(img.style.width) || 0,
          height: parseFloat(img.style.height) || 0,
        }
        setLoadedSigLayout(copy)
      }
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Event delegation: any signature stamp inside the body starts a drag on
  // pointerdown, regardless of when it was inserted or reloaded from saved HTML.
  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === "IMG" && target.getAttribute("data-sig-kind") === "doctor") {
      beginDragSig(e, target as HTMLImageElement)
    }
  }

  // Re-paginate whenever the body content or viewport changes. Attribute
  // mutations (our own margin writes) are intentionally not observed to avoid loops.
  useEffect(() => {
    if (!showDoc || !study || !editor) return
    schedulePaginate()
    const bodyEl = editor.view.dom
    const mo = new MutationObserver(schedulePaginate)
    mo.observe(bodyEl, { childList: true, subtree: true, characterData: true })
    const ro = new ResizeObserver(schedulePaginate)
    ro.observe(bodyEl)
    // The signature block grows/shrinks when a signature image is inserted,
    // resized or removed — its placement must be recomputed then too, or the
    // taller block spills into the footer band it was measured to sit above.
    // (Safe from loops: paginate only writes marginTop, which is not part of
    // the observed box size.)
    if (sigsRef.current) ro.observe(sigsRef.current)
    window.addEventListener("resize", schedulePaginate)
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener("resize", schedulePaginate)
    }
  }, [showDoc, study, schedulePaginate, editor])

  // ── Track the last selection made inside either editable region ──────────────
  // `selectionchange` alone is not reliable here: it fires asynchronously, so
  // it can lose the race against a toolbar <select>'s own focus/change
  // sequence — the select's "change" handler can run before the very last
  // selectionchange event (from e.g. Ctrl+A) has been delivered, leaving the
  // saved range stale or empty. `onBlur` on the editable element itself fires
  // synchronously as focus leaves it — guaranteed to run before the toolbar
  // control that stole focus gets to react — so it's the authoritative
  // capture; the `selectionchange` listener just keeps it fresh in between.
  const captureToolbarSelection = (el: HTMLDivElement | null) => {
    if (!el) return
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      toolbarSelRangeRef.current = sel.getRangeAt(0).cloneRange()
      lastActiveRef.current = "heading"
    }
  }

  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement
      if (titleRef.current?.contains(el)) {
        toolbarSelRangeRef.current = range.cloneRange()
        lastActiveRef.current = "heading"
      }
    }
    document.addEventListener("selectionchange", onSelectionChange)
    return () => document.removeEventListener("selectionchange", onSelectionChange)
  }, [])

  // Restores the last selection made inside the heading/body onto the given
  // element and focuses it — used before toolbar commands that would otherwise
  // run against whatever picked up focus last (e.g. a <select>).
  const restoreEditableSelection = (): HTMLDivElement | null => {
    const target = titleRef.current
    if (!target) return null
    target.focus()
    const sel = window.getSelection()
    if (sel && toolbarSelRangeRef.current) {
      sel.removeAllRanges()
      sel.addRange(toolbarSelRangeRef.current)
    }
    return target
  }

  // Current heading text (falls back to the study name)
  const getDocTitle = () => (titleRef.current?.innerText ?? "").trim() || getDisplayTitle(study).toUpperCase()
  const [docxLoading,        setDocxLoading]        = useState(false)
  const [submitting,         setSubmitting]          = useState(false)
  const [submitted,          setSubmitted]           = useState(false)
  const [submittedDocxBase64, setSubmittedDocxBase64] = useState("")
  // Captured from the live heading at submit time — the editor (and titleRef)
  // unmounts once the "Report Submitted" screen renders, so getDocTitle() would
  // otherwise fall back to the original study name and the download filename
  // would silently revert to it even though the saved DOCX has the edited title.
  const [submittedDocTitle,  setSubmittedDocTitle]  = useState("")
  const [submittedHeadingFont, setSubmittedHeadingFont] = useState<string | undefined>(undefined)
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
      if (!submittedRef.current && editor && !editor.isEmpty) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            body: readCleanBody(),
            docTitle: titleRef.current?.innerText?.trim() || undefined,
            headingFont,
            patient, study, date, age, gender, contact, srNo, refBy,
            savedAt: new Date().toISOString(),
          }))
        } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy, editor, headingFont])

  // ── Load report body: localStorage draft first, then the submitted body from DB ──
  useEffect(() => {
    if (!showDoc || !editor) return

    const setBody = (html: string, title?: string, font?: string) => {
      editor.commands.setContent(normalizeLegacyHtml(html))
      if (paramLoad || paramView) originalBodyRef.current = html
      if (title && titleRef.current) titleRef.current.innerText = title
      setHeadingFont(font || undefined)
      schedulePaginate()
    }

    let draft: { body?: string; docTitle?: string; headingFont?: string; study?: string } | null = null
    try { draft = JSON.parse(localStorage.getItem(storageKey) || "null") } catch {}

    if (draft?.body) {
      const d = draft
      setTimeout(() => {
        setBody(d.body!, d.docTitle, d.headingFont)
        if (d.study) setCurrentStudy(d.study)
      }, 80)
    }

    // View / edit mode — pull the submitted body/layout for this study
    if (paramId && (paramView || paramLoad)) {
      fetch(`/api/patients/${paramId}`)
        .then((r) => r.json())
        .then((d) => {
          const p = d.patient
          if (!p) return
          const entry = p.studies?.[paramSidx]
          if (!draft?.body) {
            const html: string = entry?.reportBody || p.reportBody || ""
            const savedHeading: string = entry?.heading || p.heading || ""
            const savedHeadingFont: string = entry?.headingFont || p.headingFont || ""
            if (html) setTimeout(() => setBody(html, savedHeading || undefined, savedHeadingFont || undefined), 80)
          }
          if (entry?.name) setCurrentStudy(entry.name)
          const savedLayouts = entry?.signatureLayout
          if (savedLayouts && savedLayouts.length > 0) {
            setLoadedSigLayout(savedLayouts)
          } else {
            setLoadedSigLayout([{ hidden: true }, { hidden: true }])
          }
        })
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDoc, editor])

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
      if (submittedRef.current || !editor || editor.isEmpty) return
      const html = readCleanBody()
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          body: html,
          docTitle: titleRef.current?.innerText?.trim() || undefined,
          headingFont,
          patient, study, date, age, gender, contact, srNo, refBy,
          savedAt: new Date().toISOString(),
        }))
      } catch {}
    }
    window.addEventListener("beforeunload", save)
    return () => window.removeEventListener("beforeunload", save)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy, editor, headingFont])

  // ── Build DOCX blob from current report body ─────────────────────────────────
  const buildDocxBase64 = async (bodyHtml: string): Promise<string> => {
    const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, BorderStyle } = await import("docx")
    const sigCells = await buildDocxSignatureCells(signatories, readSignatureLayout())

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
        if (s.image) {
          if (line.length) flush()
          const w = Math.min(s.imgWidth || 150, 450)
          const h = s.imgWidth && s.imgHeight ? Math.round(w * (s.imgHeight / s.imgWidth)) : Math.min(s.imgHeight || 60, 300)
          paras.push(new Paragraph({
            children: [new ImageRun({ type: imageFormat(s.image), data: dataUrlToBytes(s.image), transformation: { width: w, height: h } })],
            spacing: { after: 80 },
          }))
          return
        }
        if (s.text === "\n") { flush() }
        else { line.push(new TextRun({ text: s.text, bold: s.bold, italics: s.italic, underline: s.underline ? {} : undefined, font: s.font, size })) }
      })
      if (line.length) flush()
      return paras.length ? paras : [new Paragraph({ children: [new TextRun({ text: "", size })] })]
    }

    const { Table, TableRow, TableCell, WidthType } = await import("docx")

    const noBorder     = { style: BorderStyle.NONE,   size: 0, color: "ffffff" }
    const doubleBorder = { style: BorderStyle.DOUBLE, size: 6, color: "000000" }
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
                    children: [new TextRun({ text: getDocTitle().toUpperCase(), bold: true, size: 26, underline: {}, ...(headingFont ? { font: headingFont } : {}) })],
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
          // Row 1: Signature Images
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: sigCells.imgLeft,
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: sigCells.imgRight,
              }),
            ],
          }),
          // Row 2: Doctor Names & Credentials
          new TableRow({
            children: [
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: sigCells.textLeft,
              }),
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: sigCells.textRight,
              }),
            ],
          }),
        ],
      }),
    ]

    // Top/bottom margins keep the pre-printed letterhead bands (logo header,
    // address footer) empty on every page: 40mm top / 30mm bottom, in twips.
    return await Packer.toBase64String(new Document({
      sections: [{
        properties: { page: { margin: { top: 2270, bottom: 1700, left: 1440, right: 1440 } } },
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
    if (paramLoad && originalBodyRef.current && editor) {
      const marked = markChanges(originalBodyRef.current, readCleanBody(), editorName, editedAtDisplay)
      editor.commands.setContent(normalizeLegacyHtml(marked))
      schedulePaginate()
    }

    // Final body HTML (with attribution spans if edit mode)
    const finalBody = readCleanBody()
    setSubmittedDocTitle(getDocTitle())
    setSubmittedHeadingFont(headingFont)

    // Save to localStorage
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        body: finalBody,
        docTitle: titleRef.current?.innerText?.trim() || undefined,
        headingFont,
        patient, study, date, age, gender, contact, srNo, refBy,
        savedAt: now.toISOString(),
      }))
    } catch {}

    // Generate DOCX and save everything to MongoDB
    if (paramId) {
      const cleanBody = stripEditedSpans(finalBody)

      // Generate DOCX from the clean body and stash it for the success screen
      let reportDocx = ""
      try {
        reportDocx = await buildDocxBase64(cleanBody)
        setSubmittedDocxBase64(reportDocx)
      } catch {}

      // Signature images (drawn/typed/uploaded) can push this payload past the
      // server's request-size limit. A failed save must NOT show the success
      // screen — that's exactly how an added signature silently "disappears":
      // the request is rejected but the UI used to claim success regardless.
      try {
        const res = await fetch(`/api/patients/${paramId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studyIndex:   paramSidx,
            reportStatus: "completed",
            reportBody:   cleanBody,
            reportDocx,
            studyName:    study,
            heading:      getDocTitle(),
            headingFont:  headingFont || "",
            signatureLayout: readSignatureLayout(),
            ...(localSrNo ? { srNo: Number(localSrNo) } : {}),
            editHistoryEntry: {
              editor:   editorName,
              editedAt: now.toISOString(),
              body:     cleanBody,
            },
          }),
        })
        if (!res.ok) {
          alert(
            res.status === 413
              ? "Save failed: the report (including the signature image) is too large for the server to accept. Try a smaller/lower-resolution signature image and save again."
              : `Save failed (server returned ${res.status}). Please try again.`
          )
          setSubmitting(false)
          return
        }
      } catch {
        alert("Save failed: could not reach the server. Check your connection and try again.")
        setSubmitting(false)
        return
      }
    }

    submittedRef.current = true
    setSubmitting(false)
    setSubmitted(true)
  }

  // ── Template apply ───────────────────────────────────────────────────────────
  const applyTemplate = (tpl: ReportTemplate) => {
    if (!editor) return
    const hasContent = !editor.isEmpty
    if (hasContent && !confirm(`Replace current report content with "${tpl.name}"?`)) return
    editor.commands.setContent(normalizeLegacyHtml(tpl.body))
    // Update local study state
    setCurrentStudy(tpl.name)
    // Template always drives the heading (falls back to the study name)
    if (titleRef.current) titleRef.current.textContent = tpl.heading || tpl.name.toUpperCase()
    setHeadingFont(undefined)
    // Persist immediately so a stale draft can't bring the old heading back
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        body: tpl.body,
        docTitle: tpl.heading || tpl.name.toUpperCase(),
        headingFont: undefined,
        patient, study: tpl.name, date, age, gender, contact, srNo, refBy,
        savedAt: new Date().toISOString(),
      }))
    } catch {}
    setShowTemplates(false)
    editor.commands.focus()
    schedulePaginate()
  }

  // ── Font size change (applies to selection or sets cursor default) ────────────
  // Heading path: execCommand("fontSize", ..., "7") + swapping the resulting
  // legacy <font size="7"> tags for a precise pixel style is deliberate — a
  // Range-based surroundContents() throws whenever the selection spans more
  // than one paragraph, so multi-paragraph selections only got the first
  // block resized; execCommand splits/reassembles nodes at paragraph
  // boundaries itself. Body path: Tiptap's own FontSize mark (TextStyleKit)
  // does this natively without any of that DOM surgery.
  const changeFontSize = (delta: number) => {
    const newSize = Math.max(8, Math.min(72, fontSize + delta))
    setFontSize(newSize)
    if (lastActiveRef.current === "body") {
      editor?.chain().focus().setFontSize(`${newSize}px`).run()
      schedulePaginate()
      return
    }
    const target = restoreEditableSelection()
    const sel = window.getSelection()
    if (!target || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
    document.execCommand("fontSize", false, "7")
    target.querySelectorAll('font[size="7"]').forEach((el) => {
      el.removeAttribute("size")
      ;(el as HTMLElement).style.fontSize = `${newSize}px`
    })
    schedulePaginate()
  }

  // ── Font family apply ─────────────────────────────────────────────────────────
  const applyFontFamily = (family: string) => {
    setFontFamily(family)
    if (lastActiveRef.current === "body") {
      editor?.chain().focus().setFontFamily(family).run()
      schedulePaginate()
      return
    }
    // The heading only ever persists as plain text (getDocTitle() reads
    // .innerText), so per-character formatting from execCommand here is
    // cosmetic-only — but the font choice itself is tracked separately in
    // headingFont so it actually survives save/print/DOCX for the heading
    // as a whole.
    setHeadingFont(family)
    restoreEditableSelection()
    document.execCommand("fontName", false, family)
    schedulePaginate()
  }

  // ── Line spacing apply ────────────────────────────────────────────────────────
  // Word-style per-paragraph spacing: sets line-height only on the block(s) the
  // selection actually touches, so different paragraphs can carry different
  // spacing at the same time instead of one global value for the whole report.
  // Body path: Tiptap's LineHeight extension is configured for the paragraph
  // node type (not the inline textStyle mark), so it already applies to every
  // paragraph the selection touches — no manual block-walking needed.
  const applyLineSpacing = (value: string) => {
    if (lastActiveRef.current === "body") {
      editor?.chain().focus().setLineHeight(value).run()
      schedulePaginate()
      return
    }
    const target = restoreEditableSelection()
    const sel = window.getSelection()
    if (!target || !sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)

    const closestBlock = (node: Node | null): HTMLElement | null => {
      let el = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement ?? null
      while (el && el !== target && !["P", "DIV", "LI"].includes(el.tagName)) el = el.parentElement
      return el && el !== target ? el : null
    }

    const blocks = new Set<HTMLElement>()
    const startBlock = closestBlock(range.startContainer)
    if (startBlock) blocks.add(startBlock)
    if (!range.collapsed) {
      const endBlock = closestBlock(range.endContainer)
      if (endBlock) blocks.add(endBlock)
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_ELEMENT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node)) {
          const block = closestBlock(node)
          if (block) blocks.add(block)
        }
      }
    }

    if (blocks.size === 0) {
      // No wrapping paragraph element at the caret (e.g. an empty editor) —
      // apply to the whole editable area instead of silently doing nothing.
      target.style.lineHeight = value
    } else {
      blocks.forEach((b) => { b.style.lineHeight = value })
    }
    schedulePaginate()
  }

  // ── Table insert / delete ─────────────────────────────────────────────────────
  // Tables only ever make sense in the report body, so these always target
  // the editor regardless of which region last had focus.
  const insertTable = () => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()
    schedulePaginate()
  }

  const deleteTable = () => {
    editor?.chain().focus().deleteTable().run()
    schedulePaginate()
  }

  // Row/column editing — no-ops when the cursor isn't inside a table cell
  // (Tiptap's own commands already handle that; nothing to guard here).
  const addTableRow = () => { editor?.chain().focus().addRowAfter().run(); schedulePaginate() }
  const deleteTableRow = () => { editor?.chain().focus().deleteRow().run(); schedulePaginate() }
  const addTableColumn = () => { editor?.chain().focus().addColumnAfter().run(); schedulePaginate() }
  const deleteTableColumn = () => { editor?.chain().focus().deleteColumn().run(); schedulePaginate() }

  // ── Shared toolbar-button dispatch (Bold/Italic/Underline/Align/List/Clear) ──
  // Routes to the heading's execCommand (unchanged) or the body's Tiptap
  // chain, based on which region last had real focus (see lastActiveRef).
  const runFormat = (headingCmd: string, bodyRun: (e: Editor) => void) => {
    if (lastActiveRef.current === "heading") {
      restoreEditableSelection()
      document.execCommand(headingCmd)
    } else if (editor) {
      bodyRun(editor)
    }
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
    let bodyHtml = readCleanBody()
    // If editing an existing report, mark changed blocks with underline
    if (paramLoad && originalBodyRef.current) {
      bodyHtml = markChanges(originalBodyRef.current, bodyHtml)
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        body: bodyHtml,
        docTitle: titleRef.current?.innerText?.trim() || undefined,
        headingFont,
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
      body: readCleanBody(),
      age,
      gender,
      contact,
      refBy,
      date,
      srNo: localSrNo || srNo,
      titleFont: headingFont,
      signatories,
      signatureLayouts: readSignatureLayout(),
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
  // Rasterizes the same header/title/body/signatures markup used for printing,
  // so the exported PDF shows whatever font the browser actually rendered
  // (Georgia, Calibri, Tahoma, ...) instead of jsPDF's built-in Helvetica.
  const buildPdfBlob = async (bodyHtml: string): Promise<Blob> => {
    const { buildPagedPdfBlob } = await import("@/lib/dom-to-pdf")
    // On the post-submit screen titleRef has already unmounted, so getDocTitle()
    // can only fall back to the generic study name — submittedDocTitle (captured
    // live, right before submission) is what still has the doctor's edited heading.
    return buildPagedPdfBlob({
      headerHtml: reportHeaderHtml({ name: patient, refBy, date, age, gender, srNo: localSrNo || srNo }),
      titleHtml: reportTitleHtml(submittedDocTitle || getDocTitle(), submittedHeadingFont ?? headingFont),
      bodyHtml,
      signaturesHtml: signatureColumnsHtml(signatories, readSignatureLayout()),
    })
  }

  // ── Share on WhatsApp: upload PDF → share download link ─────────────────────
  const handleShare = async (to: "patient" | "doctor") => {
    if (!paramId) return
    setShareLoading(true)

    const cleanHtml = stripEditedSpans(readCleanBody())
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
        body:    JSON.stringify({ reportPdf: base64, studyIndex: paramSidx, signatureLayout: readSignatureLayout() }),
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
      const base64 = await buildDocxBase64(readCleanBody())
      const docTitle = getDocTitle()
      downloadDocxFromBase64(base64, `Report_${(patient || "Patient").replace(/\s+/g, "_")}${docTitle ? `_${docTitle.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.docx`)
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
                    `Report_${(patient || "Patient").replace(/\s+/g, "_")}${submittedDocTitle ? `_${submittedDocTitle.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.docx`
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

            {/* Line spacing — applies to the paragraph(s) touched by the selection */}
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) applyLineSpacing(e.target.value)
                e.target.value = ""
              }}
              className="h-7 text-[11px] border border-gray-200 rounded px-1.5 mr-1 bg-white text-gray-700 cursor-pointer focus:outline-none focus:border-blue-400"
              title="Line spacing"
            >
              <option value="" disabled>Spacing</option>
              {["1", "1.15", "1.5", "2", "2.5"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>

            <Sep />
            <FmtBtn onRun={() => runFormat("bold", (e) => { e.chain().focus().toggleBold().run() })}
              label={<Bold className="h-3.5 w-3.5 stroke-[2.5]" />} title="Bold (Ctrl+B)" />
            <FmtBtn onRun={() => runFormat("italic", (e) => { e.chain().focus().toggleItalic().run() })}
              label={<Italic className="h-3.5 w-3.5" />} title="Italic (Ctrl+I)" />
            <FmtBtn onRun={() => runFormat("underline", (e) => { e.chain().focus().toggleUnderline().run() })}
              label={<Underline className="h-3.5 w-3.5" />} title="Underline (Ctrl+U)" />
            <Sep />
            <FmtBtn onRun={() => runFormat("justifyLeft", (e) => { e.chain().focus().setTextAlign("left").run() })}
              label={<AlignLeft className="h-3.5 w-3.5" />} title="Align left" />
            <FmtBtn onRun={() => runFormat("justifyCenter", (e) => { e.chain().focus().setTextAlign("center").run() })}
              label={<AlignCenter className="h-3.5 w-3.5" />} title="Center" />
            <FmtBtn onRun={() => runFormat("justifyRight", (e) => { e.chain().focus().setTextAlign("right").run() })}
              label={<AlignRight className="h-3.5 w-3.5" />} title="Align right" />
            <Sep />
            <FmtBtn onRun={() => runFormat("insertUnorderedList", (e) => { e.chain().focus().toggleBulletList().run() })}
              label={<List className="h-3.5 w-3.5" />} title="Bullet list" />
            <FmtBtn onRun={() => runFormat("insertOrderedList", (e) => { e.chain().focus().toggleOrderedList().run() })}
              label={<span className="text-[11px] font-semibold">1.</span>} title="Numbered list" />
            <Sep />
            <FmtBtn onRun={() => runFormat("removeFormat", (e) => { e.chain().focus().unsetAllMarks().clearNodes().run() })}
              label={<span className="text-[11px] text-gray-400 font-medium">Clear</span>} title="Clear formatting" />
            <Sep />
            <button
              type="button" title="Insert table"
              onMouseDown={(e) => { e.preventDefault(); insertTable() }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors"
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button" title="Delete table (click inside a table first)"
              onMouseDown={(e) => { e.preventDefault(); deleteTable() }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button" title="Add row below (click inside a table row first)"
              onMouseDown={(e) => { e.preventDefault(); addTableRow() }}
              className="h-7 px-1.5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors text-[10px] font-semibold"
            >
              +Row
            </button>
            <button
              type="button" title="Delete current row (click inside a table row first)"
              onMouseDown={(e) => { e.preventDefault(); deleteTableRow() }}
              className="h-7 px-1.5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors text-[10px] font-semibold"
            >
              -Row
            </button>
            <button
              type="button" title="Add column after (click inside a table column first)"
              onMouseDown={(e) => { e.preventDefault(); addTableColumn() }}
              className="h-7 px-1.5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors text-[10px] font-semibold"
            >
              +Col
            </button>
            <button
              type="button" title="Delete current column (click inside a table column first)"
              onMouseDown={(e) => { e.preventDefault(); deleteTableColumn() }}
              className="h-7 px-1.5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors text-[10px] font-semibold"
            >
              -Col
            </button>
            <Sep />
            <button
              type="button" title="Insert signature"
              onMouseDown={(e) => { e.preventDefault(); openSignaturePad() }}
              className="h-7 px-2 flex items-center gap-1 rounded hover:bg-gray-200 text-gray-700 transition-colors text-[11px] font-medium"
            >
              <PenTool className="h-3.5 w-3.5" />Signature
            </button>
          </div>
        )}
      </div>

      {/* ── Document area ── */}
      <div className="flex flex-col sm:flex-row flex-1 min-h-screen bg-slate-200">

        {/* ── Templates — a separate panel to the left of the document, never
            overlapping or sitting inside the report itself ── */}
        <AnimatePresence>
          {showTemplates && (
            <motion.aside
              key="template-sidebar"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="w-full sm:w-[300px] shrink-0 bg-white border-b sm:border-b-0 sm:border-r border-gray-200 flex flex-col"
            >
              {/* Sidebar header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-1.5">
                  <LayoutTemplate className="h-4 w-4 text-blue-500" />
                  <p className="text-sm font-semibold text-gray-800">Templates</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTemplates(false)}
                  className="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search — spans every category, so nothing needs to be scrolled to find */}
              <div className="px-4 pt-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    placeholder="Search templates…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  />
                </div>
              </div>

              {/* Category buttons — hidden while searching, since search spans every category */}
              {!templateSearch && (
                <div className="grid grid-cols-2 gap-1.5 px-4 pt-3">
                  {allCategoryTabs.map((cat) => {
                    const active = templateTab === cat
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setTemplateTab(cat)}
                        className={`px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors truncate ${
                          active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                        }`}
                        title={categoryTabLabel(cat)}
                      >
                        {categoryTabLabel(cat)}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Adding/removing templates happens on the Add Template page,
                  not here — this picker is browse-and-apply only. */}
              <div className="px-4 pt-3">
                <Link
                  href="/add-template"
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />Add Template
                </Link>
              </div>

              {/* Count label */}
              <p className="px-4 pt-3 text-[11px] text-gray-400">
                {(templateSearchResults ?? allTemplates(templateTab)).length} template
                {(templateSearchResults ?? allTemplates(templateTab)).length !== 1 ? "s" : ""}
              </p>

              {/* Template list — single column, scrolls within the sidebar so it
                  never needs to push or overlap the document beside it. */}
              <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto max-h-[50vh] sm:max-h-none">
                {templateSearchResults !== null ? (
                  templateSearchResults.length === 0 ? (
                    <p className="text-center text-xs text-gray-400 py-8">No templates match &ldquo;{templateSearch}&rdquo;.</p>
                  ) : (
                    templateSearchResults.map((tpl) => (
                      <TemplateCard
                        key={tpl.id}
                        tpl={tpl}
                        categoryLabel={categoryTabLabel(tpl.category)}
                        onApply={() => applyTemplate(tpl)}
                      />
                    ))
                  )
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div key={templateTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-2">
                      {allTemplates(templateTab).length === 0 ? (
                        <p className="text-center text-xs text-gray-400 py-8">No templates in this category yet.</p>
                      ) : (
                        allTemplates(templateTab).map((tpl) => (
                          <TemplateCard
                            key={tpl.id}
                            tpl={tpl}
                            onApply={() => applyTemplate(tpl)}
                          />
                        ))
                      )}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── The document itself — untouched by the templates panel above ── */}
        <div className="py-8 px-4 flex-1 min-h-screen">
        <div
          ref={wrapRef}
          className="relative max-w-[794px] mx-auto"
          style={{ minHeight: `${numPages * A4_STRIDE - A4_GAP_PX}px` }}
          onClick={handleBodyClick}
          onPointerDown={handleBodyPointerDown}
        >
          {/* A4 sheet backdrop — one white page per printed sheet, separated by a
              grey gap, with the letterhead header/footer bands marked. Content in
              the overlay flows across these sheets like Word's Print Layout view. */}
          <div aria-hidden className="absolute inset-0 z-0 pointer-events-none">
            {Array.from({ length: numPages }).map((_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 bg-white shadow-xl rounded-sm"
                style={{ top: `${i * A4_STRIDE}px`, height: `${A4_PAGE_PX}px` }}
              >
                {showDoc && study && !isReadOnly && (
                  <>
                    <div className="absolute inset-x-0 border-b border-dashed border-blue-200" style={{ top: `${LETTERHEAD_TOP_PX}px` }} />
                    <div className="absolute inset-x-0 border-t border-dashed border-blue-200" style={{ bottom: `${LETTERHEAD_BOTTOM_PX}px` }} />
                    <span
                      className="absolute right-3 bg-blue-50 text-blue-400 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-blue-100 uppercase tracking-wider"
                      style={{ bottom: `${LETTERHEAD_BOTTOM_PX - 22}px` }}
                    >
                      Page {i + 1} of {numPages}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Content overlay — transparent; sits on top of the sheets */}
          <div
            ref={paperRef}
            className="relative z-10 px-4 sm:px-14"
            style={{ paddingTop: `${LETTERHEAD_TOP_PX}px`, paddingBottom: `${LETTERHEAD_BOTTOM_PX}px` }}
          >

          {/* Patient picker — no URL params */}
          {!hasPatient && !pickerDone && (
            <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-semibold text-blue-900 mb-3">Select patient and study to begin</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Patient</Label>
                  <ComboInput value={selPatient} onChange={setSelPatient} suggestions={patientNames} placeholder="Search patient..." />
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
              {/* Patient info — NON-EDITABLE (except SR. NO), matches the printed report header */}
              <div ref={patientBoxRef} className="select-none mb-5 border-[6px] border-double border-black px-3.5 sm:px-5 py-2.5 sm:py-3.5 flex flex-col sm:flex-row justify-between gap-3 sm:gap-6 text-[13px] font-bold text-gray-900">
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
              <div ref={titleWrapRef} className="flex justify-center mb-6">
                <div
                  ref={titleRef}
                  contentEditable={!isReadOnly}
                  suppressContentEditableWarning
                  spellCheck={false}
                  onFocus={() => { lastActiveRef.current = "heading" }}
                  onBlur={(e) => captureToolbarSelection(e.currentTarget)}
                  title={isReadOnly ? undefined : "Click to edit the study heading"}
                  style={headingFont ? { fontFamily: headingFont } : undefined}
                  className={`text-center font-bold uppercase text-base py-1.5 px-10 min-w-[280px] border-[1.5px] border-gray-700 underline underline-offset-4 tracking-wide text-gray-900 focus:outline-none${
                    isReadOnly ? "" : " hover:bg-blue-50/60 focus:bg-blue-50/60 transition-colors cursor-text"
                  }`}
                />
              </div>

              {/* Report body — editable or read-only depending on mode */}
              <EditorContent
                editor={editor}
                className={`doc-field min-h-[400px] text-sm leading-relaxed text-gray-900${isReadOnly ? " cursor-default select-text" : ""}`}
              />

              {/* Two-doctor signature block — the signature images are drag/resize
                  editable (same mechanism as the pen-tool stamp above), name/
                  credentials text stays fixed */}
              <div ref={sigsRef} className="mt-24 select-none text-gray-900 w-full">
                <SignatureColumns
                  signatories={signatories}
                  layouts={loadedSigLayout}
                  editable={!isReadOnly}
                  onLayoutChange={(idx, layout) => {
                    setLoadedSigLayout((prev) => {
                      const next = [...prev]
                      next[idx] = layout
                      return next
                    })
                  }}
                />
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

          {/* Floating toolbar for a selected signature stamp — nudge buttons
              stay as a precise fallback alongside direct drag/resize */}
          {sigOverlayPos && !isReadOnly && (
            <div
              className="absolute z-20 flex items-center gap-0.5 bg-white border border-gray-200 rounded-lg shadow-lg p-1"
              style={{ top: sigOverlayPos.toolbarTop, left: sigOverlayPos.toolbarLeft }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button type="button" title="Move left" onMouseDown={(e) => { e.preventDefault(); nudgeSig(-4, 0) }} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Move right" onMouseDown={(e) => { e.preventDefault(); nudgeSig(4, 0) }} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Move up" onMouseDown={(e) => { e.preventDefault(); nudgeSig(0, -4) }} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Move down" onMouseDown={(e) => { e.preventDefault(); nudgeSig(0, 4) }} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-600">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <span className="w-px h-4 bg-gray-200 mx-0.5" />
              <button
                type="button"
                title={sigOverlayPos.kind === "doctor" ? "Reset position/size" : "Remove signature"}
                onMouseDown={(e) => { e.preventDefault(); removeSelectedSig() }}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Resize handle — drag to scale the selected stamp (aspect-ratio locked) */}
          {sigOverlayPos && !isReadOnly && (
            <div
              title="Drag to resize"
              onPointerDown={beginResizeSig}
              onClick={(e) => e.stopPropagation()}
              className="absolute z-20 h-3.5 w-3.5 rounded-full bg-blue-600 border-2 border-white shadow cursor-nwse-resize"
              style={{ top: sigOverlayPos.handleTop, left: sigOverlayPos.handleLeft }}
            />
          )}
        </div>
      </div>
      </div>

      <SignaturePadDialog
        key={sigPadKey}
        open={sigPadOpen}
        onClose={() => setSigPadOpen(false)}
        onInsert={insertSignature}
      />
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
