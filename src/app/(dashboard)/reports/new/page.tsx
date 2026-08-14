"use client"

import { Suspense, useRef, useState, useEffect, useCallback, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Download, CheckCircle2, Loader2,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, Share2, Pencil, LayoutTemplate, Minus, Plus, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight,
  Search, X, Upload, PenTool, Trash2, GripVertical, Move, Printer,
  Image as ImageIcon, Strikethrough, Undo2, Redo2,
  Superscript as SuperscriptIcon, Subscript as SubscriptIcon,
  IndentIncrease, IndentDecrease, SeparatorHorizontal, Paintbrush,
  Search as SearchIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { StudyComboInput } from "@/components/combo-input"
import { useRole } from "@/lib/role-context"
import { useConfirm } from "@/components/confirm-dialog"
import { motion, AnimatePresence } from "framer-motion"
import { REPORT_TEMPLATES, ReportTemplate, TemplateCategory, fetchStudyHeadings } from "@/lib/report-templates"
import {
  reportHeaderHtml, reportTitleHtml, printShellHtml, getDisplayTitle,
  LETTERHEAD_TOP_PX, LETTERHEAD_BOTTOM_PX, A4_PAGE_PX, MM_TO_PX,
  BAND_HEIGHT_MIN_PX, BAND_HEIGHT_MAX_PX, REPORT_BODY_STYLE, REPORT_SIGS_STYLE,
  DEFAULT_REPORT_FONT, type StudyHeadingIndex,
} from "@/lib/report-layout"
import { fetchSignatories, signatureColumnsHtml, type Signatory, type SignatureLayout } from "@/lib/report-signatures"
import { buildReportDocxBase64 } from "@/lib/report-docx"
import { TemplateCard, categoryTabLabel } from "@/components/template-card"
import { stripTrailingSignatureBlock, countSignatoriesIn } from "@/lib/doc-import"
import { SignatureColumns } from "@/components/signature-columns"
import { TableGridPicker } from "@/components/table-grid-picker"
import { AddTemplateDialog } from "@/components/add-template-dialog"
import { FontPicker } from "@/components/font-picker"
import { EditorMenus } from "@/components/editor-menus"
import { ColorPicker, SymbolPicker } from "@/components/editor-pickers"
import { ParagraphMenu } from "@/components/paragraph-menu"
import { FindReplacePanel } from "@/components/find-replace-panel"
import { QuickPhrases } from "@/components/quick-phrases"
import { RibbonTabBar, RibbonBar, RibbonGroup, type RibbonTab } from "@/components/ribbon"
import { StyleGallery, type ReportStyle } from "@/components/style-gallery"
import { SignaturePadDialog } from "@/components/signature-pad-dialog"
import { useEditor, EditorContent } from "@tiptap/react"
import type { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { TextStyleKit } from "@tiptap/extension-text-style"
import TextAlign from "@tiptap/extension-text-align"
import Superscript from "@tiptap/extension-superscript"
import Subscript from "@tiptap/extension-subscript"
import { CustomTable as Table, TABLE_FONT_SCALE_MIN, applyTableScaleToDom } from "@/lib/tiptap-custom-table"
import { TableRowHeight } from "@/lib/tiptap-table-row-height"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import Placeholder from "@tiptap/extension-placeholder"
import { SignatureExtension } from "@/lib/tiptap-signature-extension"
import { ReportImageExtension } from "@/lib/tiptap-image-extension"
import { fitInsertedSize } from "@/lib/report-image"
import { prepareImageFile } from "@/lib/image-effects"
import { PaginationExtension, computeBodyPageDecorations, paginationPluginKey, tableBodyRows, PAGE_SPACER_ROW_ATTR } from "@/lib/tiptap-pagination-extension"
import { DecorationSet, type EditorView } from "@tiptap/pm/view"
import type { Node as PMNode } from "@tiptap/pm/model"
import { LineHeight } from "@/lib/tiptap-line-height-extension"
import { ParagraphFormat } from "@/lib/tiptap-paragraph-format-extension"
import { ListStyle, BULLET_STYLES, ORDERED_STYLES } from "@/lib/tiptap-list-style-extension"
import { CellFormat } from "@/lib/tiptap-cell-format-extension"
import { ReportSearch } from "@/lib/tiptap-search-extension"
import {
  TrackChanges, TrackInsertMark, TrackDeleteMark, acceptTrackedHtml,
} from "@/lib/tiptap-track-changes-extension"
import { CommentMark, stripComments } from "@/lib/tiptap-comment-extension"
import { TableMap, findTable } from "@tiptap/pm/tables"
import { DOMSerializer } from "@tiptap/pm/model"
import { reportShareUrl } from "@/lib/share-links"

// ── HTML ↔ DOCX formatting helpers ───────────────────────────────────────────

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
  // Repeated blank paragraphs are significant in an imported Word document;
  // they must survive loading just like repeated typed Enter presses do.
  return doc.body.innerHTML
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
  const cleanNew = stripEditedSpans(newHtml)

  const parser = new DOMParser()
  const origDoc = parser.parseFromString(cleanOrig, "text/html")
  const newDoc = parser.parseFromString(cleanNew, "text/html")

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
  patientBoxFont?: string
  signatories: Signatory[]
  signatureLayouts?: (SignatureLayout | null | undefined)[]
  headerPx?: number
  footerPx?: number
  /** Sheets the editor's own pagination settled on — printed as "Page N of M". */
  pageCount?: number
  /** Blank lines the doctor left above the patient box — Word prints these. */
  topSpacerPx?: number
}): string {
  const { patient, study, body, age, gender, refBy, date, srNo, titleFont, patientBoxFont, signatories, signatureLayouts, headerPx, footerPx, pageCount, topSpacerPx } = opts
  const displayDate = date || new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  return printShellHtml(`Report – ${patient}`, `
${reportHeaderHtml({ name: patient, refBy, date: displayDate, age, gender, srNo }, patientBoxFont)}
${topSpacerPx ? `<div style="height:${topSpacerPx}px"></div>` : ""}
${reportTitleHtml(study, titleFont)}
<div class="doc-field body" style="${REPORT_BODY_STYLE}">${body}</div>
<div style="${REPORT_SIGS_STYLE}">${signatureColumnsHtml(signatories, signatureLayouts)}</div>`, "",
    headerPx !== undefined ? headerPx / MM_TO_PX : undefined,
    footerPx !== undefined ? footerPx / MM_TO_PX : undefined,
    pageCount)
}

// Floors for the whole-table corner drag: effectively none, matching the
// `cellMinWidth: 1` the Table extension is configured with. A real floor here
// would be a floor on the DRAG rather than on the table — the cell's own text
// already stops a column or row from collapsing below what it needs to show
// (both CSS widths and heights on table parts are minimums), so a bigger number
// only ever stopped a doctor from pulling an oversized grid back down to size.
const MIN_TABLE_COL_PX = 1
const MIN_TABLE_ROW_PX = 1

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

// ── Insert picked / pasted / dropped images into the report body ───────────────
// A module-level function taking the live `view` rather than a component
// callback: the paste/drop handlers are wired into useEditor's config, which
// only closes over the render the editor was CREATED on (the same reason the
// table-handle sync goes through a ref) — going through the view keeps every
// insertion working against current editor state instead of a stale closure.
//
// Images are inserted "In Line with Text" (Word's own default) at the caret or
// the drop point, at natural size capped to the text column, and can then be
// re-wrapped/cut-out/dragged from the picture toolbar that appears on click.
async function insertImageFiles(view: EditorView, files: File[], dropPos?: number) {
  const type = view.state.schema.nodes.reportImage
  if (!type) return
  const images = files.filter((f) => f.type.startsWith("image/"))

  const insertAt = (node: PMNode, at: number) => {
    try {
      view.dispatch(view.state.tr.insert(at, node).scrollIntoView())
      return true
    } catch {
      return false
    }
  }

  for (let i = 0; i < images.length; i++) {
    try {
      const prepared = await prepareImageFile(images[i])
      const node = type.create({
        src: prepared.src,
        ...fitInsertedSize(prepared.width, prepared.height),
        wrap: "inline",
        left: 0,
        top: 0,
      })
      // An inline atom is one position wide, so successive files from a
      // multi-file selection land after one another rather than in reverse.
      const at = dropPos != null ? dropPos + i : view.state.selection.from
      // A drop point can land somewhere an inline node isn't allowed (between
      // blocks, on a table). Rather than losing the image, fall back to the
      // caret — which is always a valid text position.
      if (!insertAt(node, at)) insertAt(node, view.state.selection.from)
    } catch {
      // One unreadable file shouldn't abandon the rest of the selection.
    }
  }
}

// ── Patient-box field, editable in place ──────────────────────────────────────
// Same click-"edit"-pencil / type / blur-or-Enter-to-save pattern the SR. NO
// field already used before any of the other fields were editable — kept as
// one shared component instead of four near-identical copies since only the
// label, value and save handler actually differ between NAME/REF. BY/DATE/AGE.
function EditableInfoLine({
  label, value, editing, isReadOnly, onStartEdit, onChange, onCommit, onCancel, uppercase = true, placeholder, inputMode,
}: {
  label: string
  value: string
  editing: boolean
  isReadOnly: boolean
  onStartEdit: () => void
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  uppercase?: boolean
  placeholder?: string
  inputMode?: "text" | "numeric"
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0">{label} -</span>
      {!isReadOnly && editing ? (
        <span className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            type="text"
            inputMode={inputMode}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit()
              if (e.key === "Escape") onCancel()
            }}
            onBlur={onCommit}
            className="w-full min-w-[6ch] border-0 border-b border-blue-400 text-[13px] font-bold text-gray-900 bg-transparent focus:outline-none px-0 py-px"
            placeholder={placeholder}
          />
        </span>
      ) : (
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">
            {value ? (uppercase ? value.toUpperCase() : value) : <span className="text-gray-400 italic font-normal">not set</span>}
          </span>
          {!isReadOnly && (
            <button
              type="button"
              onClick={onStartEdit}
              className="shrink-0 flex items-center gap-0.5 text-blue-500 hover:text-blue-700 transition-colors"
              title={`Edit ${label}`}
            >
              <Pencil className="h-2.5 w-2.5" />
              <span className="text-[10px] underline underline-offset-2">edit</span>
            </button>
          )}
        </span>
      )}
    </div>
  )
}


// ── Main editor ───────────────────────────────────────────────────────────────

