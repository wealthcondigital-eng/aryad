"use client"

import { useState, useEffect } from "react"
import { Printer, Share2, X, FileText } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { printShellHtml } from "@/lib/report-layout"
import { fetchSignatories, signatureColumnsHtml, type Signatory } from "@/lib/report-signatures"
import { SignatureColumns } from "@/components/signature-columns"

// ─── Study fields ─────────────────────────────────────────────────────────────
const STUDY_FIELDS: Record<string, { label: string; key: string }[]> = {
  "USG Abdomen": [
    { label: "LIVER", key: "liver" },
    { label: "GALL BLADDER", key: "gallBladder" },
    { label: "COMMON BILE DUCT", key: "cbd" },
    { label: "PANCREAS", key: "pancreas" },
    { label: "SPLEEN", key: "spleen" },
    { label: "RIGHT KIDNEY", key: "rightKidney" },
    { label: "LEFT KIDNEY", key: "leftKidney" },
    { label: "URINARY BLADDER", key: "bladder" },
  ],
  "USG Pelvis": [
    { label: "UTERUS", key: "uterus" },
    { label: "ENDOMETRIUM", key: "endometrium" },
    { label: "RIGHT OVARY", key: "rightOvary" },
    { label: "LEFT OVARY", key: "leftOvary" },
    { label: "URINARY BLADDER", key: "bladder" },
    { label: "FREE FLUID", key: "freeFluid" },
  ],
  "USG Abdomen & Pelvis": [
    { label: "LIVER", key: "liver" },
    { label: "GALL BLADDER", key: "gallBladder" },
    { label: "PANCREAS", key: "pancreas" },
    { label: "SPLEEN", key: "spleen" },
    { label: "RIGHT KIDNEY", key: "rightKidney" },
    { label: "LEFT KIDNEY", key: "leftKidney" },
    { label: "UTERUS", key: "uterus" },
    { label: "BOTH OVARIES", key: "ovaries" },
    { label: "URINARY BLADDER", key: "bladder" },
  ],
  "USG Thyroid & Neck": [
    { label: "RIGHT LOBE OF THYROID", key: "rightThyroid" },
    { label: "LEFT LOBE OF THYROID", key: "leftThyroid" },
    { label: "ISTHMUS", key: "isthmus" },
    { label: "NECK", key: "neck" },
  ],
}

// Default: single FINDINGS field for studies without a specific map
function getFields(study: string) {
  return STUDY_FIELDS[study] ?? [{ label: "FINDINGS", key: "findings" }]
}

