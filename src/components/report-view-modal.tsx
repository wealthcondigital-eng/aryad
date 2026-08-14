"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Printer, Share2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reportHeaderHtml, reportTitleHtml, printShellHtml, getDisplayTitle, LETTERHEAD_TOP_PX, LETTERHEAD_BOTTOM_PX, A4_PAGE_PX, MM_TO_PX, applyReportBodySpacing, stripReportEditMarks, REPORT_BODY_STYLE, REPORT_SIGS_STYLE, paginateDomBlocks, stripPageSpacerRows, type StudyHeadingIndex } from "@/lib/report-layout"
import { fetchStudyHeadings } from "@/lib/report-templates"
import { fetchSignatories, signatureColumnsHtml, type Signatory, type SignatureLayout } from "@/lib/report-signatures"
import { SignatureColumns } from "@/components/signature-columns"
import { showAlert } from "@/components/confirm-dialog"
import { reportShareUrl } from "@/lib/share-links"

export interface ViewablePatient {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  createdAt: string
}

function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export function ReportViewModal({
  patient,
  sidx = 0,
  onClose,
}: {
  patient: ViewablePatient
  sidx?: number          // which study of the patient (each study has its own report)
  onClose: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [reportBody, setReportBody] = useState("")
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const date = dateOf(patient.createdAt)
  const [signatories, setSignatories] = useState<Signatory[]>([])
  const [signatureLayout, setSignatureLayout] = useState<(SignatureLayout | null | undefined)[]>([])
  // The doctor-edited heading, if one was saved at submit time — falls back to
  // the generic study-name-derived heading when the report predates this field
  // or the heading was never customized.
  const [savedHeading, setSavedHeading] = useState("")
  const [savedHeadingFont, setSavedHeadingFont] = useState<string | undefined>(undefined)
  const [savedBoxFont, setSavedBoxFont] = useState<string | undefined>(undefined)
  // Per-report resized top/bottom letterhead bands (set from the built-in
  // editor's drag handles) — fall back to the shared defaults when unset, so
  // older reports keep looking exactly as they always have.
  const [headerPx, setHeaderPx] = useState<number>(LETTERHEAD_TOP_PX)
  const [footerPx, setFooterPx] = useState<number>(LETTERHEAD_BOTTOM_PX)
  // A saved heading keeps the exact casing the doctor typed; only the derived
  // fallback is upper-cased (matching how the editor seeds it). The fallback
  // resolves the study to its template's heading — same index, same result as
  // the editor, so a report reads identically here, on paper and in the PDF.
  const [studyHeadings, setStudyHeadings] = useState<StudyHeadingIndex>({})
  const displayTitle = savedHeading || getDisplayTitle(patient.study, studyHeadings).toUpperCase()
  useEffect(() => { fetchSignatories().then(setSignatories) }, [])
  useEffect(() => { fetchStudyHeadings().then(setStudyHeadings) }, [])

  // Pagination: lay the preview out as A4 sheets so the doctor sees where pages
  // break, with a plain empty gap at the top (letterhead header) and bottom
  // (footer) of each page — no guide lines or labels, just casual spacing.
  const wrapRef       = useRef<HTMLDivElement>(null)
  const patientBoxRef = useRef<HTMLDivElement>(null)
  const titleWrapRef  = useRef<HTMLDivElement>(null)
  const sigsRef       = useRef<HTMLDivElement>(null)
  const rafRef        = useRef<number | undefined>(undefined)
  const [numPages, setNumPages] = useState(1)

  const A4_GAP_PX = 28
  const A4_STRIDE = A4_PAGE_PX + A4_GAP_PX

  // Body HTML without the transient pagination margins or in-table page-break
  // spacer rows (for print / share PDF). Both are this view's own layout, not
  // the report: printing them would bake this window's page breaks into the
  // paper copy, and a stray empty row into the shared PDF.
  const readCleanBody = useCallback(() => {
    const el = bodyRef.current
    if (!el) return ""
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll<HTMLElement>("[data-pgb]").forEach((n) => {
      n.style.marginTop = n.getAttribute("data-pgb-base") || ""
      n.removeAttribute("data-pgb")
      n.removeAttribute("data-pgb-base")
      if (!n.getAttribute("style")) n.removeAttribute("style")
    })
    stripPageSpacerRows(clone)
    return clone.innerHTML
  }, [])

  const paginate = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const items: HTMLElement[] = []
    if (patientBoxRef.current) items.push(patientBoxRef.current)
    if (titleWrapRef.current)  items.push(titleWrapRef.current)
    if (bodyRef.current) Array.from(bodyRef.current.children).forEach((c) => items.push(c as HTMLElement))
    if (sigsRef.current)   items.push(sigsRef.current)

    // Same measuring rules as the editor's own pagination — including breaking a
    // long table between its rows — so a report laid out to fit N pages there is
    // laid out to fit the same N pages here (see paginateDomBlocks).
    setNumPages(paginateDomBlocks({
      items,
      wrapTop: wrap.getBoundingClientRect().top,
      stride: A4_STRIDE,
      pagePx: A4_PAGE_PX,
      topPx: headerPx,
      bottomPx: footerPx,
    }))
  }, [A4_STRIDE, headerPx, footerPx])

  const schedulePaginate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => paginate())
  }, [paginate])

  useEffect(() => { setMounted(true) }, [])

  // Load: localStorage first, then MongoDB fallback (per study)
  useEffect(() => {
    const key = `aarya_report_${patient.srNo || patient.name.replace(/\s+/g, "_")}${sidx > 0 ? `_s${sidx}` : ""}`
    let hasLocal = false
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null")
      if (saved?.body) {
        setReportBody(saved.body)
        hasLocal = true
      }
    } catch {}

    fetch(`/api/patients/${patient._id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!hasLocal) {
          setReportBody(d.patient?.studies?.[sidx]?.reportBody || d.patient?.reportBody || "")
        }
        setSavedHeading(d.patient?.studies?.[sidx]?.heading || d.patient?.heading || "")
        setSavedHeadingFont(d.patient?.studies?.[sidx]?.headingFont || d.patient?.headingFont || undefined)
        setSavedBoxFont(d.patient?.studies?.[sidx]?.patientBoxFont || d.patient?.patientBoxFont || undefined)
        setHeaderPx(d.patient?.studies?.[sidx]?.headerHeightPx || d.patient?.headerHeightPx || LETTERHEAD_TOP_PX)
        setFooterPx(d.patient?.studies?.[sidx]?.footerHeightPx || d.patient?.footerHeightPx || LETTERHEAD_BOTTOM_PX)
        setSignatureLayout(d.patient?.studies?.[sidx]?.signatureLayout || [])
      })
      .catch(() => {
        if (!hasLocal) setReportBody("")
      })
      .finally(() => setLoading(false))
  }, [patient, sidx])

  // Render HTML into the body div after load — strip edit-attribution markers for clean display
  useEffect(() => {
    if (!loading && bodyRef.current) {
      const clean = stripReportEditMarks(reportBody || "")
      bodyRef.current.innerHTML =
        clean || "<em style='color:#aaa;font-size:12px'>No report content saved yet.</em>"
      applyReportBodySpacing(bodyRef.current)
      schedulePaginate()
    }
  }, [reportBody, loading, schedulePaginate])

  // Re-paginate on viewport / content-size changes (e.g. late-loading images)
  useEffect(() => {
    if (loading) return
    const bodyEl = bodyRef.current
    const ro = new ResizeObserver(schedulePaginate)
    if (bodyEl) ro.observe(bodyEl)
    // The signature block's height changes when the signatories/saved layout
    // load in — replace it too, or it can end up overlapping the footer band.
    if (sigsRef.current) ro.observe(sigsRef.current)
    window.addEventListener("resize", schedulePaginate)
    return () => { ro.disconnect(); window.removeEventListener("resize", schedulePaginate) }
  }, [loading, schedulePaginate])

  // Escape key closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  const handleShare = async () => {
    setShareLoading(true)
    const bodyHtml  = stripReportEditMarks(readCleanBody() || reportBody)
    const num = patient.contact?.replace(/\D/g, "") ?? ""

    try {
      // Rasterizes the same header/title/body/signatures markup used for
      // printing, so the exported PDF shows whatever font the browser
      // actually rendered instead of jsPDF's built-in Helvetica.
      const { buildPagedPdfBlob } = await import("@/lib/dom-to-pdf")
      const pdfBlob = await buildPagedPdfBlob({
        headerHtml: reportHeaderHtml({
          name: patient.name, refBy: patient.referredBy, date,
          age: patient.age, gender: patient.gender, srNo: patient.srNo || undefined,
        }, savedBoxFont),
        titleHtml: reportTitleHtml(displayTitle, savedHeadingFont),
        bodyHtml,
        signaturesHtml: signatureColumnsHtml(signatories, signatureLayout),
        headerTopPx: headerPx,
        footerBottomPx: footerPx,
      })
      const arrayBuf  = await pdfBlob.arrayBuffer()
      const bytes     = new Uint8Array(arrayBuf)
      let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
      const base64    = btoa(binary)

      const res  = await fetch(`/api/patients/${patient._id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reportPdf: base64, studyIndex: sidx }),
      })
      const data = await res.json()
      const slug = data?.patient?.studies?.[sidx]?.reportSlug || data?.patient?.reportSlug
      const pdfUrl = reportShareUrl(window.location.origin, { slug, patientId: patient._id, sidx })

      // Mobile Direct Share
      if (navigator.share && navigator.canShare) {
        const file = new File([pdfBlob], `Report_${patient.name.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Report - ${patient.name}`,
            text: `Dear ${patient.name}, your ${patient.study} report from Aarya Diagnostics Center is ready.`,
          })
          setShareLoading(false)
          return
        }
      }

      const msg  = `Dear ${patient.name},\n\nYour *${patient.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
      const waUrl = num ? `https://wa.me/91${num}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`
      setShareLoading(false)
      window.open(waUrl, "_blank")
      return
    } catch {}

    setShareLoading(false)
  }

  // Print output matches the printed report design: double-bordered patient
  // info box, bordered underlined study heading, body and signatures.
  const handlePrint = () => {
    const currentBody = stripReportEditMarks(readCleanBody() || reportBody)

    const html = printShellHtml(`Report – ${patient.name}`, `
${reportHeaderHtml({ name: patient.name, refBy: patient.referredBy, date, age: patient.age, gender: patient.gender, srNo: patient.srNo || undefined }, savedBoxFont)}
${reportTitleHtml(displayTitle, savedHeadingFont)}
<div class="doc-field" style="${REPORT_BODY_STYLE}">${currentBody}</div>
<div style="${REPORT_SIGS_STYLE}">${signatureColumnsHtml(signatories, signatureLayout)}</div>`, "", headerPx / MM_TO_PX, footerPx / MM_TO_PX, numPages)

    const blob = new Blob([html], { type: "text/html" })
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, "_blank", "width=820,height=1000")
    if (!win) { showAlert({ title: "Pop-up blocked", message: "Allow pop-ups for this site to print." }); URL.revokeObjectURL(url); return }
    win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
    setTimeout(() => win.print(), 600)
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(6px)", backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-[860px] max-h-[90vh] flex flex-col overflow-hidden mx-2 sm:mx-0">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 border-b bg-white shrink-0 gap-2 sm:gap-0">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{patient.name} — {patient.study}</p>
            <p className="text-xs text-muted-foreground truncate">
              #{patient.srNo} · {date} · Ref: {patient.referredBy || "Self"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 justify-end shrink-0">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handlePrint}>
              <Printer className="h-3 w-3" />Print
            </Button>
            <Button size="sm" disabled={shareLoading} className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700" onClick={handleShare}>
              {shareLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
              {shareLoading ? "Preparing..." : "Share PDF"}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable document */}
        <div className="overflow-auto flex-1 bg-slate-100 py-6 px-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-6 w-6 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
            </div>
          ) : (
            <div
              ref={wrapRef}
              className="relative max-w-[794px] mx-auto"
              style={{ minHeight: `${numPages * A4_STRIDE - A4_GAP_PX}px` }}
            >
              {/* Plain A4 sheets — each page is its own sheet with a casual empty
                  gap at top (letterhead) and bottom (footer). No lines or labels. */}
              <div aria-hidden className="absolute inset-0 z-0 pointer-events-none">
                {Array.from({ length: numPages }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 bg-white shadow-lg rounded-sm"
                    style={{ top: `${i * A4_STRIDE}px`, height: `${A4_PAGE_PX}px` }}
                  />
                ))}
              </div>

              {/* Content overlay — transparent; header/footer gaps are just empty padding */}
              <div
                className="report-paper relative z-10 px-4 sm:px-14"
                style={{ paddingTop: `${headerPx}px`, paddingBottom: `${footerPx}px` }}
              >
                {/* Patient info — matches the printed report header */}
                <div
                  ref={patientBoxRef}
                  style={savedBoxFont ? { fontFamily: savedBoxFont } : undefined}
                  className="border-[6px] border-double border-black px-3.5 sm:px-5 py-2 sm:py-2.5 mb-3 flex flex-col sm:flex-row justify-between gap-3 sm:gap-6 text-[13px] font-bold text-gray-900"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="truncate">NAME - {patient.name.toUpperCase()}</p>
                    <p className="truncate">REF. BY - {(patient.referredBy || "SELF").toUpperCase()}</p>
                    {patient.srNo > 0 && <p>SR. NO - #{patient.srNo}</p>}
                  </div>
                  <div className="space-y-1 shrink-0">
                    <p>DATE - {date}</p>
                    <p>AGE - {patient.age ? `${patient.age} YRS` : "—"}</p>
                    <p>SEX - {(patient.gender || "—").toUpperCase()}</p>
                  </div>
                </div>

                {/* Study title — boxed like the printed report */}
                <div ref={titleWrapRef} className="flex justify-center mb-3">
                  <div
                    style={savedHeadingFont ? { fontFamily: savedHeadingFont } : undefined}
                    className="text-center font-bold text-base py-1 px-8 min-w-[240px] border-[1.5px] border-gray-700 underline underline-offset-4 tracking-wide text-gray-900"
                  >
                    {displayTitle}
                  </div>
                </div>

                {/* Report body — no min-height: this modal only ever shows a
                    completed report's real content, and pagination below
                    measures this element's actual rendered height to decide
                    page breaks, same as the editor. An artificial floor here
                    would push the signature block onto an extra page whenever
                    the real body is shorter than the floor. */}
                <div
                  ref={bodyRef}
                  className="doc-field text-base leading-normal text-gray-900 whitespace-pre-wrap"
                />

                {/* Two-doctor signature block — matches print / Word */}
                <div ref={sigsRef} className="mt-0 select-none text-gray-900 w-full">
                  <SignatureColumns signatories={signatories} layouts={signatureLayout} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>,
    document.body
  )
}