function ReportEditorInner() {
  const { user } = useRole()
  const { confirm, notify } = useConfirm()
  const sp = useSearchParams()
  const router = useRouter()

  const paramPatient = sp.get("patient") ?? ""
  const paramStudy = sp.get("study") ?? ""
  const paramRefBy = sp.get("refBy") ?? ""
  const paramDate = sp.get("date") ?? ""
  const paramAge = sp.get("age") ?? ""
  const paramGender = sp.get("gender") ?? ""
  const paramSrNo = sp.get("srNo") ?? ""
  const paramContact = sp.get("contact") ?? ""
  const paramId = sp.get("id") ?? ""   // MongoDB _id of the patient
  const paramSidx = Math.max(0, parseInt(sp.get("sidx") ?? "0", 10) || 0)  // which study of the patient
  const paramLoad = sp.get("load") === "1"  // edit mode — loads + editable
  const paramView = sp.get("view") === "1"  // view mode — loads, read-only
  const isReadOnly = paramView && !paramLoad

  const hasPatient = !!paramPatient

  // Direct/manual entry without a patient picked via Dashboard, Patients, or
  // Reports isn't a supported flow — bounce back to the patient list instead
  // of showing a bare "pick a patient" form.
  useEffect(() => {
    if (!hasPatient) router.replace("/patients")
  }, [hasPatient, router])

  // For patient with no study yet (came from registration without study)
  const [extraStudy, setExtraStudy] = useState("")

  const [currentStudy, setCurrentStudy] = useState(() => paramStudy)

  useEffect(() => {
    if (paramStudy) {
      setCurrentStudy(paramStudy)
    }
  }, [paramStudy])

  // Resolved values
  const patient = paramPatient
  const study = currentStudy || extraStudy
  const refBy = paramRefBy
  const date = paramDate
  const age = paramAge
  const gender = paramGender
  const contact = paramContact
  const srNo = paramSrNo

  const [localSrNo, setLocalSrNo] = useState(paramSrNo)
  const [editingSrNo, setEditingSrNo] = useState(false)

  // Patient-box fields editable in place, same pattern as SR. NO above: an
  // "edit" pencil swaps the line for an input, and blur/Enter PATCHes the
  // change straight through to the patient's real registration record (so it
  // stays correct everywhere that patient is shown — other studies, bills,
  // the patient list — not just this one report). Report date is the one
  // exception: it isn't a registration field at all, just whatever date this
  // report happened to be opened with, so it's saved as its own per-study
  // override instead of touching the patient record.
  const [localPatientName, setLocalPatientName] = useState(patient)
  const [editingPatientName, setEditingPatientName] = useState(false)
  const [localRefBy, setLocalRefBy] = useState(refBy)
  const [editingRefBy, setEditingRefBy] = useState(false)
  const [localAge, setLocalAge] = useState(age)
  const [editingAge, setEditingAge] = useState(false)
  const [localGender, setLocalGender] = useState(gender)
  const [editingGender, setEditingGender] = useState(false)
  const [localReportDate, setLocalReportDate] = useState(date)
  const [editingReportDate, setEditingReportDate] = useState(false)

  // Template picker
  const [showTemplates, setShowTemplates] = useState(false)
  const [templateTab, setTemplateTab] = useState<string>(() => {
    const s = (paramStudy || "").toLowerCase()
    if (s.includes("x") && (s.includes("ray") || s.includes("-ray"))) return "xray"
    if (["cbc", "lft", "kft", "blood", "thyroid", "path", "urine", "hb"].some((k) => s.includes(k))) return "pathology"
    if (/doppler|carotid|venous|arterial|portal|renal artery/.test(s)) return "doppler"
    return "usg"
  })
  const [templateSearch, setTemplateSearch] = useState("")
  // Clinic-added templates (imported from Word here or on the Add Template
  // page), merged in alongside the built-in bundled ones. Removing one still
  // happens on that page; this panel adds and applies.
  // Keyed by category string rather than the narrow 4-value union, since the
  // clinic can create its own categories from that page.
  const [customTemplates, setCustomTemplates] = useState<Record<string, ReportTemplate[]>>({})
  const [templatesLoaded, setTemplatesLoaded] = useState(false)
  const [addTemplateOpen, setAddTemplateOpen] = useState(false)

  // The templates panel sticks below the toolbar and scrolls on its own, so how
  // far down it starts is exactly where the stuck toolbar ends. Measured rather
  // than hard-coded, since the toolbar wraps to two rows on narrow windows.
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null)
  const [toolbarBottom, setToolbarBottom] = useState(90)
  useEffect(() => {
    const el = stickyHeaderRef.current
    if (!el) return
    const measure = () => {
      // `top` is negative (it cancels the main scroller's padding), so the
      // toolbar's resting edge once stuck is height + that offset.
      const stuckTop = parseFloat(getComputedStyle(el).top) || 0
      setToolbarBottom(Math.max(0, el.offsetHeight + stuckTop))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [showTemplates])

  // Refetched every time the panel is opened, not once per session.
  //
  // A template re-imported meanwhile — from the Add Template page, another tab,
  // or another machine in the clinic — otherwise stayed stale here for as long
  // as the editor was open, and applying it silently used the OLD body. That is
  // how a template whose sign-off had since been re-imported with both doctors
  // kept coming out with one. `templatesLoaded` now only drives the first-load
  // state, so the list already on screen stays visible while it refreshes.
  useEffect(() => {
    if (!showTemplates) return
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => {
        const grouped: Record<string, ReportTemplate[]> = {}
        for (const t of d.templates ?? []) {
          const cat = String(t.category)
          if (!grouped[cat]) grouped[cat] = []
          grouped[cat].push({ id: t._id, _id: t._id, name: t.name, heading: t.heading, preview: t.preview, body: t.body, signatureCount: t.signatureCount, preserveSignature: t.preserveSignature })
        }
        setCustomTemplates(grouped)
      })
      .catch(() => { })
      .finally(() => setTemplatesLoaded(true))
  }, [showTemplates])

  // Study -> template heading, for a report that has no heading of its own.
  // Fetched unconditionally (unlike the full template list above, which only
  // loads when the Templates panel is opened) because the heading is needed to
  // render the document itself, not just to browse templates.
  const [studyHeadings, setStudyHeadings] = useState<StudyHeadingIndex>({})
  const [headingsLoaded, setHeadingsLoaded] = useState(false)
  useEffect(() => {
    fetchStudyHeadings()
      .then(setStudyHeadings)
      .finally(() => setHeadingsLoaded(true))
  }, [])

  const [signatories, setSignatories] = useState<Signatory[]>([])
  const [templateSignatureCount, setTemplateSignatureCount] = useState<number | undefined>()
  const reportSignatories = templateSignatureCount === undefined
    ? signatories
    : signatories.slice(0, templateSignatureCount)
  useEffect(() => { fetchSignatories().then(setSignatories) }, [])

  // What the "Signature" button offers before anyone draws anything: every
  // signature uploaded on the Signatures page, this report's own signatories
  // first (they are ordered by `order`), the rest after them for the reports
  // they don't normally sign. A signatory with no image uploaded yet has
  // nothing to offer and is left out.
  const savedSignatures = useMemo(
    () => signatories
      .filter((s) => !!s.signatureImage)
      .map((s) => ({ id: String(s._id), label: s.name, image: s.signatureImage })),
    [signatories]
  )

  const BUILTIN_CATS: TemplateCategory[] = ["usg", "doppler", "xray", "pathology", "obstetric"]
  const customCategoryKeys = Object.keys(customTemplates).filter((c) => !(BUILTIN_CATS as string[]).includes(c))
  // Every browsable category — the 5 built-ins plus any the clinic has created.
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
  const [fontSize, setFontSize] = useState(12)
  const [fontFamily, setFontFamily] = useState("Cambria")
  // Last colours used — they only tint the toolbar's own swatches, so the
  // buttons show what they will apply, exactly like Word's.
  const [textColor, setTextColor] = useState<string | null>(null)
  const [highlightColor, setHighlightColor] = useState<string | null>(null)
  // The document is drawn 1:1. Everything that MEASURES it (pagination, the
  // band/table/image drags) still divides by this factor, because those
  // measurements come from getBoundingClientRect — screen pixels, which only
  // equal layout pixels while the zoom is 1. Kept as a constant rather than
  // deleted so the maths stays correct if a zoom control comes back.
  const zoom = 1
  const zoomRef = useRef(1)
  /** Find & replace panel: null = closed. */
  const [findMode, setFindMode] = useState<"find" | "replace" | null>(null)
  /** Which ribbon tab is showing (Word remembers Home between documents). */
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>("Home")
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved">("idle")
  // Status-bar counts. Recomputed from the editor on a debounce rather than on
  // every keystroke: this component renders the whole document, and counting on
  // each transaction made typing visibly heavier.
  const [docStats, setDocStats] = useState({ words: 0, chars: 0 })
  // The heading is still plain text under the hood (getDocTitle() reads
  // .innerText, and print/DOCX generation always render it bold+underlined+
  // centered regardless of anything else typed into it) — but unlike the
  // rest of the heading's formatting, the chosen font family is tracked here
  // as its own value so it can actually persist through save/print/DOCX.
  const [headingFont, setHeadingFont] = useState<string | undefined>(undefined)
  // Same idea for the patient box: its six lines are React-rendered values
  // (not contentEditable), so there's no per-character formatting to apply —
  // the box carries one font family for everything inside it, tracked here so
  // it persists through save and reaches the view modal, print and DOCX.
  const [patientBoxFont, setPatientBoxFont] = useState<string | undefined>(undefined)

  const showDoc = hasPatient
  const needStudy = showDoc && !study

  const titleRef = useRef<HTMLDivElement | null>(null)
  const originalBodyRef = useRef<string>("")
  const submittedRef = useRef(false)

  // Which region the toolbar's next action should target — heading (plain
  // contentEditable + execCommand), body (Tiptap), or the patient box (React
  // fields, whole-box font only). Toolbar buttons use onMouseDown+preventDefault
  // so focus never actually leaves whichever region is currently focused; a
  // native <select> does steal focus though, so this flag is what lets the
  // font/spacing dropdowns route correctly even after that.
  const lastActiveRef = useRef<"heading" | "body" | "patientBox" | "signature">("body")

  // Which of the sign-off's four contentEditable blocks (name/credentials ×
  // two doctors) the caret was last in. The heading is a single fixed element
  // so titleRef alone identifies it; the signature block is not, so the target
  // has to be remembered rather than looked up.
  const activeSigTextRef = useRef<HTMLElement | null>(null)

  // The editor's own keymap runs inside the useEditor config below, which is
  // built before the editor (and before paginate) exists — these two refs are
  // how that handler reaches both once they do.
  const editorRef = useRef<Editor | null>(null)
  const schedulePaginateRef = useRef<() => void>(() => { })

  // Heading-only selection capture — Tiptap keeps its own selection
  // internally even once DOM focus moves to a toolbar control, so unlike
  // execCommand, body-targeted commands need no equivalent save/restore.
  const toolbarSelRangeRef = useRef<Range | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    editable: !isReadOnly,
    extensions: [
      StarterKit.configure({
        // Word's Heading 1-3, driven by the Styles gallery. Kept to three:
        // a report has sections and sub-sections, not an outline.
        heading: { levels: [1, 2, 3] },
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        code: false,
      }),
      TextStyleKit.configure({ lineHeight: false }),
      // cm², mm³, m/s² — every other line of a sonography report needs these.
      Superscript,
      Subscript,
      LineHeight.configure({ types: ["paragraph"] }),
      ParagraphFormat.configure({ types: ["paragraph"] }),
      ListStyle,
      CellFormat,
      ReportSearch,
      TrackChanges,
      TrackInsertMark,
      TrackDeleteMark,
      CommentMark,
      TextAlign.configure({ types: ["paragraph"] }),
      Table.configure({ resizable: true, handleWidth: 8, cellMinWidth: 1 }),
      TableRowHeight,
      TableHeader,
      TableCell,
      SignatureExtension,
      ReportImageExtension,
      PaginationExtension,
      Placeholder.configure({ placeholder: "Start typing the report here..." }),
    ],
    editorProps: {
      // Screenshots and scans usually arrive on the clipboard, and photos by
      // drag-and-drop — both go through the same insert path as the toolbar's
      // Image button so every image in a report is a reportImage node with the
      // wrap/effects toolbar, never a bare pasted <img> the exports can't place.
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"))
        if (!files.length) return false
        event.preventDefault()
        void insertImageFiles(view, files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"))
        if (!files.length) return false
        event.preventDefault()
        const coords = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
        void insertImageFiles(view, files, coords?.pos)
        return true
      },
      handleKeyDown: (view, event) => {
        // Word's Tab: indent the paragraph, or move a list item a level in/out.
        // Inside a table Tab still means "next cell", which prosemirror-tables
        // owns — so that case is left alone deliberately.
        if (event.key === "Tab" && !findTable(view.state.selection.$anchor)) {
          const ed = editorRef.current
          if (ed) {
            event.preventDefault()
            const inList = ed.isActive("listItem")
            if (event.shiftKey) {
              if (inList) ed.chain().focus().liftListItem("listItem").run()
              else ed.chain().focus().changeParagraphIndent(-1).run()
            } else {
              if (inList) ed.chain().focus().sinkListItem("listItem").run()
              else ed.chain().focus().changeParagraphIndent(1).run()
            }
            schedulePaginateRef.current()
            return true
          }
        }
        if (event.key === "ArrowUp") {
          const { $from } = view.state.selection
          if ($from.pos <= 2 || view.endOfTextblock("up")) {
            if (titleRef.current) {
              titleRef.current.focus()
              const sel = window.getSelection()
              if (sel) {
                const range = document.createRange()
                range.selectNodeContents(titleRef.current)
                range.collapse(false)
                sel.removeAllRanges()
                sel.addRange(range)
              }
              return true
            }
          }
        }
        return false
      },
    },
    onFocus: () => { lastActiveRef.current = "body" },
    onSelectionUpdate: ({ editor }) => syncTableResizeHandleRef.current(editor),
    onUpdate: ({ editor }) => syncTableResizeHandleRef.current(editor),
  })

  useEffect(() => {
    editor?.setEditable(!isReadOnly)
    editorRef.current = editor ?? null
  }, [editor, isReadOnly])

  // Word/character count for the status line, refreshed a beat after typing
  // stops. `editor.on("update")` rather than the useEditor option above so the
  // debounce timer can be cleaned up with the subscription.
  useEffect(() => {
    if (!editor) return
    let timer = 0
    const recount = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const text = editor.getText({ blockSeparator: " " })
        const words = text.trim() ? text.trim().split(/\s+/).length : 0
        setDocStats({ words, chars: text.length })
      }, 400)
    }
    recount()
    editor.on("update", recount)
    return () => { window.clearTimeout(timer); editor.off("update", recount) }
  }, [editor])

  // Saved per-report drag/resize override for the two doctor-signature images
  // (index 0/1 matches the columns; overrideImage holds custom drawn dataUrls)
  const [loadedSigLayout, setLoadedSigLayout] = useState<(SignatureLayout | null | undefined)[]>([
    { hidden: true },
    { hidden: true }
  ])

  const paperRef = useRef<HTMLDivElement | null>(null)
  // Pagination: the document is laid out as real A4 sheets — content that would
  // fall into a page's footer band is pushed to the top of the next sheet, just
  // like Microsoft Word's Print Layout view.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const patientBoxRef = useRef<HTMLDivElement | null>(null)

  // ── Whole-table resize handle (report body tables) ──────────────────────
  // prosemirror-tables' native column-resize plugin only reacts to the mouse
  // sitting exactly on a column border, which is easy to miss — this adds a
  // Word-style handle just outside a table's bottom-right corner, visible the
  // moment the caret is anywhere inside it, so a table can be widened/
  // narrowed as a whole (proportionally across every column) without hunting
  // for a 1px-wide edge. Kept as a ref-of-a-function (rather than calling a
  // plain function from the useEditor config below) because useEditor's
  // callbacks close over the render they were created on — this indirection
  // lets the sync logic always see the latest isReadOnly/wrapRef.
  const activeTableElRef = useRef<HTMLTableElement | null>(null)
  // The active table's box relative to wrapRef — three handles are positioned
  // from it (right edge = widths, bottom edge = row heights, corner = both).
  const [tableRect, setTableRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [draggingTableSize, setDraggingTableSize] = useState<{ width: number; height: number } | null>(null)
  const syncTableResizeHandleRef = useRef<(editor: Editor) => void>(() => { })
  const titleWrapRef = useRef<HTMLDivElement | null>(null)
  const sigsRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const [numPages, setNumPages] = useState(1)

  // Resizable top/bottom letterhead bands — drag either dashed line up/down
  // on the page to reserve more/less blank space for pre-printed letterhead
  // stationery. Persisted per report (draft + saved report), and fed into
  // pagination, print and the shared PDF so all three stay WYSIWYG with
  // whatever's dragged here.
  const [headerPx, setHeaderPx] = useState<number>(LETTERHEAD_TOP_PX)
  const [footerPx, setFooterPx] = useState<number>(LETTERHEAD_BOTTOM_PX)
  const [patientBoxOffsetX, setPatientBoxOffsetX] = useState(0)
  const [patientBoxOffsetY, setPatientBoxOffsetY] = useState(0)
  const [patientBoxWidthPx, setPatientBoxWidthPx] = useState<number | undefined>(undefined)

  // Word puts an empty paragraph above the patient table, and that is where the
  // caret sits when a report opens: pressing Enter there pushes the table, the
  // heading and the whole report down the page. The boxes here are React
  // elements rather than document nodes, so the equivalent is a run of blank
  // lines above them — a count, with a real caret to add and remove them.
  const [topSpacerLines, setTopSpacerLines] = useState(0)
  const [titleBoxOffsetX, setTitleBoxOffsetX] = useState(0)
  const [titleBoxOffsetY, setTitleBoxOffsetY] = useState(0)
  const [titleBoxWidthPx, setTitleBoxWidthPx] = useState<number | undefined>(undefined)

  const beginDragPatientBox = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch { }
    const startX = e.clientX
    const startY = e.clientY
    const baseOffsetX = patientBoxOffsetX
    const baseOffsetY = patientBoxOffsetY
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault()
      const dx = (ev.clientX - startX) / zoomRef.current
      const dy = (ev.clientY - startY) / zoomRef.current
      setPatientBoxOffsetX(baseOffsetX + dx)
      setPatientBoxOffsetY(baseOffsetY + dy)
    }
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId) } catch { }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const beginResizePatientBox = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch { }
    const startX = e.clientX
    const baseW = patientBoxRef.current?.getBoundingClientRect().width || 680
    const onMove = (ev: PointerEvent) => {
      const dw = ((ev.clientX - startX) / zoomRef.current) * 2
      setPatientBoxWidthPx(Math.max(300, Math.min(800, Math.round(baseW + dw))))
    }
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId) } catch { }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const beginDragTitleBox = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch { }
    const startX = e.clientX
    const startY = e.clientY
    const baseOffsetX = titleBoxOffsetX
    const baseOffsetY = titleBoxOffsetY
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault()
      const dx = (ev.clientX - startX) / zoomRef.current
      const dy = (ev.clientY - startY) / zoomRef.current
      setTitleBoxOffsetX(baseOffsetX + dx)
      setTitleBoxOffsetY(baseOffsetY + dy)
    }
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId) } catch { }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const beginResizeTitleBox = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch { }
    const startX = e.clientX
    const baseW = titleRef.current?.getBoundingClientRect().width || 280
    const onMove = (ev: PointerEvent) => {
      const dw = ((ev.clientX - startX) / zoomRef.current) * 2
      setTitleBoxWidthPx(Math.max(160, Math.min(650, Math.round(baseW + dw))))
    }
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId) } catch { }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Positions the floating resize handle against wrapRef, same convention as
  // the signature overlay (updateSigOverlayPos) below.
  const updateTableHandlePos = (tableEl: HTMLElement) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const wrapRect = wrap.getBoundingClientRect()
    const t = tableEl.getBoundingClientRect()
    setTableRect({
      top: t.top - wrapRect.top,
      left: t.left - wrapRect.left,
      width: t.width,
      height: t.height,
    })
  }

  // Runs on every selection/doc change: shows the handle against whichever
  // table the caret is currently inside (any cell, any depth), or hides it
  // once the caret leaves every table. Refreshed every render (not just on
  // mount) via this effect so it always closes over the latest isReadOnly —
  // the useEditor config above only wires the ref up once, at editor
  // creation, and calls through `.current` to reach whatever's assigned here.
  useEffect(() => {
    syncTableResizeHandleRef.current = (editorInst: Editor) => {
      if (isReadOnly) { activeTableElRef.current = null; setTableRect(null); return }
      const found = findTable(editorInst.state.selection.$anchor)
      if (!found) { activeTableElRef.current = null; setTableRect(null); return }
      const wrapperDom = editorInst.view.nodeDOM(found.pos) as HTMLElement | null
      const tableEl = wrapperDom?.querySelector("table") as HTMLTableElement | null
      if (!tableEl) { activeTableElRef.current = null; setTableRect(null); return }
      activeTableElRef.current = tableEl
      updateTableHandlePos(tableEl)
    }
  })

  // Commits the drag's final widths as real column widths on the table node
  // (the same `colwidth` cell attribute prosemirror-tables' own column-border
  // drag writes — see updateColumnWidth in prosemirror-tables/src/columnresize.ts)
  // so the new sizing is part of the saved document, not just a visual tweak
  // that would revert the next time this report is opened.
  const commitTableColumnWidths = (tableEl: HTMLTableElement, newWidths: number[]) => {
    if (!editor) return
    const pos = editor.view.posAtDOM(tableEl, 0)
    const found = findTable(editor.state.doc.resolve(pos))
    if (!found) return
    const { node: table, start } = found
    const map = TableMap.get(table)
    const tr = editor.state.tr
    for (let col = 0; col < map.width; col++) {
      const width = newWidths[col]
      if (width == null) continue
      for (let row = 0; row < map.height; row++) {
        const mapIndex = row * map.width + col
        // A cell that also occupies the row above (rowspan) already had its
        // width set there — skip it instead of writing the same column twice.
        if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) continue
        const cellPos = map.map[mapIndex]
        const cell = table.nodeAt(cellPos)
        if (!cell) continue
        const attrs = cell.attrs
        const index = attrs.colspan === 1 ? 0 : col - map.colCount(cellPos)
        if (attrs.colwidth && attrs.colwidth[index] === width) continue
        const colwidth = attrs.colwidth ? attrs.colwidth.slice() : new Array(attrs.colspan).fill(0)
        colwidth[index] = width
        tr.setNodeMarkup(start + cellPos, undefined, { ...attrs, colwidth })
      }
    }
    if (tr.docChanged) editor.view.dispatch(tr)
  }

  // A table dragged back out to the full text column gets its width attribute
  // CLEARED rather than pinned to that exact pixel count: pinned, it stops
  // being a full-width table forever (it no longer follows a header/footer
  // resize, a different paper width, or the print column), and the doctor has
  // no way to undo the pin except by dragging to a pixel-perfect match.
  const commitTableWidth = (tableEl: HTMLTableElement, targetWidth: number) => {
    if (!editor) return
    const pos = editor.view.posAtDOM(tableEl, 0)
    const found = findTable(editor.state.doc.resolve(pos))
    if (!found) return
    const { node: table, pos: tablePos } = found
    const available = tableEl.parentElement?.clientWidth ?? 0
    const widthStr = available && targetWidth >= available - 1 ? null : `${Math.round(targetWidth)}px`
    if ((table.attrs.width ?? null) === widthStr) return
    const tr = editor.state.tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, width: widthStr })
    if (tr.docChanged) editor.view.dispatch(tr)
  }

  // Commits the drag's final row heights onto the row nodes (see
  // TableRowHeight) — the vertical counterpart to commitTableColumnWidths, and
  // needed for the same reason: without writing them into the document, a
  // resized row is a DOM-only tweak that disappears the next time the report
  // is opened.
  // ── Table type scale (the vertical half of a whole-table resize) ─────────
  // Reads whatever scale the table is currently drawn at, from the element
  // rather than the document: mid-drag the live value is an inline style that
  // hasn't been committed yet, and both places spell it the same way.
  const getTableFontScale = (tableEl: HTMLTableElement): number => {
    const inline = tableEl.style.fontSize.match(/^([\d.]+)em$/)
    if (inline) {
      const n = parseFloat(inline[1])
      if (Number.isFinite(n) && n > 0) return Math.min(1, n)
    }
    if (!editor) return 1
    try {
      const found = findTable(editor.state.doc.resolve(editor.view.posAtDOM(tableEl, 0)))
      const k = found?.node.attrs.fontScale as number | null | undefined
      return k && k > 0 ? Math.min(1, k) : 1
    } catch { return 1 }
  }

  const applyTableFontScale = (tableEl: HTMLTableElement, scale: number) => {
    applyTableScaleToDom(tableEl, scale)
  }

  const commitTableFontScale = (tableEl: HTMLTableElement, scale: number) => {
    if (!editor) return
    const pos = editor.view.posAtDOM(tableEl, 0)
    const found = findTable(editor.state.doc.resolve(pos))
    if (!found) return
    const { node: table, pos: tablePos } = found
    // Rounded to whole percent: a scale is a document value a doctor may read
    // back in the saved HTML, and 0.7231 carries no more meaning than 0.72.
    const next = scale >= 1 ? null : Math.round(scale * 100) / 100
    if ((table.attrs.fontScale ?? null) === next) return
    // Dispatching is enough to update the element too: the plugin in
    // tiptap-custom-table.ts syncs every table's scale onto its own DOM after
    // each update, from the document, which is what keeps the live drag's
    // uncommitted style and the committed attribute from ever disagreeing.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, fontScale: next }))
  }

  // `null` for a row means "no height of its own" — the row is cleared back to
  // whatever its text needs. `undefined` means "leave this row alone".
  const commitTableRowHeights = (tableEl: HTMLTableElement, newHeights: (number | null)[]) => {
    if (!editor) return
    const pos = editor.view.posAtDOM(tableEl, 0)
    const found = findTable(editor.state.doc.resolve(pos))
    if (!found) return
    const { node: table, start } = found
    const tr = editor.state.tr
    // `offset` is relative to the table's content start, the same basis
    // `start` is expressed in — so `start + offset` is the row's own position.
    table.forEach((rowNode, offset, index) => {
      if (index >= newHeights.length) return
      const height = newHeights[index] ?? null
      if ((rowNode.attrs.height ?? null) === height) return
      tr.setNodeMarkup(start + offset, undefined, { ...rowNode.attrs, height })
    })
    if (tr.docChanged) editor.view.dispatch(tr)
  }

  // ── Reset a table to its natural size ────────────────────────────────────
  // Drops every stored size on the table under the caret: the table node's own
  // width, its type scale, the `colwidth` on each cell and the height on each
  // row. Needed as a single action because the drag handles are proportional —
  // once a table has been dragged several pages tall, dragging it back down
  // means starting each new drag from a corner that has scrolled off screen, so
  // "make this fit on one page again" was effectively unreachable. The table
  // falls back to 100% width, full-size text, and rows exactly as tall as their
  // text.
  const resetTableSize = () => {
    if (!editor) return
    const found = findTable(editor.state.selection.$anchor)
    if (!found) return
    const { node: table, pos: tablePos, start } = found
    const tr = editor.state.tr
    // setNodeMarkup never changes a node's size, so every position taken from
    // the pre-transaction document stays valid across all of these writes.
    if (table.attrs.width != null || table.attrs.fontScale != null) {
      tr.setNodeMarkup(tablePos, undefined, { ...table.attrs, width: null, fontScale: null })
    }
    table.forEach((rowNode, rowOffset) => {
      if (rowNode.attrs.height != null) {
        tr.setNodeMarkup(start + rowOffset, undefined, { ...rowNode.attrs, height: null })
      }
      rowNode.forEach((cellNode, cellOffset) => {
        if (cellNode.attrs.colwidth) {
          tr.setNodeMarkup(start + rowOffset + 1 + cellOffset, undefined, { ...cellNode.attrs, colwidth: null })
        }
      })
    })
    // Animated back to full size (rather than snapping) so it reads as "this
    // table was un-shrunk", not "something replaced my table". The class has to
    // go on BEFORE the dispatch, because the dispatch is what puts the table's
    // type back — see the sync plugin in tiptap-custom-table.ts.
    const tableEl = activeTableElRef.current
    tableEl?.classList.add("tbl-resizing")
    if (tr.docChanged) editor.view.dispatch(tr)
    if (tableEl) {
      window.setTimeout(() => {
        tableEl.classList.remove("tbl-resizing")
        updateTableHandlePos(tableEl)
        schedulePaginate()
      }, 160)
      updateTableHandlePos(tableEl)
    }
    schedulePaginate()
  }

  // Whole-table resize, Word-style. Three handles share this one handler:
  //   "x"    right edge  — scales every column
  //   "y"    bottom edge — scales every row
  //   "both" corner      — scales both at once (drag it diagonally)
  // Separate edge handles rather than only a corner: a lone corner handle reads
  // as "drag sideways" and a doctor reaching for a taller row never finds the
  // vertical axis at all. Sizes are mutated live on the DOM for instant
  // feedback; the document itself changes once, on drag end, via
  // commitTableColumnWidths + commitTableRowHeights.
  const resizeTable = (axis: "x" | "y" | "both", e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const tableEl = activeTableElRef.current
    if (!tableEl) return
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch { }

    // Table page breaks are spacer rows INSIDE the table (see
    // tiptap-pagination-extension), so they have to be out of the way while the
    // drag measures and rewrites row heights — otherwise `tableEl.style.height`
    // below is being asked to cover a gap that is about to be recomputed, and
    // the real rows shrink to make room for a stale page break.
    //
    // Hidden, not cleared: dispatching a transaction to drop the decorations
    // makes ProseMirror redraw the table, which detaches the very element (and
    // colgroup) this drag is holding — the drag then resizes a node that is no
    // longer in the document and silently does nothing. They go back on release,
    // and schedulePaginate() then recomputes them against the final size.
    const spacerRows = Array.from(
      tableEl.querySelectorAll<HTMLElement>(`[${PAGE_SPACER_ROW_ATTR}]`)
    )
    spacerRows.forEach((sp) => { sp.style.display = "none" })

    // Ensure the table has colgroup and col elements. Word-imported or mammoth-generated
    // tables do not contain colgroups initially, which prevents column-width drag scaling.
    let cols = Array.from(tableEl.querySelectorAll(":scope > colgroup > col")) as HTMLElement[]
    if (cols.length === 0) {
      const colgroup = document.createElement("colgroup")
      const firstRow = tableEl.rows[0]
      if (firstRow) {
        const cellWidths: number[] = []
        Array.from(firstRow.cells).forEach((cell) => {
          const w = cell.getBoundingClientRect().width
          const colspan = parseInt(cell.getAttribute("colspan") || "1", 10)
          for (let k = 0; k < colspan; k++) {
            cellWidths.push(w / colspan)
          }
        })
        cellWidths.forEach((w) => {
          const col = document.createElement("col")
          col.style.width = `${w}px`
          colgroup.appendChild(col)
        })
        tableEl.insertBefore(colgroup, tableEl.firstChild)
        // Re-query the created col elements
        cols = Array.from(tableEl.querySelectorAll(":scope > colgroup > col")) as HTMLElement[]
      }
    }

    // Page-break spacer rows are view-only decorations, not real rows — they
    // must not be scaled, and counting them would shift every row's height
    // onto the wrong row node (see tableBodyRows).
    const rows = tableBodyRows(tableEl) as HTMLElement[]
    if (!cols.length && !rows.length) return

    const startWidths = cols.map((c) => c.getBoundingClientRect().width)
    const startHeights = rows.map((r) => r.getBoundingClientRect().height)
    const startTableWidth = tableEl.getBoundingClientRect().width
    const startTableHeight = tableEl.getBoundingClientRect().height
    const minTableWidth = Math.max(5, cols.length * MIN_TABLE_COL_PX)
    const startX = e.clientX
    const startY = e.clientY

    const doX = axis === "x" || axis === "both"
    const doY = axis === "y" || axis === "both"

    // Set initial size at the start of drag
    setDraggingTableSize({ width: startTableWidth, height: startTableHeight })
    // Temporarily set contenteditable to false on the entire editor container to release browser layout lock on tables
    const editorDom = editor?.view.dom
    if (editorDom) {
      editorDom.setAttribute("contenteditable", "false")
    }
    tableEl.setAttribute("contenteditable", "false")
    tableEl.classList.add("tbl-resizing")   // animates the type scale (globals.css)

    // Strip any pre-existing inline style width/height from the table rows and cells
    // (e.g. from a mammoth-imported Word template) so they do not lock the layout
    // and prevent the user from shrinking/resizing the table freely.
    rows.forEach((r) => {
      r.style.height = ""
      Array.from(r.children).forEach((cell) => {
        const cellEl = cell as HTMLElement
        cellEl.style.width = ""
        cellEl.style.height = ""
      })
    })

    // ── The vertical floor, and how to get below it ──────────────────────────
    // With every stored height cleared, this is how short the rows can be while
    // still showing their text at the CURRENT type scale. Dragging above it is
    // ordinary row-height stretching. Dragging below it can only happen by
    // making the table's own type smaller (see fontScale in
    // tiptap-custom-table.ts) — a row height is a minimum in CSS, so without
    // that the table simply refused to get shorter, which is exactly what made
    // the vertical and diagonal handles look broken while the horizontal one
    // worked.
    void tableEl.offsetHeight
    const floorHeights = rows.map((r) => r.getBoundingClientRect().height)
    const floorHeight = floorHeights.reduce((a, b) => a + b, 0)
    const startScale = getTableFontScale(tableEl)
    const minTableHeight = Math.max(5, Math.round(floorHeight * (TABLE_FONT_SCALE_MIN / startScale)))
    // Put the stretched heights back for the rest of the drag so the pointer
    // stays on the corner it grabbed.
    rows.forEach((r, i) => { if (startHeights[i] > floorHeights[i] + 1) r.style.height = `${startHeights[i]}px` })

    const sizesForDelta = (rawDx: number, rawDy: number) => {
      const dx = doX ? rawDx : 0
      const dy = doY ? rawDy : 0
      const targetWidth = Math.max(minTableWidth, startTableWidth + dx)
      const targetHeight = Math.max(minTableHeight, startTableHeight + dy)
      const xScale = startTableWidth ? targetWidth / startTableWidth : 1
      const yScale = startTableHeight ? targetHeight / startTableHeight : 1

      // Below the text floor the rows stop carrying heights at all and the type
      // scale takes over: every vertical measurement inside a table cell (line
      // height, cell padding) is proportional to its font size, so the whole
      // table shrinks by the same ratio the drag asked for.
      const shrinking = doY && targetHeight < floorHeight - 1
      const scale = shrinking && floorHeight
        ? Math.min(1, Math.max(TABLE_FONT_SCALE_MIN, (startScale * targetHeight) / floorHeight))
        : startScale

      return {
        targetWidth,
        targetHeight,
        scale,
        widths: startWidths.map((w) => Math.max(MIN_TABLE_COL_PX, Math.round(w * xScale))),
        // `null` = let the text decide, which is what shrinking means here.
        heights: shrinking
          ? rows.map(() => null)
          : startHeights.map((h) => Math.max(MIN_TABLE_ROW_PX, Math.round(h * yScale))),
      }
    }

    const onMove = (ev: PointerEvent) => {
      const { targetWidth, targetHeight, scale, widths, heights } = sizesForDelta((ev.clientX - startX) / zoomRef.current, (ev.clientY - startY) / zoomRef.current)
      if (doX) {
        tableEl.style.width = `${targetWidth}px`
        cols.forEach((c, i) => { c.style.width = `${widths[i]}px` })
      }
      if (doY) {
        applyTableFontScale(tableEl, scale)
        if (heights[0] == null) {
          // Shrinking past the floor: no heights, the type scale does the work.
          tableEl.style.height = ""
          rows.forEach((r) => {
            r.style.height = ""
            Array.from(r.children).forEach((cell) => { (cell as HTMLElement).style.height = "" })
          })
        } else {
          // Apply height to table element itself to force browser redraw
          tableEl.style.height = `${targetHeight}px`
          rows.forEach((r, i) => {
            const hStr = `${heights[i]}px`
            r.style.height = hStr
            // Also set the height on all direct td/th children of this row to force Chrome to layout the height change live
            Array.from(r.children).forEach((cell) => {
              (cell as HTMLElement).style.height = hStr
            })
          })
        }
        // Force a layout reflow on the table to repaint heights live
        void tableEl.offsetHeight
      }
      updateTableHandlePos(tableEl)
      setDraggingTableSize({ width: targetWidth, height: Math.round(tableEl.getBoundingClientRect().height) })
    }
    const onUp = (ev: PointerEvent) => {
      try { target.releasePointerCapture(ev.pointerId) } catch { }
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      const { targetWidth, widths, heights, scale } = sizesForDelta((ev.clientX - startX) / zoomRef.current, (ev.clientY - startY) / zoomRef.current)

      // Restore contenteditable states and clean up temporary inline styles
      if (editorDom) {
        editorDom.setAttribute("contenteditable", "true")
      }
      tableEl.removeAttribute("contenteditable")
      tableEl.classList.remove("tbl-resizing")
      tableEl.style.height = ""
      rows.forEach((r) => {
        r.style.height = ""
        Array.from(r.children).forEach((cell) => {
          (cell as HTMLElement).style.height = ""
        })
      })

      // With every inline height gone, this reads what each row needs for its
      // own text at the width it just ended up at. A row is only given a height
      // of its own where the drag asked for MORE than that; asking for less is
      // stored as "no height" instead, because a row height is a floor in CSS —
      // writing height:1px on a 27px row does nothing except lock a meaningless
      // number into the saved report and make the next shrink look broken.
      void tableEl.offsetHeight
      const naturalHeights = rows.map((r) => r.getBoundingClientRect().height)

      if (doX) {
        commitTableWidth(tableEl, targetWidth)
        if (cols.length) commitTableColumnWidths(tableEl, widths)
      }
      if (doY) {
        // Order matters: the type scale is part of the table node's attributes,
        // and committing it re-renders the table — so the row heights measured
        // above go in as part of the same document change, not against a table
        // that is about to be redrawn underneath them.
        commitTableFontScale(tableEl, scale)
        if (rows.length) {
          commitTableRowHeights(
            tableEl,
            heights.map((h, i) => (h != null && h > naturalHeights[i] + 1 ? h : null)),
          )
        }
      }
      // Page breaks back on (schedulePaginate below re-measures them against
      // the size this drag just settled on).
      spacerRows.forEach((sp) => { sp.style.display = "" })
      updateTableHandlePos(tableEl)
      setDraggingTableSize(null)
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  const beginResizeTableBoth = (e: React.PointerEvent) => resizeTable("both", e)

  // Only shown while a drag is actually in progress — the mm readout is a
  // transient measurement aid, not a permanent label cluttering the page.
  const [draggingBand, setDraggingBand] = useState<"header" | "footer" | null>(null)
  // Always-fresh handle to `paginate` so the drag's pointermove listener (bound
  // once at pointerdown) recomputes page breaks against the live headerPx/
  // footerPx value as it changes mid-drag, instead of the stale value
  // captured at drag start.
  const paginateRef = useRef<() => void>(() => { })


  const A4_GAP_PX = 28                                    // grey gap drawn between sheets
  const A4_STRIDE = A4_PAGE_PX + A4_GAP_PX                // sheet-to-sheet distance

  // Pagination margins for the body are ProseMirror decorations now (see
  // tiptap-pagination-extension.ts) — they were never part of the document,
  // so editor.getHTML() already excludes them without any stripping step.
  // What leaves the editor: the accepted document, without revision marks or
  // comment markup. Everything downstream — print, PDF, DOCX, autosave, submit —
  // goes through here, so a reader never sees another editor's working notes.
  const readCleanBody = useCallback(() => {
    const html = editor?.getHTML() ?? ""
    return stripComments(acceptTrackedHtml(html))
  }, [editor])

  /** The document exactly as it stands, revision marks and all — for drafts. */
  const readRawBody = useCallback(() => editor?.getHTML() ?? "", [editor])

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
    const r = it.getBoundingClientRect()
    const z = zoomRef.current || 1
    const top = (r.top - wrapTop) / z
    const bottom = top + r.height / z
    const footerLimit = page * A4_STRIDE + (A4_PAGE_PX - footerPx)
    const pageTop = page * A4_STRIDE + headerPx
    if (bottom > footerLimit + 1 && top > pageTop + 2) {
      page++
      const target = page * A4_STRIDE + headerPx
      const delta = target - top
      if (delta > 0) {
        const base = parseFloat(getComputedStyle(it).marginTop) || 0
        it.setAttribute("data-pgb-base", it.style.marginTop || "")
        it.dataset.pgb = "1"
        it.style.marginTop = `${base + delta}px`
      }
    }
    return page
  }, [A4_STRIDE, headerPx, footerPx])

  // Measure the flowing blocks and push any that would cross a page's footer band
  // down to the next sheet's content area. Sets the sheet count for the backdrop.
  // The report body's own blocks are computed as ProseMirror decorations
  // (computeBodyPageDecorations) rather than direct style writes, since that
  // content is ProseMirror-owned — see tiptap-pagination-extension.ts.
  // Runs the layout pass repeatedly until it stops changing.
  //
  // One pass is not enough, and that was the bug behind content sitting on top
  // of the footer band after applying a template: every block is measured
  // against a DOM that still reflects the PREVIOUS pass's page breaks, so as
  // soon as one block's push changes, every block after it was measured from a
  // position that no longer exists. With a fresh template (no decorations at
  // all yet) that misses on the very first block that overflows — it gets
  // pushed to page 2, but the blocks following it were measured as if it
  // hadn't moved, so nothing pushes them and they stay overlapping the band.
  //
  // Re-measuring after dispatching fixes it: ProseMirror applies decorations
  // to the DOM synchronously, so the next pass reads real post-push positions.
  // Two consecutive identical fingerprints means measurements and applied
  // margins finally agree. The cap is a safety net against a pathological
  // block that can never fit (one taller than a whole page) oscillating
  // forever — a stable-but-imperfect layout beats a hung tab.
  const paginate = useCallback(() => {
    const wrap = wrapRef.current
    const view = editor?.view
    if (!wrap || !view) return

    const MAX_PASSES = 5
    let page = 0
    let lastSignature: string | null = null

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      // Re-read every pass: the previous pass's margins moved things.
      const wrapTop = wrap.getBoundingClientRect().top
      page = 0

      // pushIfOverflowing restores its own previous margin before measuring,
      // so re-running it across passes measures naturally rather than stacking.
      if (patientBoxRef.current) page = pushIfOverflowing(patientBoxRef.current, wrapTop, page)
      if (titleWrapRef.current) page = pushIfOverflowing(titleWrapRef.current, wrapTop, page)

      const bodyEntryTop = (view.dom.getBoundingClientRect().top - wrapTop) / (zoomRef.current || 1)
      const { decorationSet, exitPage, signature } = computeBodyPageDecorations(view, {
        wrapTop, entryPage: page, entryTopPx: bodyEntryTop,
        stride: A4_STRIDE, a4PagePx: A4_PAGE_PX,
        letterheadTopPx: headerPx, letterheadBottomPx: footerPx,
        zoom: zoomRef.current || 1,
      })
      // setMeta only — the doc is untouched, so this neither dirties the report
      // nor re-triggers onUpdate (which would recurse straight back into here).
      view.dispatch(view.state.tr.setMeta(paginationPluginKey, decorationSet))
      page = exitPage

      if (sigsRef.current) page = pushIfOverflowing(sigsRef.current, wrapTop, page)

      if (signature === lastSignature) break
      lastSignature = signature
    }

    setNumPages(page + 1)
  }, [A4_STRIDE, editor, pushIfOverflowing, headerPx, footerPx])

  const schedulePaginate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => paginate())
  }, [paginate])

  // Drops every page-break margin. Call this whenever the whole body is
  // replaced (template applied, saved report loaded): the old decorations would
  // otherwise be mapped onto a document they know nothing about, and the first
  // measuring pass would subtract margins that belong to blocks that no longer
  // exist. Cheap, and it makes the first pass measure a genuinely clean layout.
  const clearPaginationDecorations = useCallback(() => {
    const view = editor?.view
    if (!view) return
    view.dispatch(view.state.tr.setMeta(paginationPluginKey, DecorationSet.empty))
  }, [editor])

  useEffect(() => { paginateRef.current = paginate }, [paginate])
  useEffect(() => { schedulePaginateRef.current = schedulePaginate }, [schedulePaginate])

  // Word's document-level shortcuts. On the window rather than in the editor's
  // keymap so they work from the heading and the patient box too — and so
  // Ctrl+F isn't swallowed by whichever field happens to have focus.
  useEffect(() => {
    if (isReadOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === "f" || key === "h") {
        e.preventDefault()
        setFindMode(key === "h" ? "replace" : "find")
      } else if (e.key === "Enter") {
        // Not while typing in one of the page's own fields (the patient box,
        // the find box) — there Ctrl+Enter belongs to that input, not the body.
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return
        e.preventDefault()
        insertPageBreak()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

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

  // A signature stamp is inserted as a report IMAGE node, not the older
  // signature node — so a stamp gets the full picture toolbar: Word's text
  // wrapping modes and the Glow Edges effect. That effect matters most here of
  // all: a drawn or typed signature is already a transparent PNG, but an
  // UPLOADED one is a photo/scan of paper (the pad re-encodes uploads as JPEG),
  // so it arrives as a white rectangle that hides whatever it's placed over
  // until the background is knocked out.
  //
  // Inserted "In Front of Text" rather than Behind Text: a signature has to
  // stay visible and grabbable wherever it's dropped, including over a line of
  // text — Behind Text is one menu pick away for anyone who wants it under the
  // text instead.
  //
  // SignatureExtension stays registered (and unchanged) so stamps in reports
  // saved before this still load, render and drag exactly as they did.
  const insertSignature = ({ dataUrl, width, height }: { dataUrl: string; width: number; height: number }) => {
    editor?.chain().focus()
      .insertReportImage({ src: dataUrl, width, height, wrap: "front", left: 0, top: 0 })
      .run()
    setSigPadOpen(false)
    schedulePaginate()
  }

  // ── Insert Image ─────────────────────────────────────────────────────────────
  // The toolbar's Image button opens the OS file picker; paste and drag-and-drop
  // reach the same insert path via the editor's handlePaste/handleDrop above.
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  const onImageFilesPicked = async (files: FileList | null) => {
    if (!editor || !files?.length) return
    await insertImageFiles(editor.view, Array.from(files))
    editor.chain().focus().run()
    schedulePaginate()
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
    const imgRect = img.getBoundingClientRect()
    setSigOverlayPos({
      toolbarTop: imgRect.top - wrapRect.top - 34,
      toolbarLeft: Math.max(0, imgRect.left - wrapRect.left),
      handleTop: imgRect.bottom - wrapRect.top - 7,
      handleLeft: imgRect.right - wrapRect.left - 7,
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
  // Reads one of the sign-off's contentEditable blocks, but ONLY reports it as
  // an override once the doctor has actually typed in it. seedEditable stamps
  // what the browser parsed onto the node; an untouched block still matches
  // that, and returning it anyway would freeze a copy of the signatory's name
  // into this report — after which renaming the doctor on the Signatures page
  // would silently stop reaching it.
  const readSigText = (kind: "name" | "credentials", index: number): string | undefined => {
    const field = kind === "name" ? "nameHtml" : "credentialsHtml"
    const saved = loadedSigLayout[index]?.[field]
    const el = sigsRef.current?.querySelector<HTMLElement>(
      `[data-sig-text="${kind}"][data-sig-text-idx="${index}"]`
    )
    if (!el) return saved
    if (el.innerHTML === el.dataset.sigSeedHtml) return saved
    // An emptied NAME reverts to the signatory record rather than saving a
    // blank: an unnamed doctor on a medical report is a mistake every time,
    // and storing "" would also desync the editor (which would seed empty)
    // from every output (which falls back to the record). Credentials are
    // different — a doctor may genuinely want only a name under the signature
    // — so an empty credentials block is saved as the empty string it is.
    if (kind === "name" && !el.textContent?.trim()) return undefined
    return el.innerHTML
  }

  const readSignatureLayout = (): (SignatureLayout | null)[] => {
    const layout: (SignatureLayout | null)[] = [null, null]
    for (let i = 0; i < 2; i++) {
      // The name/credential text is edited independently of the image — a
      // report can have a bolded sign-off and no stamp at all — so it is read
      // for both branches below rather than only alongside an <img>.
      const nameHtml = readSigText("name", i)
      const credentialsHtml = readSigText("credentials", i)
      const text = {
        ...(nameHtml !== undefined ? { nameHtml } : {}),
        ...(credentialsHtml !== undefined ? { credentialsHtml } : {}),
      }

      const img = sigsRef.current?.querySelector<HTMLImageElement>(`img[data-sig-idx="${i}"]`)
      if (!img) {
        // A hidden/removed signature unmounts its <img> entirely (replaced by
        // the "+ Add Signature" placeholder) — state is the only remaining
        // record of that removal, so fall back to it instead of dropping it.
        const prev = loadedSigLayout[i]
        layout[i] = (prev || Object.keys(text).length) ? { ...(prev ?? {}), ...text } : null
        continue
      }
      const left = parseFloat(img.style.left) || 0
      const top = parseFloat(img.style.top) || 0
      const width = parseFloat(img.style.width) || 0
      const height = parseFloat(img.style.height) || 0
      const hidden = img.style.display === "none" || img.getAttribute("data-sig-hidden") === "true"
      const overrideImage = loadedSigLayout[i]?.overrideImage || (img.src?.startsWith("data:") ? img.src : undefined)
      if (left || top || width || height || hidden || overrideImage || Object.keys(text).length) {
        layout[i] = {
          ...(left ? { left } : {}),
          ...(top ? { top } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(hidden ? { hidden } : {}),
          ...(overrideImage ? { overrideImage } : {}),
          ...text,
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
      return
    }
    deselectSig()
    placeCaretFromPageClick(e)
  }

  // ── Click anywhere on the sheet below the text → put a caret there ───────────
  // Clicking the blank part of the page used to do nothing at all: the click
  // landed on the paper wrapper, not on the editor, so no caret appeared and
  // focus stayed wherever it happened to be — usually the study heading, which
  // is why typing right after such a click jumped to the top of the page. Word
  // puts the caret at the nearest text position instead, and so does this.
  //
  // Deliberately does NOT scroll (`scrollIntoView: false`): the user just
  // clicked the spot they're looking at, so moving the page under them is
  // exactly the jump this is meant to stop.
  const placeCaretFromPageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isReadOnly || !editor) return
    const target = e.target as HTMLElement
    // Anything that owns its own click — the heading, the patient-box fields,
    // every drag handle/button, and the editor itself (ProseMirror already
    // places the caret for clicks inside it).
    if (target.closest("button, input, select, textarea, a, img, [contenteditable='true'], .ProseMirror")) return

    const dom = editor.view.dom as HTMLElement
    const rect = dom.getBoundingClientRect()
    // Above the body is the patient box / study heading region — clicking up
    // there must not yank the caret down into the findings.
    if (e.clientY < rect.top) return

    // Clamped into the body's box so a click in the side margin or below the
    // last line resolves to the nearest real text position rather than nothing.
    const left = Math.min(Math.max(e.clientX, rect.left + 1), rect.right - 1)
    const top = Math.min(Math.max(e.clientY, rect.top + 1), rect.bottom - 1)
    const coords = editor.view.posAtCoords({ left, top })

    lastActiveRef.current = "body"
    editor.chain().focus(coords?.pos ?? "end", { scrollIntoView: false }).run()
  }

  const nudgeSig = (dx: number, dy: number) => {
    const img = selectedSigRef.current
    if (!img) return
    const curLeft = parseFloat(img.style.left) || 0
    const curTop = parseFloat(img.style.top) || 0
    let newLeft = curLeft + dx
    let newTop = curTop + dy
    if (img.dataset.sigKind === "doctor") {
      newLeft = Math.max(-150, Math.min(150, newLeft))
      newTop = Math.max(-60, Math.min(0, newTop))
    } else {
      newLeft = Math.max(-200, Math.min(200, newLeft))
      newTop = Math.max(-100, Math.min(100, newTop))
    }
    img.style.left = `${newLeft}px`
    img.style.top = `${newTop}px`
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
    const baseTop = parseFloat(img.style.top) || 0
    const isDoctor = img.dataset.sigKind === "doctor"

    const onMove = (ev: PointerEvent) => {
      let newLeft = baseLeft + (ev.clientX - startX) / zoomRef.current
      let newTop = baseTop + (ev.clientY - startY) / zoomRef.current
      if (isDoctor) {
        newLeft = Math.max(-150, Math.min(150, newLeft))
        newTop = Math.max(-60, Math.min(0, newTop))
      } else {
        newLeft = Math.max(-200, Math.min(200, newLeft))
        newTop = Math.max(-100, Math.min(100, newTop))
      }
      img.style.left = `${newLeft}px`
      img.style.top = `${newTop}px`
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
      let newW = Math.max(24, startW + (ev.clientX - startX) / zoomRef.current)
      if (isDoctor) {
        newW = Math.min(220, newW)
      } else {
        newW = Math.min(350, newW)
      }
      const scale = newW / startW
      // Inline style (not the width/height attribute) so this also overrides
      // the signature-block image's own CSS height class when resizing that.
      img.style.width = `${Math.round(newW)}px`
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

  // ── Drag-resize the top/bottom letterhead bands ──────────────────────────────
  // Dragging the dashed header/footer line up/down changes how much blank
  // space is reserved at the top/bottom of every page for pre-printed
  // letterhead stationery. The same value applies uniformly to every sheet,
  // so any page's handle can be grabbed to change it. Shared by both bands —
  // only which state setter and which direction the drag grows the band in
  // differ (dragging the header down grows it; dragging the footer up grows
  // it, since it's anchored to the bottom of the page).
  const beginResizeBand = (which: "header" | "footer") => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingBand(which)
    const startY = e.clientY
    const startPx = which === "header" ? headerPx : footerPx
    const sign = which === "header" ? 1 : -1
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(BAND_HEIGHT_MIN_PX, Math.min(BAND_HEIGHT_MAX_PX, startPx + sign * ((ev.clientY - startY) / zoomRef.current)))
      if (which === "header") setHeaderPx(next); else setFooterPx(next)
      // Re-flow immediately (not throttled to rAF) so the body visibly shifts
      // up/down as the line is dragged, not just once the drag ends.
      requestAnimationFrame(() => paginateRef.current())
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setDraggingBand(null)
      schedulePaginate()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  const beginResizeHeader = beginResizeBand("header")
  const beginResizeFooter = beginResizeBand("footer")

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
        return
      }
      // Same capture for the sign-off's name/credential blocks, so selecting a
      // doctor's name and pressing Bold formats THAT, instead of the command
      // landing on whichever region happened to be active before.
      const sigText = el?.closest<HTMLElement>("[data-sig-text]")
      if (sigText && sigsRef.current?.contains(sigText)) {
        toolbarSelRangeRef.current = range.cloneRange()
        activeSigTextRef.current = sigText
        lastActiveRef.current = "signature"
      }
    }
    document.addEventListener("selectionchange", onSelectionChange)
    return () => document.removeEventListener("selectionchange", onSelectionChange)
  }, [])

  // Restores the last selection made inside the heading/sign-off onto its own
  // element and focuses it — used before toolbar commands that would otherwise
  // run against whatever picked up focus last (e.g. a <select>).
  const restoreEditableSelection = (): HTMLElement | null => {
    const target = lastActiveRef.current === "signature"
      ? activeSigTextRef.current
      : titleRef.current
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
  const getDocTitle = () => (titleRef.current?.innerText ?? "").trim() || getDisplayTitle(study, studyHeadings).toUpperCase()
  const [docxLoading, setDocxLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedDocxBase64, setSubmittedDocxBase64] = useState("")
  // Captured from the live heading at submit time — the editor (and titleRef)
  // unmounts once the "Report Submitted" screen renders, so getDocTitle() would
  // otherwise fall back to the original study name and the download filename
  // would silently revert to it even though the saved DOCX has the edited title.
  const [submittedDocTitle, setSubmittedDocTitle] = useState("")
  const [submittedHeadingFont, setSubmittedHeadingFont] = useState<string | undefined>(undefined)
  const [shareLoading, setShareLoading] = useState(false)

  // Storage key for this patient's report (per study — a patient can have several)
  const storageKey = `aarya_report_${srNo || patient.replace(/\s+/g, "_")}${paramSidx > 0 ? `_s${paramSidx}` : ""}`

  // Six different places save the draft (unmount, hard refresh, submit, template
  // swap, autosave, layout changes) and each one used to spell out the whole
  // payload — so whichever one ran last decided which settings survived, and any
  // field it forgot was silently dropped. They all go through here now: the
  // stored draft is merged with the page's current layout, so a save can only
  // ever add to what is already on disk.
  const draftStateRef = useRef({
    storageKey, headingFont, patientBoxFont, headerPx, footerPx,
    patientBoxOffsetX, patientBoxOffsetY, titleBoxOffsetX, titleBoxOffsetY,
    patientBoxWidthPx, titleBoxWidthPx, topSpacerLines,
    patient, study, date, age, gender, contact, srNo, refBy,
  })
  draftStateRef.current = {
    storageKey, headingFont, patientBoxFont, headerPx, footerPx,
    patientBoxOffsetX, patientBoxOffsetY, titleBoxOffsetX, titleBoxOffsetY,
    patientBoxWidthPx, titleBoxWidthPx, topSpacerLines,
    patient, study, date, age, gender, contact, srNo, refBy,
  }

  const writeDraft = (extra: Record<string, unknown> = {}) => {
    const live = draftStateRef.current
    try {
      let stored: Record<string, unknown> = {}
      try { stored = JSON.parse(localStorage.getItem(live.storageKey) || "{}") ?? {} } catch { }
      localStorage.setItem(live.storageKey, JSON.stringify({
        ...stored, ...live, storageKey: undefined,
        ...extra,
        savedAt: new Date().toISOString(),
      }))
    } catch { }
  }

  // ── Set in_progress when the form is opened (not view/edit mode) ─────────
  useEffect(() => {
    if (paramId && !paramView && !paramLoad) {
      fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportStatus: "in_progress", studyIndex: paramSidx }),
      }).catch(() => { })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramId])

  // ── Auto-save draft to localStorage on unmount (navigate away) ───────────────
  useEffect(() => {
    return () => {
      if (!submittedRef.current && editor && !editor.isEmpty) {
        writeDraft({
          body: readCleanBody(),
          docTitle: titleRef.current?.innerText?.trim() || undefined,
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy, editor, headingFont, headerPx, footerPx])

  // The unmount save above only runs on a clean navigation. These layout
  // settings are a few numbers, so they are also written as they change — a
  // hard refresh or a crashed tab then comes back with the page laid out the
  // way the doctor left it, not just with the text.
  useEffect(() => {
    if (!showDoc || !editor || submittedRef.current) return
    const timer = window.setTimeout(() => {
      if (editor.isEmpty) { writeDraft(); return }
      writeDraft({ body: readCleanBody() })
    }, 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topSpacerLines, patientBoxOffsetY, titleBoxOffsetY, patientBoxWidthPx, titleBoxWidthPx, headerPx, footerPx, showDoc, editor])

  // ── Load report body: localStorage draft first, then the submitted body from DB ──
  useEffect(() => {
    if (!showDoc || !editor) return

    const setBody = (html: string, title?: string, font?: string, boxFont?: string) => {
      editor.commands.setContent(normalizeLegacyHtml(html))
      clearPaginationDecorations()
      if (paramLoad || paramView) originalBodyRef.current = html
      if (title && titleRef.current) titleRef.current.innerText = title
      setHeadingFont(font || undefined)
      setPatientBoxFont(boxFont || undefined)
      schedulePaginate()
    }

    let draft: { body?: string; docTitle?: string; headingFont?: string; patientBoxFont?: string; headerPx?: number; footerPx?: number; patientBoxOffsetY?: number; titleBoxOffsetY?: number; topSpacerLines?: number; patientBoxWidthPx?: number; titleBoxWidthPx?: number; study?: string; templateSignatureCount?: number; signatureLayout?: (SignatureLayout | null)[] } | null = null
    try { draft = JSON.parse(localStorage.getItem(storageKey) || "null") } catch { }

    if (draft?.body) {
      const d = draft
      setTimeout(() => {
        // Older template drafts could contain the imported Word sign-off even
        // though the live editor had shown the app's own stable two-column
        // block. On refresh that embedded sign-off was parsed as ordinary
        // inline paragraphs, collapsing both doctors together. Repair those
        // drafts as they load and keep only the canonical signature columns.
        const strippedDraftBody = stripTrailingSignatureBlock(d.body!)
        const embeddedDoctors = strippedDraftBody === d.body
          ? 0
          : countSignatoriesIn(d.body!.slice(strippedDraftBody.length))
        const repairedSignatureCount = embeddedDoctors > 0
          ? (typeof d.templateSignatureCount === "number" && d.templateSignatureCount > 0
              ? d.templateSignatureCount
              : embeddedDoctors)
          : d.templateSignatureCount
        const restoredBody = embeddedDoctors > 0 ? strippedDraftBody : d.body!

        setBody(restoredBody, d.docTitle, d.headingFont, d.patientBoxFont)
        if (d.study) setCurrentStudy(d.study)
        if (d.patientBoxOffsetY !== undefined) setPatientBoxOffsetY(d.patientBoxOffsetY)
        if (d.titleBoxOffsetY !== undefined) setTitleBoxOffsetY(d.titleBoxOffsetY)
        if (d.topSpacerLines !== undefined) setTopSpacerLines(d.topSpacerLines)
        if (d.patientBoxWidthPx !== undefined) setPatientBoxWidthPx(d.patientBoxWidthPx)
        if (d.titleBoxWidthPx !== undefined) setTitleBoxWidthPx(d.titleBoxWidthPx)
        if (repairedSignatureCount !== undefined) setTemplateSignatureCount(repairedSignatureCount)
        if (d.signatureLayout?.length || embeddedDoctors > 0) {
          setLoadedSigLayout([0, 1].map((index) => ({
            ...(d.signatureLayout?.[index] ?? {}),
            hiddenSignatory: repairedSignatureCount !== undefined && index >= repairedSignatureCount,
          })))
        }
        if (embeddedDoctors > 0) {
          writeDraft({
            body: restoredBody,
            templateSignatureCount: repairedSignatureCount,
            signatureLayout: [0, 1].map((index) => ({
              ...(d.signatureLayout?.[index] ?? {}),
              hiddenSignatory: repairedSignatureCount !== undefined && index >= repairedSignatureCount,
            })),
          })
        }
      }, 80)
    }
    if (draft && !draft.body && draft.topSpacerLines !== undefined) {
      // A layout-only draft (spacing changed but nothing typed yet).
      const d = draft
      setTimeout(() => { setTopSpacerLines(d.topSpacerLines!) }, 80)
    }
    if (draft?.headerPx || draft?.footerPx) {
      const d = draft
      setTimeout(() => {
        if (d.headerPx) setHeaderPx(d.headerPx)
        if (d.footerPx) setFooterPx(d.footerPx)
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
            const savedBoxFont: string = entry?.patientBoxFont || p.patientBoxFont || ""
            if (html) setTimeout(() => setBody(html, savedHeading || undefined, savedHeadingFont || undefined, savedBoxFont || undefined), 80)
          }
          if (!draft?.headerPx) {
            const savedHeaderPx: number | undefined = entry?.headerHeightPx ?? p.headerHeightPx
            if (savedHeaderPx) setHeaderPx(savedHeaderPx)
          }
          if (!draft?.footerPx) {
            const savedFooterPx: number | undefined = entry?.footerHeightPx ?? p.footerHeightPx
            if (savedFooterPx) setFooterPx(savedFooterPx)
          }
          if (typeof entry?.topSpacerLines === "number") setTopSpacerLines(entry.topSpacerLines)
          const savedReportDate: string | undefined = entry?.reportDate || p.reportDate
          if (savedReportDate) setLocalReportDate(savedReportDate)
          if (p.name) setLocalPatientName(p.name)
          if (p.referredBy) setLocalRefBy(p.referredBy)
          if (p.age) setLocalAge(String(p.age))
          if (p.gender) setLocalGender(p.gender)
          if (entry?.name) setCurrentStudy(entry.name)
          if (!draft?.signatureLayout?.length) {
            const savedLayouts = entry?.signatureLayout
            if (savedLayouts && savedLayouts.length > 0) {
              setLoadedSigLayout(savedLayouts)
              const visibleCount = savedLayouts.filter((layout: SignatureLayout | null) => !layout?.hiddenSignatory).length
              if (savedLayouts.some((layout: SignatureLayout | null) => layout?.hiddenSignatory)) {
                setTemplateSignatureCount(visibleCount)
              }
            } else {
              setLoadedSigLayout([{ hidden: true }, { hidden: true }])
            }
          }
        })
        .catch(() => { })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDoc, editor])

  // ── Seed the editable heading from the study's template (drafts/templates override it) ──
  // Waits for the heading index: seeding the bare study name first and swapping
  // it once the fetch lands would be a visible flicker, and worse, the "already
  // has a heading" guard below would see the study name sitting there and
  // refuse to replace it — leaving every report titled with the study name.
  useEffect(() => {
    if (!showDoc || !study || !headingsLoaded) return
    if (titleRef.current && !titleRef.current.innerText.trim()) {
      titleRef.current.innerText = getDisplayTitle(study, studyHeadings).toUpperCase()
    }
  }, [showDoc, study, headingsLoaded, studyHeadings])

  // ── Save draft on browser close / hard refresh (belt-and-suspenders) ─────────
  useEffect(() => {
    const save = () => {
      if (submittedRef.current || !editor || editor.isEmpty) return
      writeDraft({
        body: readCleanBody(),
        docTitle: titleRef.current?.innerText?.trim() || undefined,
        templateSignatureCount,
        signatureLayout: readSignatureLayout(),
      })
    }
    window.addEventListener("beforeunload", save)
    return () => window.removeEventListener("beforeunload", save)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy, editor, headingFont, headerPx, footerPx, templateSignatureCount])

  // ── Build DOCX blob from current report body ─────────────────────────────────
  // Layout lives in @/lib/report-docx, shared with the DOCX-building logic
  // used elsewhere for this report so the layout stays one definition.
  const buildDocxBase64 = async (bodyHtml: string): Promise<string> =>
    buildReportDocxBase64({
      patient: localPatientName || patient,
      refBy: localRefBy || refBy,
      srNo: localSrNo || srNo,
      date: localReportDate || date,
      age: localAge || age,
      gender: localGender || gender,
      docTitle: getDocTitle(),
      headingFont, patientBoxFont,
      bodyHtml,
      signatories: reportSignatories,
      signatureLayouts: readSignatureLayout(),
    })

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
    writeDraft({
      body: finalBody,
      docTitle: titleRef.current?.innerText?.trim() || undefined,
      templateSignatureCount,
      signatureLayout: readSignatureLayout(),
      savedAt: now.toISOString(),
    })

    // Generate DOCX and save everything to MongoDB
    if (paramId) {
      const cleanBody = stripEditedSpans(finalBody)

      // Generate DOCX from the clean body and stash it for the success screen
      let reportDocx = ""
      try {
        reportDocx = await buildDocxBase64(cleanBody)
        setSubmittedDocxBase64(reportDocx)
      } catch { }

      // Images stored inside the report body — signature stamps and inserted
      // pictures alike — can push this payload past the server's request-size
      // limit. A failed save must NOT show the success screen: that's exactly
      // how an added signature silently "disappears" — the request is rejected
      // but the UI used to claim success regardless.
      try {
        const res = await fetch(`/api/patients/${paramId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studyIndex: paramSidx,
            reportStatus: "completed",
            reportBody: cleanBody,
            reportDocx,
            studyName: study,
            heading: getDocTitle(),
            headingFont: headingFont || "",
            patientBoxFont: patientBoxFont || "",
            headerHeightPx: headerPx,
            footerHeightPx: footerPx,
            patientBoxOffsetX, patientBoxOffsetY, titleBoxOffsetX, titleBoxOffsetY, topSpacerLines,
            patientBoxWidthPx, titleBoxWidthPx,
            signatureLayout: readSignatureLayout(),
            ...(localSrNo ? { srNo: Number(localSrNo) } : {}),
            editHistoryEntry: {
              editor: editorName,
              editedAt: now.toISOString(),
              body: cleanBody,
            },
          }),
        })
        if (!res.ok) {
          await notify({
            title: "Save failed",
            message: res.status === 413
              ? "The report is too large for the server to accept — usually the images in it (inserted pictures or a signature stamp). Remove or shrink the largest image, or insert fewer of them, then save again."
              : `The server returned ${res.status}. Please try again.`,
          })
          setSubmitting(false)
          return
        }
      } catch {
        await notify({
          title: "Save failed",
          message: "Could not reach the server. Check your connection and try again.",
        })
        setSubmitting(false)
        return
      }
    }

    submittedRef.current = true
    setSubmitting(false)
    setSubmitted(true)
  }

  // ── Template apply ───────────────────────────────────────────────────────────
  const applyTemplate = async (tpl: ReportTemplate) => {
    if (!editor) return
    const hasContent = !editor.isEmpty
    if (hasContent && !(await confirm({
      title: "Replace the report?",
      message: `Everything currently in this report will be replaced with the "${tpl.name}" template.`,
      confirmLabel: "Replace",
      danger: true,
    }))) return
    // Imported Word sign-offs often use layout-only spans/positioning that
    // Tiptap cannot serialize losslessly. They can look correct immediately
    // after applying a template, then collapse into one line after refresh.
    // Strip that block from the editable body and always render the doctors in
    // the app's canonical two-column component, whose layout survives reloads.
    const strippedBody = stripTrailingSignatureBlock(tpl.body)
    // How many doctors the removed sign-off actually named. A
    // two-column Word sign-off holds both on one line, so this is counted from
    // the block rather than assumed.
    const doctorsInSignOff = countSignatoriesIn(tpl.body.slice(strippedBody.length))
    editor.commands.setContent(normalizeLegacyHtml(strippedBody))
    clearPaginationDecorations()
    // Update local study state
    setCurrentStudy(tpl.name)
    // ALWAYS update the study heading text to match the selected template
    const newHeading = tpl.heading || tpl.name.toUpperCase()
    if (titleRef.current) {
      titleRef.current.textContent = newHeading
    }
    setHeadingFont(undefined)
    // Use the detected/stored doctor count when the template had a sign-off;
    // otherwise `undefined` means the clinic's usual signatories.
    const importedSignatureCount = strippedBody !== tpl.body
      ? (tpl.signatureCount && tpl.signatureCount > 0
          ? tpl.signatureCount
          : doctorsInSignOff || undefined)
      : undefined
    setTemplateSignatureCount(importedSignatureCount)
    if (importedSignatureCount !== undefined) {
      setLoadedSigLayout((previous) => [0, 1].map((index) => ({
        ...(previous[index] ?? {}),
        hiddenSignatory: index >= importedSignatureCount,
      })))
    } else {
      setLoadedSigLayout((previous) => [0, 1].map((index) => ({
        ...(previous[index] ?? {}),
        hiddenSignatory: false,
      })))
    }
    // Persist immediately so a stale draft can't bring old body back while keeping dragged offsets
    writeDraft({
      body: strippedBody,
      docTitle: newHeading,
      // The heading font comes with the template; the box font does not — it is
      // the doctor's choice for this patient's page, so writeDraft's live value
      // carries it through the swap untouched.
      headingFont: undefined,
      templateSignatureCount: importedSignatureCount,
      signatureLayout: [0, 1].map((index) => ({
        ...(loadedSigLayout[index] ?? {}),
        hiddenSignatory: importedSignatureCount !== undefined && index >= importedSignatureCount,
      })),
      study: tpl.name,
    })
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
      editor?.chain().focus().setFontSize(`${newSize}pt`).run()
      schedulePaginate()
      return
    }
    // Only the font family is a whole-box setting for the patient box; size,
    // spacing and bold/italic have no per-character target there. Bail out
    // rather than falling through to the heading branch below, which would
    // restore focus into the heading and format THAT instead.
    if (lastActiveRef.current === "patientBox") return
    const target = restoreEditableSelection()
    const sel = window.getSelection()
    if (!target || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
    document.execCommand("fontSize", false, "7")
    target.querySelectorAll('font[size="7"]').forEach((el) => {
      el.removeAttribute("size")
        ; (el as HTMLElement).style.fontSize = `${newSize}pt`
    })
    schedulePaginate()
  }

  // Aims the toolbar at the patient box and syncs the font dropdown to show
  // whatever font the box is currently in — mirrors what the heading does in
  // its own onFocus, so the dropdown always reflects the region it will affect.
  const targetPatientBox = () => {
    if (isReadOnly) return
    lastActiveRef.current = "patientBox"
    setFontFamily(patientBoxFont ?? DEFAULT_REPORT_FONT)
  }

  // ── Font family apply ─────────────────────────────────────────────────────────
  const applyFontFamily = (family: string) => {
    setFontFamily(family)
    if (lastActiveRef.current === "body") {
      editor?.chain().focus().setFontFamily(family).run()
      schedulePaginate()
      return
    }
    // The patient box has no text selection of its own to format — its lines
    // are React-rendered values, so the choice is stored for the whole box and
    // applied as one inherited font-family (see patientBoxFont).
    if (lastActiveRef.current === "patientBox") {
      setPatientBoxFont(family)
      schedulePaginate()
      return
    }
    // The sign-off keeps its own markup, so the font lands in the saved HTML
    // directly — no separate whole-block tracking, and crucially no
    // setHeadingFont, which would restyle the study heading instead.
    if (lastActiveRef.current === "signature") {
      restoreEditableSelection()
      document.execCommand("fontName", false, family)
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

  // ── Text colour / highlight ───────────────────────────────────────────────────
  // Same three-region routing as every other formatting control: Tiptap marks in
  // the body, execCommand in the heading, and nothing in the patient box, whose
  // lines are React-rendered values with no per-character target (see
  // changeFontSize for why bailing out beats falling through to the heading).
  const applyTextColor = (color: string | null) => {
    setTextColor(color)
    if (lastActiveRef.current === "body") {
      const chain = editor?.chain().focus()
      if (color) chain?.setColor(color).run(); else chain?.unsetColor().run()
      return
    }
    if (lastActiveRef.current === "patientBox") return
    restoreEditableSelection()
    document.execCommand("foreColor", false, color ?? "#000000")
  }

  const applyHighlight = (color: string | null) => {
    setHighlightColor(color)
    if (lastActiveRef.current === "body") {
      const chain = editor?.chain().focus()
      if (color) chain?.setBackgroundColor(color).run(); else chain?.unsetBackgroundColor().run()
      return
    }
    if (lastActiveRef.current === "patientBox") return
    restoreEditableSelection()
    // "transparent" is how execCommand clears a highlight; there is no unset.
    document.execCommand("hiliteColor", false, color ?? "transparent")
  }

  // ── Insert a symbol at the caret ──────────────────────────────────────────────
  const insertSymbol = (symbol: string) => {
    if (lastActiveRef.current === "body") {
      editor?.chain().focus().insertContent(symbol).run()
      schedulePaginate()
      return
    }
    restoreEditableSelection()
    document.execCommand("insertText", false, symbol)
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
    if (lastActiveRef.current === "patientBox") return   // see changeFontSize
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

  // ── Paragraph layout: indent, first line, space before/after, page break ─────
  // Body only. The heading is one centered line and the patient box is a fixed
  // grid — neither has paragraphs to lay out, so these quietly do nothing there
  // rather than pretending to work.
  const changeIndent = (delta: number) => {
    if (lastActiveRef.current !== "body") return
    editor?.chain().focus().changeParagraphIndent(delta).run()
    schedulePaginate()
  }

  const setParagraphSpacing = (attrs: Record<string, unknown>) => {
    if (lastActiveRef.current !== "body") return
    editor?.chain().focus().setParagraphFormat(attrs).run()
    schedulePaginate()
  }

  // Word's Ctrl+Enter: split here, and mark the half that follows as starting a
  // new sheet. The pagination pass turns that attribute into the push.
  const insertPageBreak = () => {
    if (!editor) return
    editor.chain().focus().splitBlock().setParagraphFormat({ pageBreakBefore: true }).run()
    schedulePaginate()
  }

  // ── Format painter ────────────────────────────────────────────────────────────
  // Word's brush: pick up the formatting at the caret, then paint it onto the
  // next selection. Held as marks rather than as a class so it survives being
  // applied across paragraphs, tables and list items alike.
  const [painterMarks, setPainterMarks] = useState<Record<string, Record<string, unknown>> | null>(null)

  const toggleFormatPainter = () => {
    if (painterMarks) { setPainterMarks(null); return }
    if (!editor) return
    const picked: Record<string, Record<string, unknown>> = {}
    for (const name of ["bold", "italic", "underline", "strike", "superscript", "subscript", "textStyle"]) {
      if (editor.isActive(name)) picked[name] = editor.getAttributes(name)
    }
    setPainterMarks(picked)
  }

  // Painting happens on the next completed selection, which is why this listens
  // for mouseup rather than for a selection change: mid-drag the selection is
  // still growing, and repainting on every step would fight the drag.
  useEffect(() => {
    if (!painterMarks || !editor) return
    const onUp = () => {
      window.setTimeout(() => {
        const { from, to } = editor.state.selection
        if (from === to) return
        const chain = editor.chain().focus()
        chain.unsetAllMarks()
        for (const [name, attrs] of Object.entries(painterMarks)) {
          if (name === "textStyle") chain.setMark("textStyle", attrs)
          else chain.setMark(name, attrs)
        }
        chain.run()
        setPainterMarks(null)
        schedulePaginate()
      }, 0)
    }
    document.addEventListener("mouseup", onUp)
    return () => document.removeEventListener("mouseup", onUp)
  }, [painterMarks, editor, schedulePaginate])

  // ── Autosave + version history ───────────────────────────────────────────────
  // The draft used to live only in localStorage: a wiped browser, a different
  // machine or a crashed tab lost the report. It now also goes to the server a
  // few seconds after typing stops, and every few minutes that save also leaves
  // a version behind (the study's existing editHistory array, which the submit
  // flow already writes to and the Versions pane reads back).
  const lastSavedBodyRef = useRef<string>("")
  const lastVersionAtRef = useRef<number>(0)
  // One save at a time: a second PATCH that starts before the first finishes
  // reads the same document version, and Mongoose rejects the loser rather than
  // letting it overwrite (VersionError). Typing simply schedules another pass.
  const savingRef = useRef(false)
  const VERSION_EVERY_MS = 3 * 60 * 1000

  useEffect(() => {
    if (!editor || isReadOnly || !paramId || !showDoc) return
    let timer = 0

    const save = async () => {
      if (savingRef.current) { schedule(); return }
      const body = readCleanBody()
      if (!body || body === lastSavedBodyRef.current) return
      savingRef.current = true
      const snapshot = Date.now() - lastVersionAtRef.current > VERSION_EVERY_MS
      setAutoSaveState("saving")
      try {
        const res = await fetch(`/api/patients/${paramId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studyIndex: paramSidx,
            reportBody: body,
            reportStatus: "in_progress",
            ...(snapshot
              ? { editHistoryEntry: { editor: user?.name || "Unknown", editedAt: new Date().toISOString(), body } }
              : {}),
          }),
        })
        if (!res.ok) throw new Error(String(res.status))
        lastSavedBodyRef.current = body
        if (snapshot) lastVersionAtRef.current = Date.now()
        setAutoSaveState("saved")
      } catch {
        // Offline, or the server rejected this pass — the localStorage draft is
        // still there, so stay quiet and try again shortly rather than leaving a
        // "Saved" that isn't true.
        setAutoSaveState("idle")
        schedule()
      } finally {
        savingRef.current = false
      }
    }

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void save() }, 4000)
    }
    editor.on("update", schedule)
    return () => { window.clearTimeout(timer); editor.off("update", schedule) }
  }, [editor, isReadOnly, paramId, paramSidx, showDoc, readCleanBody, user])

  // ── Styles ────────────────────────────────────────────────────────────────────
  // Word's Normal / Heading 1–3, as real heading nodes so the structure (not
  // just the look) survives into DOCX.
  const currentStyle: ReportStyle = editor?.isActive("heading", { level: 1 })
    ? "h1"
    : editor?.isActive("heading", { level: 2 })
      ? "h2"
      : editor?.isActive("heading", { level: 3 })
        ? "h3"
        : "normal"

  const applyStyle = (style: ReportStyle) => {
    if (!editor) return
    if (style === "normal") editor.chain().focus().setParagraph().run()
    else editor.chain().focus().setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 }).run()
    schedulePaginate()
  }

  // ── Quick phrases ─────────────────────────────────────────────────────────────
  const insertPhrase = (html: string) => {
    editor?.chain().focus().insertContent(html).run()
    schedulePaginate()
  }

  /** The current body selection as HTML + plain text, for "save as phrase". */
  const readSelectionForPhrase = () => {
    if (!editor) return { html: "", text: "" }
    const { from, to } = editor.state.selection
    if (from === to) return { html: "", text: "" }
    const slice = editor.state.doc.slice(from, to)
    const div = document.createElement("div")
    div.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
    return { html: div.innerHTML, text: editor.state.doc.textBetween(from, to, " ") }
  }

  // ── Table insert / delete ─────────────────────────────────────────────────────
  // Tables only ever make sense in the report body, so these always target
  // the editor regardless of which region last had focus.
  const insertTable = (rows: number, cols: number) => {
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run()
    schedulePaginate()
  }

  const deleteTable = () => {
    editor?.chain().focus().deleteTable().run()
    schedulePaginate()
  }

  // ── Keep a table inside the page when a column is added ─────────────────────
  // Word never lets an inserted column push a table past the margins: the new
  // column's space is taken out of the existing ones, so the table stays exactly
  // as wide as it was. Without this, columns that carry an explicit width (every
  // imported template table does) simply add up past the paper and the editor
  // shows a horizontal scrollbar for something that can never print that way.
  const refitTableColumns = () => {
    if (!editor) return
    const found = findTable(editor.state.selection.$anchor)
    if (!found) return
    const { node: table, pos } = found
    const wrapperDom = editor.view.nodeDOM(pos) as HTMLElement | null
    const tableEl = wrapperDom?.querySelector("table") as HTMLTableElement | null
    if (!tableEl) return

    // One colspan-1 cell per column carries that column's stored width.
    const map = TableMap.get(table)
    const stored: (number | null)[] = new Array(map.width).fill(null)
    for (let col = 0; col < map.width; col++) {
      for (let row = 0; row < map.height; row++) {
        const cell = table.nodeAt(map.map[row * map.width + col])
        if (!cell || cell.attrs.colspan !== 1) continue
        const w = cell.attrs.colwidth?.[0]
        if (w) { stored[col] = w; break }
      }
    }
    // Nothing was ever sized: the table is a plain 100%-wide one, which already
    // re-divides itself evenly across the new column count. Leave it alone.
    const known = stored.filter((w): w is number => w != null)
    if (known.length === 0) return

    // A column with no width of its own is the one just inserted — give it the
    // average of its siblings before everything is scaled back down to fit.
    const avg = known.reduce((a, b) => a + b, 0) / known.length
    const widths = stored.map((w) => w ?? avg)

    // A table dragged to a fixed width keeps that width; everything else is
    // measured against the text column it sits in.
    const pinned = parseFloat(String(table.attrs.width ?? ""))
    const wrapperWidth = wrapperDom?.clientWidth || tableEl.clientWidth
    const available = Number.isFinite(pinned) && pinned > 0 ? Math.min(pinned, wrapperWidth) : wrapperWidth
    if (!available) return

    const MIN_COL_PX = 24
    const total = widths.reduce((a, b) => a + b, 0)
    const factor = total > available ? available / total : 1
    const scaled = widths.map((w) => Math.max(MIN_COL_PX, Math.round(w * factor)))
    // Rounding can leave the row a pixel or two over the target; the widest
    // column absorbs the difference invisibly.
    const drift = scaled.reduce((a, b) => a + b, 0) - Math.round(total * factor)
    if (drift !== 0) {
      let widest = 0
      scaled.forEach((w, i) => { if (w > scaled[widest]) widest = i })
      scaled[widest] = Math.max(MIN_COL_PX, scaled[widest] - drift)
    }
    commitTableColumnWidths(tableEl, scaled)
  }

  // Row/column editing — no-ops when the cursor isn't inside a table cell
  // (Tiptap's own commands already handle that; nothing to guard here).
  const addTableRow = () => { editor?.chain().focus().addRowAfter().run(); schedulePaginate() }
  const deleteTableRow = () => { editor?.chain().focus().deleteRow().run(); schedulePaginate() }
  const addTableColumn = () => {
    editor?.chain().focus().addColumnAfter().run()
    refitTableColumns()
    schedulePaginate()
  }
  const deleteTableColumn = () => { editor?.chain().focus().deleteColumn().run(); schedulePaginate() }

  // The right-click menu's table half — the toolbar's own buttons only ever
  // insert after/below, so the before/left variants live here.
  const tableMenuActions = {
    insertRowAbove: () => { editor?.chain().focus().addRowBefore().run(); schedulePaginate() },
    insertRowBelow: addTableRow,
    insertColumnLeft: () => {
      editor?.chain().focus().addColumnBefore().run()
      refitTableColumns()
      schedulePaginate()
    },
    insertColumnRight: addTableColumn,
    deleteRow: deleteTableRow,
    deleteColumn: deleteTableColumn,
    deleteTable,
    fitTable: resetTableSize,
    mergeCells: () => { editor?.chain().focus().mergeCells().run(); schedulePaginate() },
    splitCell: () => { editor?.chain().focus().splitCell().run(); schedulePaginate() },
  }

  // ── Shared toolbar-button dispatch (Bold/Italic/Underline/Align/List/Clear) ──
  // Routes to the heading's execCommand (unchanged) or the body's Tiptap
  // chain, based on which region last had real focus (see lastActiveRef).
  const runFormat = (headingCmd: string, bodyRun: (e: Editor) => void) => {
    if (lastActiveRef.current === "patientBox") return   // see changeFontSize
    // The sign-off's name/credential blocks are plain contentEditables like the
    // heading, so they take the same execCommand path — but unlike the heading
    // their markup IS what gets saved (see readSigText), so the bold/italic a
    // doctor applies here survives into print, PDF and the Word download.
    if (lastActiveRef.current === "heading" || lastActiveRef.current === "signature") {
      restoreEditableSelection()
      document.execCommand(headingCmd)
      schedulePaginate()
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
    } catch { }
  }

  // ── Persist a patient-box registration field (name/referredBy/age/gender) ──
  // Same PATCH shape the registration edit page itself uses — this really is
  // editing the patient's record, not just this report's display of it.
  const saveRegistrationField = async (field: string, value: string, original: string) => {
    if (!paramId || !value || value === original) return
    try {
      await fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
    } catch { }
  }

  // ── Persist the report date — a per-study override, not a patient field ──
  const saveReportDate = async (value: string) => {
    if (!paramId || value === date) return
    try {
      await fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studyIndex: paramSidx, reportDate: value }),
      })
    } catch { }
  }

  // ── Save draft to localStorage ───────────────────────────────────────────────
  const saveReport = () => {
    // The local draft keeps the RAW document — a reload in the middle of a
    // tracked revision must come back with the revision, not with it silently
    // accepted.
    let bodyHtml = readRawBody()
    // If editing an existing report, mark changed blocks with underline
    if (paramLoad && originalBodyRef.current) {
      bodyHtml = markChanges(originalBodyRef.current, bodyHtml)
    }
    writeDraft({
      body: bodyHtml,
      docTitle: titleRef.current?.innerText?.trim() || undefined,
    })
  }

  // ── Print / PDF ──────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const html = buildPrintHtml({
      patient: localPatientName || patient,
      study: getDocTitle(),
      body: readCleanBody(),
      age: localAge || age,
      gender: localGender || gender,
      contact,
      refBy: localRefBy || refBy,
      date: localReportDate || date,
      srNo: localSrNo || srNo,
      titleFont: headingFont,
      patientBoxFont,
      signatories: reportSignatories,
      signatureLayouts: readSignatureLayout(),
      headerPx,
      footerPx,
      pageCount: numPages,
      topSpacerPx: topSpacerLines * 24,
    })
    const win = window.open("", "_blank", "width=820,height=1000")
    if (!win) {
      void notify({ title: "Pop-up blocked", message: "Allow pop-ups for this site to print the report." })
      return
    }
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
      // The blank lines above the patient box are content in Word, so they are
      // part of the PDF too — not just something the on-screen page shows.
      topSpacerHtml: topSpacerLines ? `<div style="height:${topSpacerLines * 24}px"></div>` : "",
      headerHtml: reportHeaderHtml({
        name: localPatientName || patient, refBy: localRefBy || refBy, date: localReportDate || date,
        age: localAge || age, gender: localGender || gender, srNo: localSrNo || srNo,
      }, patientBoxFont),
      titleHtml: reportTitleHtml(submittedDocTitle || getDocTitle(), submittedHeadingFont ?? headingFont),
      bodyHtml,
      signaturesHtml: signatureColumnsHtml(reportSignatories, readSignatureLayout()),
      headerTopPx: headerPx,
      footerBottomPx: footerPx,
    })
  }

  // ── Share on WhatsApp: upload PDF → share download link ─────────────────────
  const handleShare = async (to: "patient" | "doctor") => {
    if (!paramId) return
    setShareLoading(true)

    const cleanHtml = stripEditedSpans(readCleanBody())
    const num = to === "patient" ? contact.replace(/\D/g, "") : ""

    try {
      const pdfBlob = await buildPdfBlob(cleanHtml)
      const arrayBuf = await pdfBlob.arrayBuffer()
      const bytes = new Uint8Array(arrayBuf)
      let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
      const base64 = btoa(binary)

      const res = await fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportPdf: base64, studyIndex: paramSidx, signatureLayout: readSignatureLayout() }),
      })
      const data = await res.json()
      const slug = data?.patient?.studies?.[paramSidx]?.reportSlug || data?.patient?.reportSlug
      const pdfUrl = reportShareUrl(window.location.origin, { slug, patientId: paramId, sidx: paramSidx })

      const shareName = localPatientName || patient
      const msg = to === "patient"
        ? `Dear ${shareName},\n\nYour *${study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
        : `*Aarya Diagnostics Center*\nReport: *${shareName}* — *${study}*\nDate: ${localReportDate || date}\n\n📄 Download PDF:\n${pdfUrl}`

      // Mobile Direct Share
      if (navigator.share && navigator.canShare) {
        const file = new File([pdfBlob], `Report_${shareName.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Report - ${shareName}`,
            text: to === "patient"
              ? `Dear ${shareName}, your ${study} report from Aarya Diagnostics Center is ready.`
              : `Aarya Diagnostics Center: Report ${shareName} — ${study}`,
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
    } catch { }

    setShareLoading(false)
  }

  // ── Decode base64 and trigger browser download ──────────────────────────────
  const downloadDocxFromBase64 = (base64: string, filename: string) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
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
      <div ref={stickyHeaderRef} className="sticky -top-4 lg:-top-6 z-20 bg-white border-b shadow-sm">

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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shadow-sm ${showTemplates
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
            {/* Print the report as it stands, without having to submit first */}
            {showDoc && (
              <motion.button
                type="button"
                onClick={handlePrint}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                title="Print report"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
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

        {/* ── Ribbon: Word's tabbed toolbar ── */}
        {!isReadOnly && (
          <>
            <RibbonTabBar
              tab={ribbonTab}
              onTab={setRibbonTab}
              right={
                <span className="whitespace-nowrap text-[11px] text-gray-400">
                  {autoSaveState === "saving" ? "Saving…" : autoSaveState === "saved" ? "Saved" : ""}
                  {autoSaveState !== "idle" ? " · " : ""}
                  {numPages} page{numPages === 1 ? "" : "s"} · {docStats.words} words · {docStats.chars} characters
                </span>
              }
            />

            <RibbonBar>
              {ribbonTab === "Home" && (
                <>
                  <RibbonGroup label="Undo">
                    <FmtBtn onRun={() => runFormat("undo", (e) => { e.chain().focus().undo().run() })}
                      label={<Undo2 className="h-3.5 w-3.5" />} title="Undo (Ctrl+Z)" />
                    <FmtBtn onRun={() => runFormat("redo", (e) => { e.chain().focus().redo().run() })}
                      label={<Redo2 className="h-3.5 w-3.5" />} title="Redo (Ctrl+Y)" />
                    <button
                      type="button"
                      title="Format painter — pick up this text's formatting, then select the text to paint it onto"
                      onMouseDown={(e) => { e.preventDefault(); toggleFormatPainter() }}
                      className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${painterMarks ? "bg-blue-100 text-blue-700" : "hover:bg-gray-200 text-gray-700"
                        }`}
                    >
                      <Paintbrush className="h-3.5 w-3.5" />
                    </button>
                  </RibbonGroup>

                  <RibbonGroup label="Font">
                    <FontPicker value={fontFamily} onPick={applyFontFamily} />
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
                    <FmtBtn onRun={() => runFormat("bold", (e) => { e.chain().focus().toggleBold().run() })}
                      label={<Bold className="h-3.5 w-3.5 stroke-[2.5]" />} title="Bold (Ctrl+B)" />
                    <FmtBtn onRun={() => runFormat("italic", (e) => { e.chain().focus().toggleItalic().run() })}
                      label={<Italic className="h-3.5 w-3.5" />} title="Italic (Ctrl+I)" />
                    <FmtBtn onRun={() => runFormat("underline", (e) => { e.chain().focus().toggleUnderline().run() })}
                      label={<Underline className="h-3.5 w-3.5" />} title="Underline (Ctrl+U)" />
                    <FmtBtn onRun={() => runFormat("strikeThrough", (e) => { e.chain().focus().toggleStrike().run() })}
                      label={<Strikethrough className="h-3.5 w-3.5" />} title="Strikethrough" />
                    <FmtBtn onRun={() => runFormat("superscript", (e) => { e.chain().focus().toggleSuperscript().run() })}
                      label={<SuperscriptIcon className="h-3.5 w-3.5" />} title="Superscript — cm², mm³" />
                    <FmtBtn onRun={() => runFormat("subscript", (e) => { e.chain().focus().toggleSubscript().run() })}
                      label={<SubscriptIcon className="h-3.5 w-3.5" />} title="Subscript" />
                    <ColorPicker
                      kind="text"
                      value={textColor ?? undefined}
                      onPick={applyTextColor}
                      onClear={() => applyTextColor(null)}
                    />
                    <ColorPicker
                      kind="highlight"
                      value={highlightColor ?? undefined}
                      onPick={applyHighlight}
                      onClear={() => applyHighlight(null)}
                    />
                    <FmtBtn onRun={() => runFormat("removeFormat", (e) => { e.chain().focus().unsetAllMarks().clearNodes().run() })}
                      label={<span className="text-[11px] text-gray-400 font-medium">Clear</span>} title="Clear formatting" />
                  </RibbonGroup>

                  <RibbonGroup label="Paragraph">
                    <FmtBtn onRun={() => runFormat("justifyLeft", (e) => { e.chain().focus().setTextAlign("left").run() })}
                      label={<AlignLeft className="h-3.5 w-3.5" />} title="Align left" />
                    <FmtBtn onRun={() => runFormat("justifyCenter", (e) => { e.chain().focus().setTextAlign("center").run() })}
                      label={<AlignCenter className="h-3.5 w-3.5" />} title="Center" />
                    <FmtBtn onRun={() => runFormat("justifyRight", (e) => { e.chain().focus().setTextAlign("right").run() })}
                      label={<AlignRight className="h-3.5 w-3.5" />} title="Align right" />
                    <FmtBtn onRun={() => runFormat("insertUnorderedList", (e) => { e.chain().focus().toggleBulletList().run() })}
                      label={<List className="h-3.5 w-3.5" />} title="Bullet list" />
                    <FmtBtn onRun={() => runFormat("insertOrderedList", (e) => { e.chain().focus().toggleOrderedList().run() })}
                      label={<span className="text-[11px] font-semibold">1.</span>} title="Numbered list" />
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value
                        e.target.value = ""
                        if (!v) return
                        if (v.startsWith("start:")) editor?.chain().focus().setListStart(Number(v.slice(6))).run()
                        else editor?.chain().focus().setListStyle(v).run()
                        schedulePaginate()
                      }}
                      className="h-7 mr-1 rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-700 focus:border-blue-400 focus:outline-none"
                      title="List style (click inside a list first)"
                    >
                      <option value="" disabled>List</option>
                      {BULLET_STYLES.map((s) => <option key={s} value={s}>• {s}</option>)}
                      {ORDERED_STYLES.map((s) => <option key={s} value={s}>1. {s}</option>)}
                      <option value="start:1">Restart at 1</option>
                    </select>
                    <FmtBtn onRun={() => changeIndent(-1)}
                      label={<IndentDecrease className="h-3.5 w-3.5" />} title="Decrease indent (Shift+Tab)" />
                    <FmtBtn onRun={() => changeIndent(1)}
                      label={<IndentIncrease className="h-3.5 w-3.5" />} title="Increase indent (Tab)" />
                    <ParagraphMenu
                      onIndent={changeIndent}
                      onFormat={setParagraphSpacing}
                      onLineSpacing={applyLineSpacing}
                    />
                  </RibbonGroup>

                  <RibbonGroup label="Styles">
                    <StyleGallery value={currentStyle} onPick={applyStyle} />
                  </RibbonGroup>

                  <RibbonGroup label="Editing">
                    <button
                      type="button"
                      title="Find and replace (Ctrl+H)"
                      onMouseDown={(e) => { e.preventDefault(); setFindMode("replace") }}
                      className="h-7 px-2 flex items-center gap-1 rounded hover:bg-gray-200 text-gray-700 transition-colors text-[11px] font-medium"
                    >
                      <SearchIcon className="h-3.5 w-3.5" />Find
                    </button>
                  </RibbonGroup>
                </>
              )}

              {ribbonTab === "Insert" && (
                <>
                  <RibbonGroup label="Table">
                    <TableGridPicker onPick={insertTable} />
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
                    <button
                      type="button" title="Reset this table's size — clears the dragged column widths and row heights so it goes back to full width with rows only as tall as their text (click inside a table first)"
                      onMouseDown={(e) => { e.preventDefault(); resetTableSize() }}
                      className="h-7 px-1.5 flex items-center justify-center rounded hover:bg-gray-200 text-gray-700 transition-colors text-[10px] font-semibold"
                    >
                      Fit
                    </button>
                  </RibbonGroup>

                  <RibbonGroup label="Cells">
                    <ColorPicker
                      kind="highlight"
                      value={undefined}
                      onPick={(c) => { editor?.chain().focus().setCellShading(c).run(); schedulePaginate() }}
                      onClear={() => { editor?.chain().focus().setCellShading(null).run(); schedulePaginate() }}
                    />
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value
                        e.target.value = ""
                        if (!v || !editor) return
                        if (v === "header") editor.chain().focus().toggleHeaderRow().run()
                        else if (v === "borders") editor.chain().focus().toggleTableBorders().run()
                        else editor.chain().focus().setCellVerticalAlign(v as "top" | "middle" | "bottom").run()
                        schedulePaginate()
                      }}
                      className="h-7 mr-1 rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-700 focus:border-blue-400 focus:outline-none"
                      title="Table options (click inside a table first)"
                    >
                      <option value="" disabled>Cells</option>
                      <option value="header">Header row on/off (repeats on every page)</option>
                      <option value="borders">Borders on/off</option>
                      <option value="top">Align top</option>
                      <option value="middle">Align middle</option>
                      <option value="bottom">Align bottom</option>
                    </select>
                  </RibbonGroup>

                  <RibbonGroup label="Illustrations">
                    <button
                      type="button"
                      title="Insert a signature (draw, type or upload). Once placed, click it for the same picture toolbar as an image — text wrapping (Behind Text / In Front of Text) and Glow Edges to remove a scanned signature's white background."
                      onMouseDown={(e) => { e.preventDefault(); openSignaturePad() }}
                      className="h-7 px-2 flex items-center gap-1 rounded hover:bg-gray-200 text-gray-700 transition-colors text-[11px] font-medium"
                    >
                      <PenTool className="h-3.5 w-3.5" />Signature
                    </button>
                    <button
                      type="button"
                      title="Insert an image (or just paste / drag one into the report). Click an inserted image for Word-style text wrapping — including Behind Text — and the Glow Edges effect that removes its background."
                      onMouseDown={(e) => { e.preventDefault(); imageInputRef.current?.click() }}
                      className="h-7 px-2 flex items-center gap-1 rounded hover:bg-gray-200 text-gray-700 transition-colors text-[11px] font-medium"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />Image
                    </button>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        void onImageFilesPicked(e.target.files)
                        // Cleared so picking the same file twice in a row still fires
                        // a change event (the browser suppresses it otherwise).
                        e.target.value = ""
                      }}
                    />
                  </RibbonGroup>

                  <RibbonGroup label="Text">
                    <SymbolPicker onPick={insertSymbol} />
                    <QuickPhrases onInsert={insertPhrase} getSelectionHtml={readSelectionForPhrase} />
                  </RibbonGroup>

                  <RibbonGroup label="Breaks">
                    <button
                      type="button"
                      title="Page break — start a new sheet here (Ctrl+Enter)"
                      onMouseDown={(e) => { e.preventDefault(); insertPageBreak() }}
                      className="h-7 px-2 flex items-center gap-1 rounded hover:bg-gray-200 text-gray-700 transition-colors text-[11px] font-medium"
                    >
                      <SeparatorHorizontal className="h-3.5 w-3.5" />Page break
                    </button>
                  </RibbonGroup>
                </>
              )}

            </RibbonBar>
          </>
        )}

        {/* Find & replace — docked under the toolbar, like Word's pane */}
        {!isReadOnly && findMode && (
          <FindReplacePanel editor={editor} mode={findMode} onClose={() => setFindMode(null)} />
        )}
      </div>

      {/* ── Document area ── */}
      <div className="flex flex-col sm:flex-row flex-1 min-h-screen bg-slate-200">

        {/* ── Templates — a separate panel to the left of the document, never
            overlapping or sitting inside the report itself. It sticks below the
            toolbar at a fixed height so the list scrolls inside the panel rather
            than with the page (3.5rem is the app header above the scroller). ── */}
        <AnimatePresence>
          {showTemplates && (
            <motion.aside
              key="template-sidebar"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              style={{ "--tpl-top": `${toolbarBottom}px` } as React.CSSProperties}
              className="w-full sm:w-[300px] shrink-0 bg-white border-b sm:border-b-0 sm:border-r border-gray-200 flex flex-col sm:sticky sm:self-start sm:top-[var(--tpl-top)] sm:h-[calc(100dvh-3.5rem-var(--tpl-top))]"
            >
              {/* Sidebar header — the one part that stays put, so the panel can
                  always be closed however far down the list you are */}
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
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

              {/* Everything below the header scrolls as ONE column. The search box
                  and the category buttons used to be pinned above a list scrolling
                  in what was left — about 280px, two cards deep on a laptop. They
                  scroll away with the list now, so the full height of the panel
                  goes to templates. On a narrow window the panel has no height of
                  its own (it sits above the document rather than beside it), so it
                  is capped there instead of running the length of the page. */}
              <div className="flex-1 min-h-0 overflow-y-auto max-h-[65vh] sm:max-h-none">

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
                          className={`px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors truncate ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600"
                            }`}
                          title={categoryTabLabel(cat)}
                        >
                          {categoryTabLabel(cat)}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Adding a template happens right here — leaving the editor for
                    the Add Template page meant abandoning the report being
                    written. Removing one still lives on that page. */}
                <div className="px-4 pt-3">
                  <button
                    type="button"
                    onClick={() => setAddTemplateOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" />Add Template
                  </button>
                </div>

                {/* Count label */}
                <p className="px-4 pt-3 text-[11px] text-gray-400">
                  {(templateSearchResults ?? allTemplates(templateTab)).length} template
                  {(templateSearchResults ?? allTemplates(templateTab)).length !== 1 ? "s" : ""}
                </p>

                {/* Template list — single column, inside the panel's own scroller so
                    it never needs to push or overlap the document beside it. */}
                <div className="px-4 py-3 space-y-2">
                  {templateSearchResults !== null ? (
                    templateSearchResults.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-8">No templates match &ldquo;{templateSearch}&rdquo;.</p>
                    ) : (
                      templateSearchResults.map((tpl) => (
                        <TemplateCard
                          key={tpl.id}
                          tpl={tpl}
                          categoryLabel={categoryTabLabel(tpl.category)}
                          onApply={() => { void applyTemplate(tpl) }}
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
                              onApply={() => { void applyTemplate(tpl) }}
                            />
                          ))
                        )}
                      </motion.div>
                    </AnimatePresence>
                  )}
                </div>

              </div>{/* end of the panel's scroller */}
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── The document itself — untouched by the templates panel above ── */}
        <div className="py-8 px-4 flex-1 min-h-screen">
          <div
            ref={wrapRef}
            className="relative max-w-[794px] mx-auto"
            // `zoom` rather than a transform: it reflows, so the sheet backdrop,
            // the caret and every drag handle stay aligned with the text. What
            // measures the document divides its rects back out (see zoomRef).
            style={{ minHeight: `${numPages * A4_STRIDE - A4_GAP_PX}px`, zoom }}
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
                    <span
                      className="absolute right-3 bg-blue-50 text-blue-400 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-blue-100 uppercase tracking-wider"
                      style={{ bottom: `${footerPx - 22}px` }}
                    >
                      Page {i + 1} of {numPages}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Draggable header/footer letterhead lines, on their own top-level
              overlay. This CANNOT live inside the sheet-backdrop div above:
              that div sets z-0, which makes it its own stacking context —
              anything nested inside it (even with a higher z-index) is
              confined beneath that context's level, so it would sit under
              the z-10 content overlay below and silently never receive the
              pointer events needed to drag it, despite being visually on top. */}
            {showDoc && study && !isReadOnly && (
              <div aria-hidden className="absolute inset-0 z-30 pointer-events-none">
                {Array.from({ length: numPages }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0"
                    style={{ top: `${i * A4_STRIDE}px`, height: `${A4_PAGE_PX}px` }}
                  >
                    {/* The dashed line itself must NOT take pointer events.
                      It used to: the whole full-width strip was
                      pointer-events-auto, so it sat over the text like an
                      invisible ruler and swallowed every click that landed on
                      a line of the report crossing it — the caret simply
                      refused to go where you clicked (two dead bands per page,
                      on every page). Only the small grab pill is interactive
                      now, and it lives out in the left margin gutter rather
                      than centred over the text column, so no word anywhere on
                      the page is unclickable. */}
                    <div
                      className="absolute inset-x-0 h-3 -mt-1.5 pointer-events-none flex items-center"
                      style={{ top: `${headerPx}px` }}
                    >
                      <div className="w-full border-b border-dashed border-blue-300" />
                      <div
                        onPointerDown={beginResizeHeader}
                        title="Drag to resize the header space"
                        className="absolute left-1.5 h-3 w-12 pointer-events-auto cursor-row-resize group flex items-center justify-center"
                      >
                        <span className="h-1.5 w-full rounded-full bg-blue-300 group-hover:bg-blue-500 transition-colors" />
                      </div>
                    </div>
                    {i === 0 && draggingBand === "header" && (
                      <span
                        className="absolute left-3 pointer-events-none bg-blue-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
                        style={{ top: `${headerPx + 5}px` }}
                      >
                        Header {Math.round(headerPx / MM_TO_PX)}mm
                      </span>
                    )}

                    {/* Same as the header line above — visual only, with the
                      grab pill confined to the left margin gutter. */}
                    <div
                      className="absolute inset-x-0 h-3 -mb-1.5 pointer-events-none flex items-center"
                      style={{ bottom: `${footerPx}px` }}
                    >
                      <div className="w-full border-b border-dashed border-blue-300" />
                      <div
                        onPointerDown={beginResizeFooter}
                        title="Drag to resize the footer space"
                        className="absolute left-1.5 h-3 w-12 pointer-events-auto cursor-row-resize group flex items-center justify-center"
                      >
                        <span className="h-1.5 w-full rounded-full bg-blue-300 group-hover:bg-blue-500 transition-colors" />
                      </div>
                    </div>
                    {i === 0 && draggingBand === "footer" && (
                      <span
                        className="absolute left-3 pointer-events-none bg-blue-600 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
                        style={{ bottom: `${footerPx + 5}px` }}
                      >
                        Footer {Math.round(footerPx / MM_TO_PX)}mm
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Content overlay — transparent; sits on top of the sheets */}
            <div
              ref={paperRef}
              className="report-paper relative z-10 px-4 sm:px-14"
              style={{ paddingTop: `${headerPx}px`, paddingBottom: `${footerPx}px` }}
              onClick={(e) => { if (e.target === e.currentTarget) { editor?.chain().focus('start').run() } }}
            >

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
                  {/* ── The empty line above the patient box ──
                  Word opens a report with the caret in a blank paragraph above
                  the patient table; pressing Enter there walks the whole report
                  down the page. The patient box and heading here are React
                  elements rather than document nodes, so this stands in for that
                  paragraph: click it for a caret, Enter adds a blank line,
                  Backspace takes one away. The lines are real height in the
                  flow, but they are inserted below the patient box (see further
                  down) so the box itself never moves. */}
                  {!isReadOnly && (
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      data-top-spacer=""
                      title="Press Enter to push the report down, Backspace to pull it back up"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          setTopSpacerLines((n) => Math.min(30, n + 1))
                        } else if (e.key === "Backspace" || e.key === "Delete") {
                          e.preventDefault()
                          setTopSpacerLines((n) => Math.max(0, n - 1))
                        } else if (e.key.length === 1) {
                          // It is space, not a paragraph — the report's own text
                          // belongs in the body below.
                          e.preventDefault()
                        }
                        schedulePaginate()
                      }}
                      className="relative z-30 outline-none cursor-text"
                      style={{ height: "24px" }}
                    />
                  )}

                  {/* Patient info — every field editable in place (except study),
                  matches the printed report header. Name/Ref By/Age/Sex edit
                  the patient's actual registration record (so bills and other
                  studies for the same patient stay in sync); Date is a
                  per-report override since it isn't a stored patient field. */}
                  <div
                    ref={patientBoxRef}
                    style={{
                      transform: (patientBoxOffsetX || patientBoxOffsetY) ? `translate(${patientBoxOffsetX}px, ${patientBoxOffsetY}px)` : undefined,
                      ...(patientBoxWidthPx ? { width: `${patientBoxWidthPx}px`, marginInline: "auto" } : {}),
                      ...(patientBoxFont ? { fontFamily: patientBoxFont } : {}),
                    }}
                    // Clicking or tabbing anywhere in the box aims the toolbar's
                    // font dropdown at it (capture phase so the inner inputs
                    // count too). The font then applies to the whole box, the
                    // same whole-element model the study heading uses.
                    onPointerDownCapture={targetPatientBox}
                    onFocusCapture={targetPatientBox}
                    className="relative z-40 group mb-3 border-[6px] border-double border-black px-3.5 sm:px-5 py-2 sm:py-2.5 flex flex-col sm:flex-row justify-between gap-3 sm:gap-6 text-[13px] font-bold text-gray-900 transition-transform duration-75"
                  >
                    {!isReadOnly && (
                      <>
                        <div
                          onPointerDown={beginDragPatientBox}
                          className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 border border-blue-700 shadow-md rounded-full px-3 py-1 flex items-center gap-1.5 cursor-grab active:cursor-grabbing text-xs text-white font-medium z-30 select-none hover:bg-blue-700 transition-colors"
                          title="Hold and drag to move patient box anywhere on the document"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                          <span>Drag position</span>
                          <div className="flex items-center gap-0.5 ml-1 border-l border-blue-400 pl-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => { setPatientBoxOffsetY((prev) => prev - 25); schedulePaginate() }}
                              className="p-0.5 hover:bg-blue-800 rounded transition-colors text-white"
                              title="Move up 25px"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPatientBoxOffsetY((prev) => prev + 25); schedulePaginate() }}
                              className="p-0.5 hover:bg-blue-800 rounded transition-colors text-white"
                              title="Move down 25px"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                            {(patientBoxOffsetX !== 0 || patientBoxOffsetY !== 0) && (
                              <button
                                type="button"
                                onClick={() => { setPatientBoxOffsetX(0); setPatientBoxOffsetY(0); schedulePaginate() }}
                                className="text-[9px] underline ml-1 hover:text-blue-200"
                                title="Reset position back to top"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </div>
                        <div
                          onPointerDown={beginResizePatientBox}
                          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-blue-600 hover:bg-blue-700 shadow-md rounded-full flex items-center justify-center cursor-ew-resize text-white z-30 select-none"
                          title="Drag left/right to resize patient box width"
                        >
                          <Move className="h-3.5 w-3.5" />
                        </div>
                      </>
                    )}
                    <div className="space-y-1 min-w-0">
                      <EditableInfoLine
                        label="NAME" value={localPatientName} editing={!isReadOnly && editingPatientName} isReadOnly={isReadOnly}
                        onStartEdit={() => setEditingPatientName(true)}
                        onChange={setLocalPatientName}
                        onCommit={() => { setEditingPatientName(false); void saveRegistrationField("name", localPatientName, patient) }}
                        onCancel={() => { setLocalPatientName(patient); setEditingPatientName(false) }}
                        placeholder="Patient name"
                      />
                      <EditableInfoLine
                        label="REF. BY" value={localRefBy || "SELF"} editing={!isReadOnly && editingRefBy} isReadOnly={isReadOnly}
                        onStartEdit={() => setEditingRefBy(true)}
                        onChange={setLocalRefBy}
                        onCommit={() => { setEditingRefBy(false); void saveRegistrationField("referredBy", localRefBy, refBy) }}
                        onCancel={() => { setLocalRefBy(refBy); setEditingRefBy(false) }}
                        placeholder="Referring doctor"
                      />
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
                      <EditableInfoLine
                        label="DATE" value={localReportDate} editing={!isReadOnly && editingReportDate} isReadOnly={isReadOnly}
                        onStartEdit={() => setEditingReportDate(true)}
                        onChange={setLocalReportDate}
                        onCommit={() => { setEditingReportDate(false); void saveReportDate(localReportDate) }}
                        onCancel={() => { setLocalReportDate(date); setEditingReportDate(false) }}
                        uppercase={false}
                        placeholder="e.g. 25 Jul 2026"
                      />
                      <EditableInfoLine
                        label="AGE" value={localAge} editing={!isReadOnly && editingAge} isReadOnly={isReadOnly}
                        onStartEdit={() => setEditingAge(true)}
                        onChange={(v) => setLocalAge(v.replace(/\D/g, ""))}
                        onCommit={() => { setEditingAge(false); void saveRegistrationField("age", localAge, age) }}
                        onCancel={() => { setLocalAge(age); setEditingAge(false) }}
                        inputMode="numeric"
                        placeholder="Age"
                      />
                      {!isReadOnly && editingGender ? (
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <span className="shrink-0">SEX -</span>
                          <select
                            autoFocus
                            value={localGender}
                            onChange={(e) => {
                              setLocalGender(e.target.value)
                              setEditingGender(false)
                              void saveRegistrationField("gender", e.target.value, gender)
                            }}
                            onBlur={() => setEditingGender(false)}
                            className="border-0 border-b border-blue-400 text-[13px] font-bold text-gray-900 bg-transparent focus:outline-none px-0 py-px"
                          >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0">SEX -</span>
                          <span className="flex items-center gap-2">
                            <span>{(localGender || "—").toUpperCase()}</span>
                            {!isReadOnly && (
                              <button
                                type="button"
                                onClick={() => setEditingGender(true)}
                                className="flex items-center gap-0.5 text-blue-500 hover:text-blue-700 transition-colors"
                                title="Edit Sex"
                              >
                                <Pencil className="h-2.5 w-2.5" />
                                <span className="text-[10px] underline underline-offset-2">edit</span>
                              </button>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* The blank lines the caret strip above counts out. They live
                  HERE, under the patient box, so pressing Enter moves the study
                  heading and the report text down while the patient box stays
                  where the doctor put it — the box is a fixed part of the
                  letterhead, not something the typing should shove around. */}
                  {topSpacerLines > 0 && (
                    <div aria-hidden style={{ height: `${topSpacerLines * 24}px` }} />
                  )}

                  {/* Study heading — editable, boxed like the printed report */}
                  <div
                    ref={titleWrapRef}
                    style={{
                      transform: (titleBoxOffsetX || titleBoxOffsetY) ? `translate(${titleBoxOffsetX}px, ${titleBoxOffsetY}px)` : undefined,
                    }}
                    className="relative z-40 group flex justify-center mb-3 transition-transform duration-75"
                  >
                    {!isReadOnly && (
                      <div
                        onPointerDown={beginDragTitleBox}
                        className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 border border-blue-700 shadow-md rounded-full px-3 py-1 flex items-center gap-1.5 cursor-grab active:cursor-grabbing text-xs text-white font-medium z-30 select-none hover:bg-blue-700 transition-colors"
                        title="Hold and drag to move study heading box anywhere on the document"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                        <span>Drag position</span>
                        <div className="flex items-center gap-0.5 ml-1 border-l border-blue-400 pl-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => { setTitleBoxOffsetY((prev) => prev - 25); schedulePaginate() }}
                            className="p-0.5 hover:bg-blue-800 rounded transition-colors text-white"
                            title="Move up 25px"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setTitleBoxOffsetY((prev) => prev + 25); schedulePaginate() }}
                            className="p-0.5 hover:bg-blue-800 rounded transition-colors text-white"
                            title="Move down 25px"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          {(titleBoxOffsetX !== 0 || titleBoxOffsetY !== 0) && (
                            <button
                              type="button"
                              onClick={() => { setTitleBoxOffsetX(0); setTitleBoxOffsetY(0); schedulePaginate() }}
                              className="text-[9px] underline ml-1 hover:text-blue-200"
                              title="Reset position back to default"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="relative inline-block">
                      <div
                        ref={titleRef}
                        contentEditable={!isReadOnly}
                        suppressContentEditableWarning
                        spellCheck={false}
                        onFocus={() => {
                          lastActiveRef.current = "heading"
                          if (headingFont) setFontFamily(headingFont)
                        }}
                        onBlur={(e) => captureToolbarSelection(e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown" || e.key === "Enter") {
                            e.preventDefault()
                            editor?.chain().focus('start').run()
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault()
                            setEditingPatientName(true)
                          }
                        }}
                        title={isReadOnly ? undefined : "Click to edit the study heading"}
                        style={{
                          ...(headingFont ? { fontFamily: headingFont } : {}),
                          ...(titleBoxWidthPx ? { width: `${titleBoxWidthPx}px` } : {}),
                        }}
                        className={`text-center font-bold text-base py-1 px-8 min-w-[240px] border-[1.5px] border-gray-700 underline underline-offset-4 tracking-wide text-gray-900 focus:outline-none${isReadOnly ? "" : " hover:bg-blue-50/60 focus:bg-blue-50/60 transition-colors cursor-text"
                          }`}
                      />
                      {!isReadOnly && (
                        <div
                          onPointerDown={beginResizeTitleBox}
                          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-blue-600 hover:bg-blue-700 shadow-md rounded-full flex items-center justify-center cursor-ew-resize text-white z-50 pointer-events-auto select-none"
                          title="Drag left/right to resize study heading box width"
                        >
                          <Move className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Report body — editable or read-only depending on mode.
                  A generous min-height only while the body is still empty —
                  purely so a brand-new report has a comfortable area to click
                  into and start typing. Once there's real content, pagination
                  measures this element's actual rendered height to decide
                  page breaks (see `paginate` above), so a fixed min-height
                  here would inflate that measurement forever: a short report
                  would carry permanent dead space below its last line, and
                  push the signature block onto a needless extra page even
                  though there was room. Word doesn't reserve blank space
                  for text that was never typed, so neither should this. */}
                  <EditorContent
                    editor={editor}
                    className={`doc-field text-base leading-normal text-gray-900${editor?.isEmpty ? " min-h-[400px]" : ""}${isReadOnly ? " cursor-default select-text" : ""}`}
                  />

                  {/* Two-doctor signature block — name/credentials only; a stamp
                  image (if any) is placed via the freeform in-body signature
                  tool above, not a fixed slot here, so this block reserves no
                  space of its own beyond the small default gap below. Add
                  blank lines at the end of the body above to open up more
                  room before it, or drag an inserted stamp to sit right above
                  a name. */}
                  {/* Clicks in here are handled by the page-level
                      handleBodyClick above (it places the caret at the nearest
                      text position without scrolling). This used to run its own
                      `focus('end')`, which scrolls the caret into view — that
                      scroll was the "it jumps away while I'm adding something"
                      behaviour, since the end of the body can be well above the
                      signature block you just clicked. */}
                  {/* Not `select-none`: the name/credential lines are
                      contentEditable now, and a user-select:none ancestor makes
                      them impossible to select — which is exactly what stopped
                      a doctor from highlighting a name and pressing Bold. The
                      signature IMAGE still opts out of selection on its own
                      (see inlineStyle in SignatureColumns) so dragging a stamp
                      never sweeps a text selection along with it. */}
                  <div
                    ref={sigsRef}
                    className="mt-0 text-gray-900 w-full cursor-text"
                  >
                    <SignatureColumns
                      signatories={reportSignatories}
                      layouts={loadedSigLayout}
                      editable={!isReadOnly}
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

            {/* Table sizing handles — three of them, like Word: the right edge
              scales the columns, the bottom edge scales the rows, and the
              corner does both when dragged diagonally. There used to be only
              the corner one and it only ever read clientX, so a table could
              physically only be made wider or narrower — there was no way to
              change a row's height at all. Same Move-icon-in-a-circle
              affordance as the patient/heading box handles above. */}
            {tableRect && !isReadOnly && (
              <>
                <div
                  title="Drag to resize the table (columns and rows)"
                  onPointerDown={beginResizeTableBoth}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute z-20 h-3.5 w-3.5 bg-white border-2 border-blue-600 hover:bg-blue-50 shadow-sm cursor-nwse-resize select-none transition-colors"
                  style={{ top: tableRect.top + tableRect.height - 7, left: tableRect.left + tableRect.width - 7 }}
                />
                {draggingTableSize && (
                  <div
                    className="absolute z-30 pointer-events-none bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap flex flex-col gap-0.5"
                    style={{
                      top: tableRect.top + tableRect.height + 8,
                      left: tableRect.left + tableRect.width - 45,
                    }}
                  >
                    <div>Width: {draggingTableSize.width}px ({Math.round(draggingTableSize.width / MM_TO_PX)}mm)</div>
                    <div>Height: {draggingTableSize.height}px ({Math.round(draggingTableSize.height / MM_TO_PX)}mm)</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      {/* Word's right-click menu and selection mini toolbar, over the whole
          document (heading, patient box and body alike) — they run the same
          handlers as the toolbar above, so they format whichever region the
          caret is in. */}
      <EditorMenus
        editor={editor}
        containerRef={wrapRef}
        disabled={isReadOnly || !showDoc}
        actions={{
          fontFamily,
          fontSize,
          onFontFamily: applyFontFamily,
          onFontSizeStep: changeFontSize,
          onLineSpacing: applyLineSpacing,
          onBold: () => runFormat("bold", (e) => { e.chain().focus().toggleBold().run() }),
          onItalic: () => runFormat("italic", (e) => { e.chain().focus().toggleItalic().run() }),
          onUnderline: () => runFormat("underline", (e) => { e.chain().focus().toggleUnderline().run() }),
          onStrike: () => runFormat("strikeThrough", (e) => { e.chain().focus().toggleStrike().run() }),
          onSuperscript: () => runFormat("superscript", (e) => { e.chain().focus().toggleSuperscript().run() }),
          onSubscript: () => runFormat("subscript", (e) => { e.chain().focus().toggleSubscript().run() }),
          textColor: textColor ?? undefined,
          highlightColor: highlightColor ?? undefined,
          onTextColor: applyTextColor,
          onHighlight: applyHighlight,
          onSymbol: insertSymbol,
          onAlign: (align) => runFormat(
            align === "left" ? "justifyLeft" : align === "center" ? "justifyCenter" : "justifyRight",
            (e) => { e.chain().focus().setTextAlign(align).run() },
          ),
          onBulletList: () => runFormat("insertUnorderedList", (e) => { e.chain().focus().toggleBulletList().run() }),
          onOrderedList: () => runFormat("insertOrderedList", (e) => { e.chain().focus().toggleOrderedList().run() }),
          onClearFormat: () => runFormat("removeFormat", (e) => { e.chain().focus().unsetAllMarks().clearNodes().run() }),
          table: tableMenuActions,
        }}
      />

      <AddTemplateDialog
        open={addTemplateOpen}
        onClose={() => setAddTemplateOpen(false)}
        categories={allCategoryTabs}
        defaultCategory={templateTab}
        currentBodyHtml={showDoc ? readCleanBody() : ""}
        currentHeading={getDocTitle()}
        onAdded={(category, tpl) => {
          // Straight into the panel's own list, so the new template is one
          // click away without a refetch.
          setCustomTemplates((prev) => ({ ...prev, [category]: [tpl, ...(prev[category] ?? [])] }))
          setTemplateTab(category)
        }}
      />

      <SignaturePadDialog
        key={sigPadKey}
        open={sigPadOpen}
        onClose={() => setSigPadOpen(false)}
        onInsert={insertSignature}
        savedSignatures={savedSignatures}
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