// ─── Sample content for completed reports ────────────────────────────────────
const SAMPLE_CONTENT: Record<string, Record<string, string>> = {
  "USG Abdomen": {
    liver: "Both lobes of liver show normal echotexture. Liver is normal in size. Right liver span measures 12.9 cm. No focal mass lesion seen. CBD is normal. No IHBR dilatation seen. Portal vein appears normal.",
    gallBladder: "Is well distended and appears normal. Wall thickness appears normal. No calculus is seen.",
    cbd: "Not dilated. Measures 4 mm.",
    pancreas: "Appears normal in size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.",
    spleen: "Appears normal (8.5 cm) in size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.",
    rightKidney: "Measures 9.6 x 3.5 cm. Normal in size, shape and position. Normal echogenicity & echotexture. Corticomedullary differentiation preserved. No hydronephrosis.",
    leftKidney: "Measures 10.1 x 5.1 cm. Normal in size, shape and position. Normal echogenicity & echotexture.",
    bladder: "Well distended. No evidence of calculus, mass or diverticulum noted.",
    impression: "No significant abnormality is detected in this study.",
  },
  "USG Abdomen & Pelvis": {
    liver: "Both lobes of liver show normal echotexture. Liver is normal in size. Right liver span measures 12.9 cm. No focal mass lesion seen.",
    gallBladder: "Is well distended. Wall thickness appears normal. No calculus is seen.",
    pancreas: "Appears normal in size & shape. Normal echogenicity & echotexture. No focal mass lesion seen.",
    spleen: "Appears normal (8.5 cm) in size & shape. No focal mass lesion seen.",
    rightKidney: "Measures 9.6 x 3.5 cm. Normal in size, shape and echogenicity.",
    leftKidney: "Measures 10.1 x 5.1 cm. Normal in size, shape and echogenicity.",
    uterus: "Anteverted. Normal in size. Uterine myometrium shows normal echotexture. No focal mass lesion.",
    ovaries: "Both ovaries are normal in size and echotexture. Bilateral adnexa are normal.",
    bladder: "Well distended. No evidence of calculus or mass.",
    impression: "No significant abnormality is detected in this study.",
  },
  "X-Ray Chest PA": {
    findings: "Lung fields appear clear. No active consolidation or pleural effusion noted. Heart size is normal. Mediastinum appears normal. Costophrenic angles are sharp and clear. Bony thorax appears intact. No active lesion seen.",
    impression: "No significant abnormality detected.",
  },
  "X-Ray Chest AP + LAT": {
    findings: "Both lung fields are clear. No consolidation or pleural effusion. Cardiac silhouette is within normal limits. No bony abnormality seen.",
    impression: "No significant abnormality detected.",
  },
  "ECG (12 Lead)": {
    findings: "Sinus rhythm at a rate of 76 bpm. Normal P axis. Normal QRS axis. PR interval: 0.16s. QRS duration: 0.08s. No ST segment changes. No T-wave inversion. No evidence of ischemic changes. Normal sinus rhythm.",
    impression: "Normal ECG study.",
  },
  "ECG": {
    findings: "Sinus rhythm at a rate of 76 bpm. Normal P axis. Normal QRS axis. PR interval: 0.16s. QRS duration: 0.08s. No ST segment changes. No T-wave inversion.",
    impression: "Normal ECG study.",
  },
  "Complete Blood Count (CBC)": {
    findings: "Haemoglobin: 12.8 g/dL (Normal)\nTotal WBC Count: 7,200 cells/μL (Normal)\nPlatelet Count: 2.4 Lacs/μL (Normal)\nRBC Count: 4.5 million/μL (Normal)\nHaematocrit (PCV): 38% (Normal)\nMCV: 85 fL | MCH: 28 pg | MCHC: 33 g/dL\nNeutrophils: 62% | Lymphocytes: 30% | Monocytes: 5%\nEosinophils: 2% | Basophils: 1%\nPeripheral Blood Smear: No abnormal cells seen. RBCs are normocytic normochromic.",
    impression: "Complete Blood Count within normal limits.",
  },
  "MRI Brain (Plain)": {
    findings: "Brain parenchyma shows normal signal intensity on T1 and T2 weighted images. No focal signal abnormality seen. Ventricular system is normal in size and configuration. Basal ganglia and thalami appear normal. Brain stem and cerebellum appear normal. No midline shift. Cortical sulci and gyri appear normal for age. No evidence of haemorrhage or infarct. No abnormal meningeal enhancement.",
    impression: "No significant intracranial pathology detected on MRI brain.",
  },
  "MRI Spine – Lumbar": {
    findings: "Lumbar vertebral bodies show normal height and marrow signal intensity. Intervertebral disc spaces are maintained at all levels. Mild posterior disc bulge is noted at L4-L5 level. No disc extrusion or sequestration. Spinal canal is adequate in size. Posterior ligamentous complex appears intact. Paravertebral soft tissues appear normal.",
    impression: "Mild posterior disc bulge at L4-L5 without significant neural compromise.",
  },
  "MRI Spine – Cervical": {
    findings: "Cervical vertebral bodies show normal height and alignment. Physiological lordosis is maintained. Intervertebral disc spaces are maintained at all levels. No disc prolapse or herniation seen. Spinal cord shows normal signal intensity. Foraminal spaces appear adequate.",
    impression: "No significant cervical pathology detected.",
  },
  "USG Thyroid & Neck": {
    rightThyroid: "Normal in size. Measures 4.5 x 1.8 x 1.6 cm. Parenchyma shows normal homogeneous echogenicity. No focal nodular lesion seen.",
    leftThyroid: "Normal in size. Measures 4.2 x 1.7 x 1.5 cm. Parenchyma shows normal homogeneous echogenicity. No focal nodular lesion seen.",
    isthmus: "Measures 3 mm in thickness. Appears normal.",
    neck: "No cervical lymphadenopathy. No abnormal soft tissue mass seen in the neck.",
    impression: "Normal sonographic study of thyroid gland and neck.",
  },
}

function getSampleContent(study: string): Record<string, string> {
  return SAMPLE_CONTENT[study] ?? {
    findings: "Study findings recorded by the radiologist. All parameters are within normal limits.",
    impression: "No significant abnormality detected in this study.",
  }
}

// ─── Print logic ──────────────────────────────────────────────────────────────
// Print output matches the Word file: starts directly at the study heading
// (no letterhead / patient block — reports print on pre-printed stationery).
function effectiveSignatories(data: ReportViewerProps, signatories: Signatory[]): Signatory[] {
  const first: Signatory = signatories[0]
    ? { ...signatories[0], name: data.reportingDoctor ?? signatories[0].name }
    : { _id: "", name: data.reportingDoctor ?? "DR. PRADNYA GORE", credentials: ["Consultant Radiologist"], signatureImage: "" }
  const second: Signatory = signatories[1]
    ?? { _id: "", name: "DR. RAMNATH GHUTE", credentials: ["Consultant Radiologist", "M.D. Radiology"], signatureImage: "" }
  return [first, second]
}

function buildPrintHtml(data: ReportViewerProps, signatories: Signatory[]): string {
  const { name, study } = data
  const fields = getFields(study)
  const content = data.reportContent ?? getSampleContent(study)
  const sigs = effectiveSignatories(data, signatories)

  const fieldsHtml = fields.map((f) => `
    <div class="field">
      <p class="field-label">${f.label}:</p>
      <p class="field-value">${content[f.key] ?? "Not recorded."}</p>
    </div>
  `).join("")

  const extraCss = `
    .study-title { text-align: center; font-weight: bold; font-size: 12pt; text-transform: uppercase; text-decoration: underline; margin: 12px 0 18px; }
    .field { margin-bottom: 12px; }
    .field-label { font-weight: bold; text-transform: uppercase; font-size: 9.5pt; }
    .field-value { margin-top: 3px; padding-left: 10px; font-size: 9pt; white-space: pre-line; color: #333; }
    .impression { margin: 14px 0; }
    .imp-label { font-weight: bold; text-decoration: underline; text-transform: uppercase; font-size: 9.5pt; }
    .imp-value { margin-top: 3px; font-size: 9pt; font-weight: bold; }
    .sigs { display: flex; gap: 30px; margin-top: 80px; page-break-inside: avoid; break-inside: avoid; }
    .sig { flex: 1; }
    .sig-name { font-weight: bold; font-size: 10pt; text-transform: uppercase; }
    .sig-title { font-size: 8pt; color: #333; margin-top: 2px; text-transform: uppercase; }`

  return printShellHtml(`Report – ${name}`, `
  <div class="study-title">${study}</div>
  <div class="fields">${fieldsHtml}</div>
  <div class="impression">
    <p class="imp-label">IMPRESSION:</p>
    <p class="imp-value">${content["impression"] ?? "No significant abnormality detected."}</p>
  </div>
  <div class="sigs">${signatureColumnsHtml(sigs)}</div>`, extraCss)
}

async function printReport(data: ReportViewerProps) {
  const signatories = await fetchSignatories()
  const blob = new Blob([buildPrintHtml(data, signatories)], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, "_blank", "width=820,height=1000")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
}

// ─── Component ────────────────────────────────────────────────────────────────
export interface ReportViewerProps {
  open: boolean
  onClose: () => void
  srNo: number | string
  name: string
  age: number | string
  gender: string
  contact: string
  referredBy: string
  study: string
  date?: string
  reportContent?: Record<string, string>
  reportingDoctor?: string
  patientId?: string
  reportSlug?: string
}

export function ReportDocViewer(props: ReportViewerProps) {
  const { open, onClose, name, age, gender, contact, referredBy, study, date, srNo, patientId, reportSlug } = props
  const fields = getFields(study)
  const content = props.reportContent ?? getSampleContent(study)
  const today = date ?? new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  const [signatories, setSignatories] = useState<Signatory[]>([])
  useEffect(() => { fetchSignatories().then(setSignatories) }, [])
  const sigs = effectiveSignatories(props, signatories)

  const infoRows = [
    ["NAME", name.toUpperCase()],
    ["DATE", today],
    ["AGE", `${age} YRS`],
    ["REF. BY", (referredBy || "Self").toUpperCase()],
    ["SEX", gender.toUpperCase()],
    ["SR. NO", `#${srNo}`],
  ]

  const pdfUrl = reportSlug
    ? `${typeof window !== "undefined" ? window.location.origin : "https://aaryad.com"}/${reportSlug}/pdf`
    : patientId
      ? `${typeof window !== "undefined" ? window.location.origin : "https://aaryad.com"}/api/patients/${patientId}/pdf`
      : null

  const shareToPatient = () => {
    const base = `Dear ${name},\n\nYour *${study}* report from *Aarya Diagnostics Center* is ready.`
    const msg = pdfUrl ? `${base}\n\n📄 Download your report:\n${pdfUrl}` : base
    window.open(`https://wa.me/91${contact.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank")
  }

  const shareToDoctor = () => {
    const base = `*Aarya Diagnostics Center*\nReport: *${name}* — *${study}*\nDate: ${today}`
    const msg = pdfUrl ? `${base}\n\n📄 Download PDF:\n${pdfUrl}` : base
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 mx-2 sm:mx-auto">
        <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base">Diagnostic Report</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{name} · {study}</p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => void printReport(props)}>
                <Printer className="h-3.5 w-3.5" />Print Report
              </Button>
              <Button size="sm" className="gap-1.5 text-xs h-8 bg-green-600 hover:bg-green-700" onClick={shareToPatient}>
                <Share2 className="h-3.5 w-3.5" />Patient
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8 border-blue-300 text-blue-700 hover:bg-blue-50" onClick={shareToDoctor}>
                <Share2 className="h-3.5 w-3.5" />Doctor
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Document preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="border border-dashed border-slate-300 rounded-xl p-6 bg-white text-sm space-y-4">


            {/* Patient info grid */}
            <div className="text-xs border-b border-slate-200 pb-3 space-y-1">
              {infoRows.reduce<[string, string][][]>((rows, item, i) => {
                if (i % 2 === 0) rows.push([item as [string, string]])
                else rows[rows.length - 1].push(item as [string, string])
                return rows
              }, []).map((pair, i) => (
                <div key={i} className="grid grid-cols-2 gap-4">
                  {pair.map(([lbl, val]) => (
                    <div key={lbl} className="flex justify-between gap-2">
                      <span className="font-bold shrink-0">{lbl}:</span>
                      <span className="text-right">{val}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Study title */}
            <div className="text-center font-bold uppercase text-sm py-1 underline underline-offset-2 tracking-wide">
              {study}
            </div>

            {/* Fields */}
            <div className="space-y-3 text-xs">
              {fields.map((f) => (
                <div key={f.key}>
                  <p className="font-bold uppercase">{f.label}:</p>
                  <p className="mt-0.5 text-slate-700 whitespace-pre-line pl-2">
                    {content[f.key] ?? "Not recorded."}
                  </p>
                </div>
              ))}
            </div>

            {/* Impression */}
            <div className="border border-slate-300 rounded-lg p-3 bg-slate-50 text-xs">
              <p className="font-bold uppercase mb-1">IMPRESSION:</p>
              <p className="text-slate-700">{content["impression"] ?? "No significant abnormality detected."}</p>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-4 pt-16 border-t border-dashed border-slate-300 text-xs text-center">
              <SignatureColumns signatories={sigs} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
