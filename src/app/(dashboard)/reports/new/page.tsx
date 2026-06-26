"use client"

import { Suspense, useRef, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Download, CheckCircle2, Loader2,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, Share2, Pencil, LayoutTemplate, Minus, Plus, ChevronDown,
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

function buildPrintHtml(opts: {
  patient: string; study: string; date: string; age: string
  gender: string; srNo: string; contact: string; refBy: string
  body: string
}): string {
  const { patient, study, date, age, gender, srNo, contact, refBy, body } = opts

  const infoRows: [string, string][] = [
    ["NAME",    patient.toUpperCase()],
    ["DATE",    date],
  ]
  if (age)     infoRows.push(["AGE",    `${age} YRS`])
  if (contact) infoRows.push(["MOBILE", contact])
  infoRows.push(["REF. BY", (refBy || "SELF").toUpperCase()])
  if (gender)  infoRows.push(["SEX",    gender.toUpperCase()])
  if (srNo)    infoRows.push(["SR. NO", `#${srNo}`])

  const infoHtml = infoRows.reduce<[string, string][][]>((rows, item, i) => {
    if (i % 2 === 0) rows.push([item])
    else rows[rows.length - 1].push(item)
    return rows
  }, []).map((pair) => `
    <div class="info-row">
      ${pair.map(([l, v]) => `<div class="info-cell"><span class="ilbl">${l}:</span><span>${v}</span></div>`).join("")}
    </div>`).join("")

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${patient}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; padding: 15mm 20mm; color: #111; }
.header { text-align: center; padding-bottom: 10px; border-bottom: 2px solid #111; margin-bottom: 14px; }
.header h1 { font-size: 15pt; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; }
.header p { font-size: 9pt; color: #555; margin-top: 4px; }
.info-row { display: flex; gap: 30px; margin-bottom: 3px; }
.info-cell { display: flex; flex: 1; gap: 6px; font-size: 9pt; }
.ilbl { font-weight: bold; min-width: 56px; }
.info-block { border-bottom: 1px solid #aaa; padding-bottom: 10px; margin-bottom: 12px; }
.study { text-align: center; font-weight: bold; font-size: 12pt; text-transform: uppercase; text-decoration: underline; margin: 12px 0 14px; }
.field { margin-bottom: 12px; }
.flbl { font-weight: bold; text-transform: uppercase; font-size: 9.5pt; }
.fval { margin-top: 3px; padding-left: 10px; font-size: 9pt; white-space: pre-line; color: #333; }
.impression { border: 1px solid #aaa; padding: 8px 12px; background: #f7f7f7; margin: 14px 0; }
.imp-lbl { font-weight: bold; text-transform: uppercase; font-size: 9.5pt; }
.imp-val { margin-top: 3px; font-size: 9pt; }
.sigs { display: flex; gap: 30px; margin-top: 35px; border-top: 1px dashed #aaa; padding-top: 18px; }
.sig { flex: 1; text-align: center; }
.sig-line { border-bottom: 1px solid #888; height: 30px; margin: 0 20px 6px; }
.sig-name { font-weight: bold; font-size: 9pt; text-transform: uppercase; }
.sig-title { font-size: 8pt; color: #666; margin-top: 2px; }
@media print { body { padding: 8mm 12mm; } }
</style></head><body>
<div class="header"><img src="/logo.jpeg" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" /><h1>Aarya Diagnostics Center</h1><p>Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086</p><p>Tel: 9819022444 &nbsp;·&nbsp; aaryadiagnosticsmumbai@gmail.com</p></div>
<div class="info-block">${infoHtml}</div>
<div class="study">${study}</div>
<div class="body" style="font-size:10pt;line-height:1.6;">${body}</div>
</body></html>`
}

// ── Report templates ─────────────────────────────────────────────────────────

type TemplateCategory = "usg" | "doppler" | "xray" | "pathology"

interface ReportTemplate { id: string; name: string; preview: string; body: string }

const REPORT_TEMPLATES: Record<TemplateCategory, ReportTemplate[]> = {
  usg: [
    {
      id: "usg-abd-pelvis-male",
      name: "USG Abd & Pelvis – Male (Normal)",
      preview: "Liver normal. GB normal. Kidneys bilateral normal. Bladder normal. Prostate normal. No free fluid.",
      body: `<b>LIVER:</b> Both lobes of liver show normal echotexture. Liver is normal in size. Right liver span measures ___ cm. No focal mass lesion seen. CBD is normal. No IHBR dilatation seen. Portal vein appears normal.<br><br><b>GALL BLADDER:</b> Is well distended and appears normal. Wall thickness appears normal. No calculus is seen.<br><br><b>PANCREAS:</b> Appears normal in size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.<br><br><b>SPLEEN:</b> Appears normal in ___ cm size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.<br><br><b>KIDNEYS:</b> Both kidneys are normal in size, shape and position. Right kidney measures ___ cm. Left kidney measures ___ cm. Both kidneys show normal echogenicity & echotexture. Corticomedullary differentiation appears normal. No evidence of hydronephrosis or hydroureter is seen. No evidence of calculi or focal mass lesion seen.<br><br><b>URINARY BLADDER:</b> The urinary bladder is well distended. No evidence of calculus is seen. No evidence of mass or diverticulum is noted.<br><br><b>PROSTATE:</b> Is normal in size. No obvious focal lesion is seen. Measures ___ cm (approx. weight – ___ gm).<br><br><b>FREE FLUID:</b> No evidence of free fluid is noted in abdomen. No obvious lymphadenopathy is seen.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "usg-abd-pelvis-female",
      name: "USG Abd & Pelvis – Female (Normal)",
      preview: "Liver, GB, Kidneys normal. Uterus anteverted normal size. Both ovaries normal. No free fluid.",
      body: `<b>LIVER:</b> Both lobes of liver show normal echotexture. Liver is normal in size. Right liver span measures ___ cm. No focal mass lesion seen. CBD is normal. No IHBR dilatation seen. Portal vein appears normal.<br><br><b>GALL BLADDER:</b> Is well distended and appears normal. Wall thickness appears normal. No calculus is seen.<br><br><b>PANCREAS:</b> Appears normal in size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.<br><br><b>SPLEEN:</b> Appears normal in ___ cm size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.<br><br><b>KIDNEYS:</b> Both kidneys are normal in size, shape and position. Right kidney measures ___ cm. Left kidney measures ___ cm. Both kidneys show normal echogenicity & echotexture. Corticomedullary differentiation appears normal. No evidence of hydronephrosis or hydroureter is seen. No evidence of calculi or focal mass lesion seen.<br><br><b>URINARY BLADDER:</b> The urinary bladder is well distended. No evidence of calculus is seen. No evidence of mass or diverticulum is noted.<br><br><b>UTERUS:</b> The uterus is anteverted. Uterus is normal in size and measures ___ cm. The uterine margins are smooth. The uterine myometrium shows normal echotexture. No solid or cystic mass lesion is noted. The endometrial thickness is ___ mm.<br><br><b>BOTH OVARIES:</b> Right ovary measures ___ × ___ cm. Left ovary measures ___ × ___ cm. Both ovaries are normal in size and echotexture. Bilateral adnexa are normal.<br><br><b>FREE FLUID:</b> No free fluid is noted in abdomen. No evidence of lymphadenopathy is seen.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "usg-abdomen-normal",
      name: "USG Abdomen – Normal",
      preview: "Liver: Normal size & echotexture. GB: thin walled. Kidneys: bilateral normal. No free fluid.",
      body: `<b>LIVER:</b> Normal in size and echotexture. No focal lesion seen. No intrahepatic biliary radicle dilatation.<br><br><b>GALL BLADDER:</b> Well distended, thin walled. No calculus or sludge seen.<br><br><b>COMMON BILE DUCT:</b> Normal calibre. Not dilated.<br><br><b>PANCREAS:</b> Normal in size and echotexture. No peripancreatic fluid collection seen.<br><br><b>SPLEEN:</b> Normal in size and echotexture. No focal lesion seen.<br><br><b>RIGHT KIDNEY:</b> Normal in size (approx. 10.5 cm), shape and echotexture. Corticomedullary differentiation well maintained. No hydronephrosis or calculus seen.<br><br><b>LEFT KIDNEY:</b> Normal in size (approx. 10.2 cm), shape and echotexture. Corticomedullary differentiation well maintained. No hydronephrosis or calculus seen.<br><br><b>URINARY BLADDER:</b> Adequately distended, thin walled. No intraluminal calculus or mass lesion seen. Post-void residue: nil.<br><br><b>FREE FLUID:</b> No free fluid seen in peritoneal cavity.<br><br><b>IMPRESSION:</b><br>Normal USG study of the abdomen. No significant abnormality detected.`,
    },
    {
      id: "usg-upper-abdomen",
      name: "USG Upper Abdomen – Normal",
      preview: "Liver, GB, Pancreas, Spleen, Kidneys all normal. No mass or free fluid.",
      body: `<b>LIVER:</b> Both lobes of liver show normal echotexture. Right lobe of liver is normal in ___ cm size. No focal mass lesion seen. CBD is normal. No IHBR dilatation seen. Portal vein appears normal.<br><br><b>GALL BLADDER:</b> Is well distended and appears normal. Wall thickness appears normal. No calculus is seen.<br><br><b>PANCREAS:</b> Appears normal in size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.<br><br><b>SPLEEN:</b> Appears normal in ___ cm size & shape & shows normal echogenicity & echotexture. No focal mass lesion seen.<br><br><b>KIDNEYS:</b> Both kidneys are normal in size, shape and position. Right kidney measures ___ cm. Left kidney measures ___ cm. Both kidneys show normal echogenicity & echotexture. Corticomedullary differentiation appears normal. No evidence of hydronephrosis or hydroureter is seen. No evidence of calculi or focal mass lesion seen.<br><br><b>IMPRESSION:</b><br>No obvious abnormality is detected in this study.`,
    },
    {
      id: "usg-abdomen-fatty-liver",
      name: "USG Abdomen – Fatty Liver",
      preview: "Liver: Mildly enlarged, increased echogenicity, fatty infiltration Grade I–II. Rest normal.",
      body: `<b>LIVER:</b> Mildly enlarged. Increased echogenicity of liver parenchyma with loss of normal vascular markings suggestive of fatty infiltration (Grade I–II). No focal lesion seen.<br><br><b>GALL BLADDER:</b> Well distended, thin walled. No calculus or sludge seen.<br><br><b>COMMON BILE DUCT:</b> Normal calibre. Not dilated.<br><br><b>PANCREAS:</b> Normal in size and echotexture.<br><br><b>SPLEEN:</b> Normal in size and echotexture.<br><br><b>RIGHT KIDNEY:</b> Normal in size, shape and echotexture. No hydronephrosis or calculus seen.<br><br><b>LEFT KIDNEY:</b> Normal in size, shape and echotexture. No hydronephrosis or calculus seen.<br><br><b>URINARY BLADDER:</b> Adequately distended, thin walled. No intraluminal calculus or mass lesion seen.<br><br><b>FREE FLUID:</b> No free fluid seen in peritoneal cavity.<br><br><b>IMPRESSION:</b><br>USG findings suggestive of fatty liver (Grade I–II). Clinical correlation advised.`,
    },
    {
      id: "usg-pelvis-ta-tvs",
      name: "USG Pelvis – Normal (TA + TVS)",
      preview: "Transabdominal + transvaginal. Uterus normal. Both ovaries normal. No POD fluid.",
      body: `<b>TECHNIQUE:</b> Transabdominal & transvaginal ultrasound is performed.<br><br><b>URINARY BLADDER:</b> The urinary bladder is well distended. No evidence of calculus is seen. No evidence of mass or diverticulum is noted.<br><br><b>UTERUS:</b> The uterus is anteverted. It measures ___ cm. The uterine margins are smooth. The uterine myometrium shows homogeneous echotexture. No solid or cystic mass lesion is noted. The endometrial thickness is ___ mm. No obvious polyp is seen in this study.<br><br><b>BOTH OVARIES:</b> Both ovaries are normal in size and echotexture. Right ovary measures ___ cm, volume ___ cc. Left ovary measures ___ cm, volume ___ cc. Bilateral adnexa are normal.<br><br><b>POUCH OF DOUGLAS:</b> No fluid is noted in the cul-de-sac.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "usg-pelvis-normal",
      name: "USG Pelvis – Normal (F)",
      preview: "Uterus: normal size & position. Both ovaries: normal. POD: no free fluid. Bladder: clear.",
      body: `<b>UTERUS:</b> Normal in size, shape and position. Endometrial thickness: ___ mm (appropriate for phase of cycle). Myometrium uniform in echotexture. No fibroid or focal lesion seen.<br><br><b>RIGHT OVARY:</b> Normal in size and echotexture. No follicular cyst or mass lesion seen. Size: approx. ___ × ___ cm.<br><br><b>LEFT OVARY:</b> Normal in size and echotexture. No follicular cyst or mass lesion seen. Size: approx. ___ × ___ cm.<br><br><b>POUCH OF DOUGLAS (POD):</b> No free fluid seen.<br><br><b>URINARY BLADDER:</b> Adequately distended, thin walled. No intraluminal calculus or mass lesion seen.<br><br><b>IMPRESSION:</b><br>Normal USG study of the pelvis. No significant abnormality detected.`,
    },
    {
      id: "usg-kub-male",
      name: "USG KUB – Male (Normal)",
      preview: "Bilateral kidneys normal. Bladder normal. Prostate normal in size. No calculus.",
      body: `<b>KIDNEYS:</b> Both kidneys are normal in size, shape and position. Right kidney measures ___ cm. Left kidney measures ___ cm. Both kidneys show normal echogenicity & echotexture. Corticomedullary differentiation appears normal. No evidence of hydronephrosis or hydroureter is seen. No evidence of calculi or focal mass lesion seen.<br><br><b>URINARY BLADDER:</b> The urinary bladder is well distended. No evidence of calculus is seen. No evidence of mass or diverticulum is noted.<br><br><b>PROSTATE:</b> Is normal in size. No obvious focal lesion is seen. Measures ___ cm (approx. weight – ___ gm).<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "usg-kub-female",
      name: "USG KUB – Female (Normal)",
      preview: "Both kidneys normal size & echotexture. Bladder normal. No calculi. No hydronephrosis.",
      body: `<b>KIDNEYS:</b> Both kidneys are normal in size, shape and position. Right kidney measures ___ cm. Left kidney measures ___ cm. Both kidneys show normal echogenicity & echotexture. Corticomedullary differentiation appears normal. No evidence of hydronephrosis or hydroureter is seen. No evidence of calculi or focal mass lesion seen.<br><br><b>URINARY BLADDER:</b> The urinary bladder is well distended. No evidence of calculus is seen. No evidence of mass or diverticulum is noted.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "usg-kub-normal",
      name: "USG KUB – Normal (with Ureters)",
      preview: "Both kidneys: normal size & echotexture. Bladder: thin walled. No calculi or hydronephrosis.",
      body: `<b>RIGHT KIDNEY:</b> Normal in size (approx. 10.5 cm), shape and echotexture. Corticomedullary differentiation well maintained. No hydronephrosis, calculus or mass lesion seen.<br><br><b>LEFT KIDNEY:</b> Normal in size (approx. 10.2 cm), shape and echotexture. Corticomedullary differentiation well maintained. No hydronephrosis, calculus or mass lesion seen.<br><br><b>URINARY BLADDER:</b> Adequately distended, thin walled. No intraluminal calculus or mass lesion seen. Post-void residue: nil.<br><br><b>URETERS:</b> Not dilated bilaterally. No obstructive calculi seen at VUJ bilaterally.<br><br><b>IMPRESSION:</b><br>Normal USG study of KUB region. No evidence of urolithiasis or obstructive uropathy.`,
    },
    {
      id: "usg-thyroid-normal",
      name: "USG Thyroid – Normal",
      preview: "Both lobes: normal size & echotexture. No nodule. Isthmus normal. No lymphadenopathy.",
      body: `<b>RIGHT LOBE OF THYROID:</b> Measures ___ × ___ × ___ cm. Normal in size and echotexture. No focal nodule or cyst seen.<br><br><b>LEFT LOBE OF THYROID:</b> Measures ___ × ___ × ___ cm. Normal in size and echotexture. No focal nodule or cyst seen.<br><br><b>ISTHMUS:</b> Measures ___ cm. Normal. No focal lesion seen.<br><br><b>NECK VESSELS:</b> Unremarkable on both sides.<br><br><b>SUBMANDIBULAR GLANDS:</b> Both submandibular glands are normal.<br><br><b>LYMPH NODES:</b> No significant cervical lymphadenopathy seen bilaterally.<br><br><b>IMPRESSION:</b><br>Normal USG study of thyroid gland. No focal lesion or lymphadenopathy identified.`,
    },
    {
      id: "usg-scrotum-normal",
      name: "USG Scrotum – Normal",
      preview: "Both testes normal size & echotexture. Epididymis normal. No varicocele. No hydrocele.",
      body: `<b>RIGHT TESTIS:</b> The right testis is normal in size and measures ___ cm. It shows normal echotexture. Normal vascularity is seen. Right epididymis is normal in size. The head of epididymis shows normal echotexture. No focal lesion is seen in the epididymis. There is no fluid in the tunica vaginalis.<br><br><b>LEFT TESTIS:</b> The left testis is normal in size and measures ___ cm. It shows normal and homogeneous echotexture. No focal lesion is seen. Left epididymis is normal in size. The head of epididymis shows normal echotexture. No focal lesion is seen in the epididymis. There is no fluid in the tunica vaginalis.<br><br><b>DOPPLER EXAMINATION:</b> Diameter of right sided vein in resting state is ___ mm and in valsalva it is ___ mm. Diameter of left sided vein in resting state is ___ mm and in valsalva it is ___ mm.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "usg-breast-mammo",
      name: "Sono-Mamography – Normal",
      preview: "Both breasts: fibroglandular parenchyma. No solid/cystic mass. No axillary lymphadenopathy. BI-RADS 1.",
      body: `<b>TECHNIQUE:</b> Real time, B mode sonography of both breasts done with 12 MHz linear probe.<br><br><b>FINDINGS:</b> The breast on both sides shows fibrofatty / fibroglandular parenchyma. The ducts are normal in caliber. No evidence of solid or cystic mass is seen in both breasts. No evidence of enlarged axillary lymphadenopathy is seen on both sides.<br><br><b>BI-RADS CLASSIFICATION:</b><br>0 – Needs supplementary / additional imaging.<br>1 – Negative – no findings.<br>2 – Benign findings.<br>3 – Probably benign – short term follow up suggested.<br>4A – Low suspicious of malignancy but needs intervention. 4B – Intermediate suspicious. 4C – High suspicious.<br>5 – Highly suggestive of malignancy.<br>6 – Biopsy proven case of malignancy.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study. BI-RADS Category 1.`,
    },
    {
      id: "usg-chest-no-effusion",
      name: "USG Chest – No Effusion",
      preview: "No pleural effusion bilaterally. Bilateral pleura normal. Diaphragm normal movement.",
      body: `<b>FINDINGS:</b> No pleural effusion seen on either side. Bilateral pleura appears normal. No evidence of pleural thickening is seen. Bilateral domes of diaphragm reveal normal movement with respiration.<br><br><b>IMPRESSION:</b><br>No pleural effusion seen bilaterally.`,
    },
    {
      id: "usg-axilla",
      name: "USG Axilla",
      preview: "Sub-centimeter non-necrotic lymph nodes bilaterally. Axillary vessels normal.",
      body: `<b>FINDINGS:</b> Multiple sub-centimeter sized non-necrotic lymph nodes are seen in both axillary regions. Axillary vessels are normal.<br><br><b>IMPRESSION:</b><br>No significant axillary lymphadenopathy detected.`,
    },
    {
      id: "usg-follicular",
      name: "Follicular Study",
      preview: "LMP noted. Follicular monitoring table with date, day of cycle, follicle sizes, endometrium.",
      body: `<b>LMP:</b> ___<br><br><b>FOLLICULAR MONITORING:</b><br><br>DATE &nbsp;·&nbsp; DAY OF CYCLE &nbsp;·&nbsp; RT OVARY FOLLICLE (mm) &nbsp;·&nbsp; LT OVARY FOLLICLE (mm) &nbsp;·&nbsp; ENDOMETRIUM (mm) &nbsp;·&nbsp; FREE FLUID<br>_____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____<br>_____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____<br>_____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____ &nbsp;·&nbsp; _____<br><br><b>IMPRESSION:</b><br>`,
    },
  ],
  doppler: [
    {
      id: "doppler-carotid-normal",
      name: "Carotid Doppler – Normal",
      preview: "Both CCA, ICA, ECA, Vertebral arteries patent with normal flow. No plaque. No stenosis.",
      body: `<b>TECHNIQUE:</b> Real-time B-mode and colour Doppler study of bilateral carotid arteries performed.<br><br><b>COMMON CAROTID ARTERY (CCA):</b><br>Right: Patent, with normal flow and spectral pattern. IMT ___ mm. PSV ___ cm/s.<br>Left: Patent, with normal flow and spectral pattern. IMT ___ mm. PSV ___ cm/s.<br><br><b>INTERNAL CAROTID ARTERY (ICA):</b><br>Right: Patent with normal flow and spectral pattern. PSV ___ cm/s.<br>Left: Patent with normal flow and spectral pattern. PSV ___ cm/s.<br><br><b>EXTERNAL CAROTID ARTERY (ECA):</b><br>Right: Normal flow, triphasic. PSV ___ cm/s.<br>Left: Normal flow, triphasic. PSV ___ cm/s.<br><br><b>VERTEBRAL ARTERY:</b><br>Right: Normal flow. PSV ___ cm/s.<br>Left: Normal flow. PSV ___ cm/s.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen on this study.`,
    },
    {
      id: "doppler-ll-venous-normal",
      name: "Lower Limb Venous Doppler – Normal",
      preview: "Bilateral deep veins patent with normal color flow. No DVT. GSV normal caliber bilaterally.",
      body: `<b>TECHNIQUE:</b> Real time, B mode ultrasound of both lower limbs was performed with high frequency linear transducer.<br><br><b>RIGHT LOWER LIMB – DEEP VEINS:</b> The deep veins of the right lower extremity including the common femoral, superficial femoral, popliteal, calf veins (anterior & posterior tibial veins) reveal clear lumen with normal color flow. No evidence of deep vein thrombosis. Right GSV is normal in caliber.<br><br><b>LEFT LOWER LIMB – DEEP VEINS:</b> The deep veins of the left lower extremity including the common femoral, superficial femoral, popliteal, calf veins (anterior & posterior tibial veins) reveal clear lumen with normal color flow. No evidence of deep vein thrombosis. Left GSV is normal in caliber.<br><br><b>IMPRESSION:</b><br>No evidence of deep venous thrombosis in bilateral lower limbs.`,
    },
    {
      id: "doppler-ll-arterial-normal",
      name: "Lower Limb Arterial Doppler – Normal",
      preview: "Bilateral CFA, SFA, Popliteal, Tibial, Dorsalis Pedis show normal triphasic/biphasic flow.",
      body: `<b>TECHNIQUE:</b> Real time, B mode sonography of lower limbs performed with high frequency linear transducer. Examination of CFA, SFA, popliteal artery, anterior & posterior tibial artery, dorsalis pedis artery performed bilaterally.<br><br><b>RIGHT LOWER LIMB ARTERIES:</b><br>Common Femoral – Triphasic, PSV ___ cm/s<br>Proximal Superficial Femoral – Triphasic, PSV ___ cm/s<br>Deep Femoral Artery – Triphasic, PSV ___ cm/s<br>Popliteal – Triphasic, PSV ___ cm/s<br>Proximal Anterior Tibial – Biphasic, PSV ___ cm/s<br>Posterior Tibial – Biphasic, PSV ___ cm/s<br>Dorsalis Pedis – Biphasic, PSV ___ cm/s<br><br><b>LEFT LOWER LIMB ARTERIES:</b><br>Common Femoral – Triphasic, PSV ___ cm/s<br>Proximal Superficial Femoral – Triphasic, PSV ___ cm/s<br>Deep Femoral Artery – Triphasic, PSV ___ cm/s<br>Popliteal – Triphasic, PSV ___ cm/s<br>Proximal Anterior Tibial – Biphasic, PSV ___ cm/s<br>Posterior Tibial – Biphasic, PSV ___ cm/s<br>Dorsalis Pedis – Biphasic, PSV ___ cm/s<br><br><b>IMPRESSION:</b><br>`,
    },
    {
      id: "doppler-portal-normal",
      name: "Portal Vein Doppler – Normal",
      preview: "Portal vein 9 mm, hepatopetal flow. Hepatic veins normal hepatofugal. No thrombosis.",
      body: `<b>PORTAL VEIN:</b> Portal vein is normal in caliber and measures 9 mm & shows hepatopetal flow. Flow velocity is normal. No evidence of thrombosis is seen.<br><br><b>HEPATIC VEINS:</b> All three hepatic veins show normal hepatofugal flow.<br><br><b>SPLENIC VEIN:</b> Splenic vein measures 8 mm & shows normal flow.<br><br><b>IMPRESSION:</b><br>No thrombosis seen in portal, splenic & hepatic veins. Normal portal Doppler study.`,
    },
    {
      id: "doppler-renal",
      name: "Renal Artery Doppler",
      preview: "Both kidneys normal. Intrarenal vessels show normal spectral waveform. No significant stenosis.",
      body: `<b>GRAY SCALE EXAMINATION:</b> Right kidney measures ___ cm. Left kidney measures ___ cm. Both kidneys are normal in size, shape, position and echotexture. Renal margins are smooth. Corticomedullary differentiation is normal. No evidence of hydronephrosis or calculus. No perinephric collection noted.<br><br><b>COLOUR DOPPLER & SPECTRAL EXAMINATION:</b> Color Doppler examination of intrarenal vessels (segmental artery – upper, mid & lower pole) & main renal artery at the hilum performed bilaterally.<br><br><b>RIGHT RENAL ARTERY:</b><br>PSV at origin: ___ cm/s &nbsp;&nbsp; PSV at hilum: ___ cm/s<br>Intrarenal upper pole RI: ___ &nbsp;&nbsp; Mid pole RI: ___<br><br><b>LEFT RENAL ARTERY:</b><br>PSV at origin: ___ cm/s &nbsp;&nbsp; PSV at hilum: ___ cm/s<br>Intrarenal upper pole RI: ___ &nbsp;&nbsp; Mid pole RI: ___<br><br><b>IMPRESSION:</b><br>No evidence of significant renal arterial stenosis.`,
    },
  ],
  xray: [
    {
      id: "xray-chest-pa-normal",
      name: "Chest PA – Normal",
      preview: "Both lung fields clear. Hila normal. CP angles clear. Cardiac silhouette normal. Bony thorax normal.",
      body: `<b>FINDINGS:</b><br><br>Both the lung fields are clear. No abnormal radio-opaque or radiolucent lesion is seen. Both hila appear normal. Both costo-phrenic angles are clear. Both domes of diaphragm are normal. Cardiac silhouette is normal. Bony thorax appears normal.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-chest-pa-lat",
      name: "Chest PA + LAT – Normal",
      preview: "Both lung fields clear. Hila normal. CP angles clear. Cardiac normal. Bony thorax normal.",
      body: `<b>FINDINGS:</b><br><br>Both the lung fields are clear. No abnormal radio-opaque or radiolucent lesion is seen. Both hila appear normal. Both costo-phrenic angles are clear. Both domes of diaphragm are normal. Cardiac silhouette is normal. Bony thorax appears normal.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-chest-pleural-effusion",
      name: "Chest PA – Pleural Effusion",
      preview: "Haziness lower zone, blunting of costophrenic angle. Tracheal shift. Pleural effusion.",
      body: `<b>FINDINGS:</b><br><br>Trachea: Shifted to the contralateral side.<br><br>Lung fields: Haziness noted at the right / left lower zone with blunting of costophrenic angle suggestive of pleural effusion. Underlying lung parenchyma partially obscured.<br><br>Hilum: Obscured on the affected side.<br><br>Heart: Cardiac silhouette partially obscured on the affected side. Mediastinal shift noted to the opposite side.<br><br>Diaphragm: Right / left dome of diaphragm not clearly visualised.<br><br>Bones: No bony abnormality.<br><br><b>IMPRESSION:</b><br>X-Ray findings suggestive of right / left pleural effusion. USG chest recommended for guided aspiration.`,
    },
    {
      id: "xray-knee-normal",
      name: "Knee – Normal",
      preview: "Tibio-femoral & patello-femoral joints normal. Joint spaces normal. No fracture.",
      body: `<b>FINDINGS:</b><br><br>Tibio-femoral and patello-femoral joints show normal alignment. Joint spaces are normal. No abnormal soft tissue calcification is noted. No focal bone lesion or fracture is noted.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-lumbar-normal",
      name: "Lumbar Spine – Normal",
      preview: "Lumbar vertebrae normal alignment. Disc spaces well maintained. No lysis/listhesis.",
      body: `<b>FINDINGS:</b><br><br>The lumbar vertebrae are normal in alignment. The vertebral bodies reveal normal architecture. All the intervertebral disc spaces are well maintained. No abnormal pre/paravertebral soft tissue shadow is seen. No evidence of lysis / listhesis / displaced fracture of vertebrae is noted.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-lumbar-degenerative",
      name: "Lumbar Spine – Degenerative",
      preview: "Reduced disc space L4-L5, L5-S1. Marginal osteophytes. Facet arthrosis. No listhesis.",
      body: `<b>FINDINGS:</b><br><br>Vertebral bodies: Maintained height. Mild loss of disc space height noted at L4-L5 and L5-S1 levels.<br><br>Intervertebral disc spaces: Reduced at L4-L5 and L5-S1 levels suggestive of degenerative disc disease.<br><br>Alignment: Normal lumbar lordosis maintained. No spondylolisthesis or spondylolysis seen.<br><br>Facet joints: Facet joint arthrosis noted at lower lumbar levels.<br><br>Osteophytes: Marginal osteophytic lipping noted at L4-L5 and L5-S1 vertebral bodies.<br><br>Sacroiliac joints: Normal.<br><br>Bones: No fracture or lytic/sclerotic lesion.<br><br><b>IMPRESSION:</b><br>Degenerative disc disease at L4-L5 and L5-S1 with facet arthrosis. MRI lumbar spine recommended for further evaluation.`,
    },
    {
      id: "xray-cervical-normal",
      name: "Cervical Spine – Normal",
      preview: "Vertebrae normal alignment & curvature. Disc spaces normal. No spondylolysis.",
      body: `<b>FINDINGS:</b><br><br>The vertebrae are normal in alignment and curvature. The vertebral bodies are normal in architecture. Intervertebral disc spaces are normal. No spondylolysis or spondylolisthesis is noted. No abnormal pre/paravertebral soft tissue shadow is seen.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-dorsal-normal",
      name: "Dorsal Spine – Normal",
      preview: "Vertebrae normal alignment. Vertebral bodies normal architecture. Disc spaces normal.",
      body: `<b>FINDINGS:</b><br><br>The vertebrae are normal in alignment and curvature. The vertebral bodies are normal in architecture. Visualized intervertebral disc spaces appear normal. No spondylolysis or spondylolisthesis is noted. No abnormal pre/paravertebral soft tissue shadow is seen.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-hip-normal",
      name: "Hip – Normal",
      preview: "Femoral head smooth. Acetabulum normal. Joint space normal. No fracture or loose bodies.",
      body: `<b>FINDINGS:</b><br><br>Femoral head appears smooth and regular. Articular surface of acetabulum appears normal. The alignment appears normal. Joint space appears normal. No evidence of fracture is seen. No evidence of loose bodies. No evidence of abnormal soft tissue calcification.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-shoulder-normal",
      name: "Shoulder – Normal",
      preview: "Bones normal alignment. Joint space normal. No fracture. AC joint normal. Ribs normal.",
      body: `<b>FINDINGS:</b><br><br>The bones of the shoulder joint show normal alignment. No focal bone lesion is seen. No evidence of fracture is noted. The joint space and articular margins are normal. There is no abnormal soft tissue calcification. The visualized ribs and scapulae are normal. The acromio-clavicular joints show no significant abnormality.<br><br><b>IMPRESSION:</b><br>No significant abnormality is noted in shoulder joint.`,
    },
    {
      id: "xray-wrist-normal",
      name: "Wrist – Normal",
      preview: "Bones of wrist normal alignment. Joint space & articular margins normal. No fracture.",
      body: `<b>FINDINGS:</b><br><br>The bones of the wrist joint show normal alignment. No focal bone lesion is seen. No evidence of fracture is noted. The joint space and articular margins are normal. There is no abnormal soft tissue calcification.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-hand-normal",
      name: "Hand – Normal",
      preview: "Bones normal mineralization. No fracture/dislocation. Carpal-phalangeal joints normal.",
      body: `<b>FINDINGS:</b><br><br>The bones of the hand appear normal in mineralization pattern. No evidence of any fracture / dislocation is seen. The surrounding soft tissue appears normal. The carpal-metacarpal, metacarpal-phalangeal, and the inter-phalangeal joints show no abnormality.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-elbow-normal",
      name: "Elbow – Normal",
      preview: "Joint space normal. Bones normal alignment. No fracture. No soft tissue calcification.",
      body: `<b>FINDINGS:</b><br><br>The joint space of the elbow joint appears normal. The bones of the elbow joint show normal alignment. No focal bone lesion is seen. No evidence of fracture is noted. There is no abnormal soft tissue calcification.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-forearm-normal",
      name: "Forearm – Normal",
      preview: "Bones of forearm normal alignment. No fracture. No soft tissue calcification.",
      body: `<b>FINDINGS:</b><br><br>Bones of forearm show normal alignment. No focal bone lesion is seen. No evidence of fracture is noted. There is no abnormal soft tissue calcification.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-foot-normal",
      name: "Foot – Normal",
      preview: "Bones of foot normal. No fracture. Bone mineralization normal. Joint spaces normal.",
      body: `<b>FINDINGS:</b><br><br>Bones of foot appear normal. No evidence of fracture is noted in foot. Bone mineralization appears normal. The surrounding soft tissue fat planes appear normal. Joint spaces are normal.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-ankle-normal",
      name: "Ankle – Normal",
      preview: "Bones of ankle normal. No fracture. Bone mineralization normal. Joint spaces normal.",
      body: `<b>FINDINGS:</b><br><br>Bones of ankle joint appear normal. No evidence of fracture is noted in ankle joint. Bone mineralization appears normal. The surrounding soft tissue fat planes appear normal. Joint spaces are normal.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-calcaneum-normal",
      name: "Calcaneum – Normal",
      preview: "Calcaneum appears normal. Joint spaces normal. No fracture or focal bone lesion.",
      body: `<b>FINDINGS:</b><br><br>Bilateral calcaneum appears normal. Joint spaces are normal. No focal bone lesion or fracture is noted.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-skull-normal",
      name: "Skull AP + LAT – Normal",
      preview: "Vault bones normal. Pituitary fossa normal. No fracture or intracranial calcification.",
      body: `<b>FINDINGS:</b><br><br>The bones of the vault of the skull show normal alignment and normal architecture. No focal bone lesion is seen. The pituitary fossa is normal. No abnormal intracranial calcification is seen. The sutures and vascular markings are normal. No soft-tissue abnormality is seen. There is no obvious evidence of fracture.<br><br><b>IMPRESSION:</b><br>No significant abnormality is seen in this study.`,
    },
    {
      id: "xray-pns-normal",
      name: "PNS – Normal",
      preview: "Bilateral maxillary & frontal sinuses normal. Nasal septum midline. No bony erosion.",
      body: `<b>FINDINGS:</b><br><br>Bilateral maxillary and frontal sinuses appear normal. Nasal septum appears in midline. Anterior walls & zygomatic process appear normal. No convincing bony erosion noted.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-nasal-bones-normal",
      name: "Nasal Bones – Normal",
      preview: "Visualized bones normal. No fracture. No foreign body. Soft tissue planes normal.",
      body: `<b>FINDINGS:</b><br><br>Visualized bones are normal. No evidence of fracture is noted. No evidence of foreign body is seen. Soft tissue planes appear normal.<br><br><b>IMPRESSION:</b><br>Bilateral nasal bones are normal. No evidence of fracture is seen on both sides.`,
    },
    {
      id: "xray-mastoid-normal",
      name: "Mastoid – Normal",
      preview: "Normal pneumatisation. No sclerosis. Dural & sinus plates normal. TM joints normal.",
      body: `<b>FINDINGS:</b><br><br>The mastoid shows normal pneumatisation. No evidence of any sclerosis is noted. The dural and sinus plates appear normal. The visualized temporal-mandibular joints grossly appear normal.<br><br><b>IMPRESSION:</b><br>No abnormality is seen in the mastoid.`,
    },
    {
      id: "xray-mandible-normal",
      name: "Mandible – Normal",
      preview: "Mandible grossly normal. No displaced fracture. Bone mineralization normal.",
      body: `<b>FINDINGS:</b><br><br>Mandible appears grossly normal. No evidence of displaced fracture is seen. Bone mineralization appears normal.<br><br><b>IMPRESSION:</b><br>No significant abnormality is detected in this study.`,
    },
    {
      id: "xray-kub-normal",
      name: "X-Ray KUB – Normal",
      preview: "No radio-opaque calculus bilaterally. Psoas shadows normal. Vertebrae normal.",
      body: `<b>FINDINGS:</b><br><br>No evidence of radio opaque calculus is seen in bilateral renal area and pelvis. Vertebral bodies appear normal in AP view. Psoas shadows appear normal. Bilateral SI joints appear normal.<br><br><b>IMPRESSION:</b><br>No evidence of radio opaque calculus is seen in bilateral renal area and pelvis. (Please note: radiolucent calculi will not be visible on plain radiograph.)`,
    },
    {
      id: "xray-abdomen-erect-normal",
      name: "Abdomen Erect – Normal",
      preview: "No air under diaphragm. No air-fluid levels. No abnormal radio-opacity. Bones normal.",
      body: `<b>FINDINGS:</b><br><br>No air under diaphragm is visualized. No evidence of multiple air fluid levels are seen. No abnormal radio opacity is visualized in the abdominal region. Visualized bones reveal normal density and grossly appear normal.<br><br><b>IMPRESSION:</b><br>No air under diaphragm is visualized. No evidence of multiple air fluid levels are seen.`,
    },
  ],
  pathology: [
    {
      id: "path-cbc-normal",
      name: "CBC – Normal",
      preview: "Hb normal, WBC normal differential, Platelets normal, PCV/MCV/MCH/MCHC within range.",
      body: `<b>COMPLETE BLOOD COUNT (CBC)</b><br><br><b>Haemoglobin (Hb):</b> ___ g/dL &nbsp;&nbsp;(Normal: M: 13–17 | F: 12–15)<br><b>Total WBC Count:</b> ___ × 10³/µL &nbsp;&nbsp;(Normal: 4.0–11.0)<br><b>Differential Count:</b><br>&nbsp;&nbsp;Neutrophils: ___%  (Normal: 50–70%)<br>&nbsp;&nbsp;Lymphocytes: ___% (Normal: 20–40%)<br>&nbsp;&nbsp;Monocytes: ___% (Normal: 2–8%)<br>&nbsp;&nbsp;Eosinophils: ___% (Normal: 1–4%)<br>&nbsp;&nbsp;Basophils: ___% (Normal: 0–1%)<br><b>Platelet Count:</b> ___ × 10³/µL &nbsp;&nbsp;(Normal: 150–400)<br><b>PCV (Haematocrit):</b> ___% &nbsp;&nbsp;(Normal: M: 40–52% | F: 37–47%)<br><b>MCV:</b> ___ fL &nbsp;&nbsp;(Normal: 80–100)<br><b>MCH:</b> ___ pg &nbsp;&nbsp;(Normal: 27–33)<br><b>MCHC:</b> ___ g/dL &nbsp;&nbsp;(Normal: 32–36)<br><br><b>IMPRESSION:</b><br>CBC within normal limits. No significant haematological abnormality detected.`,
    },
    {
      id: "path-lft-normal",
      name: "LFT – Normal",
      preview: "Bilirubin, SGOT, SGPT, ALP, Total Protein, Albumin all within normal limits.",
      body: `<b>LIVER FUNCTION TEST (LFT)</b><br><br><b>Total Bilirubin:</b> ___ mg/dL &nbsp;&nbsp;(Normal: 0.2–1.2)<br><b>Direct Bilirubin:</b> ___ mg/dL &nbsp;&nbsp;(Normal: 0.0–0.3)<br><b>Indirect Bilirubin:</b> ___ mg/dL &nbsp;&nbsp;(Normal: 0.2–0.9)<br><b>SGOT (AST):</b> ___ U/L &nbsp;&nbsp;(Normal: 10–40)<br><b>SGPT (ALT):</b> ___ U/L &nbsp;&nbsp;(Normal: 7–56)<br><b>Alkaline Phosphatase (ALP):</b> ___ U/L &nbsp;&nbsp;(Normal: 44–147)<br><b>GGT (Gamma GT):</b> ___ U/L &nbsp;&nbsp;(Normal: 9–48)<br><b>Total Protein:</b> ___ g/dL &nbsp;&nbsp;(Normal: 6.0–8.3)<br><b>Albumin:</b> ___ g/dL &nbsp;&nbsp;(Normal: 3.5–5.0)<br><b>Globulin:</b> ___ g/dL &nbsp;&nbsp;(Normal: 2.0–3.5)<br><b>A:G Ratio:</b> ___<br><br><b>IMPRESSION:</b><br>Liver function tests within normal limits.`,
    },
    {
      id: "path-kft-normal",
      name: "KFT – Normal",
      preview: "Urea, Creatinine, BUN, Uric Acid, Electrolytes, eGFR all within normal limits.",
      body: `<b>KIDNEY FUNCTION TEST (KFT)</b><br><br><b>Blood Urea:</b> ___ mg/dL &nbsp;&nbsp;(Normal: 15–45)<br><b>Serum Creatinine:</b> ___ mg/dL &nbsp;&nbsp;(Normal: M: 0.7–1.3 | F: 0.6–1.1)<br><b>Blood Urea Nitrogen (BUN):</b> ___ mg/dL &nbsp;&nbsp;(Normal: 7–20)<br><b>Serum Uric Acid:</b> ___ mg/dL &nbsp;&nbsp;(Normal: M: 3.5–7.2 | F: 2.6–6.0)<br><b>Serum Sodium (Na⁺):</b> ___ mEq/L &nbsp;&nbsp;(Normal: 136–145)<br><b>Serum Potassium (K⁺):</b> ___ mEq/L &nbsp;&nbsp;(Normal: 3.5–5.1)<br><b>Serum Chloride (Cl⁻):</b> ___ mEq/L &nbsp;&nbsp;(Normal: 98–107)<br><b>eGFR:</b> ___ mL/min/1.73m² &nbsp;&nbsp;(Normal: &gt;60)<br><br><b>IMPRESSION:</b><br>Kidney function tests within normal limits. No evidence of renal impairment.`,
    },
    {
      id: "path-thyroid-normal",
      name: "Thyroid Profile – Normal",
      preview: "T3, T4, TSH, Free T3, Free T4 all within normal limits. Euthyroid state.",
      body: `<b>THYROID FUNCTION TEST</b><br><br><b>T3 (Triiodothyronine):</b> ___ ng/dL &nbsp;&nbsp;(Normal: 80–200)<br><b>T4 (Thyroxine):</b> ___ µg/dL &nbsp;&nbsp;(Normal: 5.1–14.1)<br><b>TSH (Thyroid Stimulating Hormone):</b> ___ µIU/mL &nbsp;&nbsp;(Normal: 0.4–4.0)<br><b>Free T3 (fT3):</b> ___ pg/mL &nbsp;&nbsp;(Normal: 2.3–4.2)<br><b>Free T4 (fT4):</b> ___ ng/dL &nbsp;&nbsp;(Normal: 0.89–1.76)<br><br><b>IMPRESSION:</b><br>Thyroid function tests within normal limits. Euthyroid state.`,
    },
  ],
}

const FONT_FAMILIES = ["Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Calibri"]

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

  // Resolved values
  const patient = hasPatient ? paramPatient : selPatient
  const study   = hasPatient ? (paramStudy || extraStudy) : selStudy
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

  // Refs for contenteditable body
  const bodyRef         = useRef<HTMLDivElement | null>(null)
  const originalBodyRef = useRef<string>("")
  const submittedRef    = useRef(false)
  const [docxLoading,        setDocxLoading]        = useState(false)
  const [submitting,         setSubmitting]          = useState(false)
  const [submitted,          setSubmitted]           = useState(false)
  const [submittedDocxBase64, setSubmittedDocxBase64] = useState("")
  const [shareLoading,       setShareLoading]        = useState(false)

  // Storage key for this patient's report
  const storageKey = `aarya_report_${srNo || patient.replace(/\s+/g, "_")}`

  // ── Set in_progress when doctor opens the form (not view/edit mode) ─────────
  useEffect(() => {
    if (paramId && !paramView && !paramLoad) {
      fetch(`/api/patients/${paramId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportStatus: "in_progress" }),
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
            patient, study, date, age, gender, contact, srNo, refBy,
            savedAt: new Date().toISOString(),
          }))
        } catch {}
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, patient, study, date, age, gender, contact, srNo, refBy])

  // ── Load saved draft whenever the document area is shown ────────────────────
  useEffect(() => {
    if (!showDoc) return
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null")
      if (!saved?.body) return
      setTimeout(() => {
        if (bodyRef.current) {
          bodyRef.current.innerHTML = saved.body
          if (paramLoad) originalBodyRef.current = saved.body
        }
      }, 80)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDoc])

  // ── Save draft on browser close / hard refresh (belt-and-suspenders) ─────────
  useEffect(() => {
    const save = () => {
      if (submittedRef.current) return
      const html = bodyRef.current?.innerHTML
      if (!html || html === "<br>") return
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          body: html, patient, study, date, age, gender, contact, srNo, refBy,
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

    const infoLines: [string, string][] = [["NAME", patient.toUpperCase()], ["DATE", date]]
    if (age)         infoLines.push(["AGE",    `${age} YRS`])
    if (contact)     infoLines.push(["MOBILE", contact])
    infoLines.push(["REF. BY", (refBy || "SELF").toUpperCase()])
    if (gender)      infoLines.push(["SEX",    gender.toUpperCase()])
    if (localSrNo)   infoLines.push(["SR. NO", `#${localSrNo}`])

    const doctorName = (user?.name || "Dr. Ramesh Mehta").toUpperCase()

    const children = [
      // ── Clinic letterhead ──
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "AARYA DIAGNOSTICS CENTER", bold: true, size: 36 })],
        spacing: { after: 60 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: "Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086",
          size: 18, color: "666666",
        })],
        spacing: { after: 40 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: "Tel: 9819022444   ·   aaryadiagnosticsmumbai@gmail.com",
          size: 18, color: "666666",
        })],
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 1 } },
      }),
      // ── Patient info ──
      ...infoLines.map(([l, v]) =>
        new Paragraph({
          children: [
            new TextRun({ text: `${l}: `, bold: true, size: 20 }),
            new TextRun({ text: v, size: 20 }),
          ],
          spacing: { after: 60 },
        })
      ),
      // Thin separator after patient info
      new Paragraph({
        children: [new TextRun({ text: "" })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "aaaaaa", space: 1 } },
        spacing: { after: 160 },
      }),
      // ── Study title ──
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: study.toUpperCase(), bold: true, size: 26, underline: {} })],
        spacing: { before: 120, after: 200 },
      }),
      // ── Report body ──
      ...makeParas(bodyHtml),
      // ── Signature ──
      new Paragraph({
        children: [new TextRun({ text: "" })],
        border: { top: { style: BorderStyle.DASHED, size: 4, color: "aaaaaa", space: 1 } },
        spacing: { before: 560 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: doctorName, bold: true, size: 20 })],
        spacing: { before: 80, after: 40 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Consultant Radiologist", size: 18, color: "666666" })],
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
        body: finalBody, patient, study, date, age, gender, contact, srNo, refBy,
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
            reportStatus: "completed",
            reportBody:   cleanBody,
            reportDocx,
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
        patient, study, date, age, gender, contact, srNo, refBy,
        savedAt: new Date().toISOString(),
      }))
    } catch {}
  }

  // ── Print / PDF ──────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const html = buildPrintHtml({ patient, study, date, age, gender, srNo: localSrNo, contact, refBy, body: bodyRef.current?.innerHTML ?? "" })
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

    // ── Letterhead ──
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(0)
    doc.text("AARYA DIAGNOSTICS CENTER", W / 2, y, { align: "center" }); y += ln(16)

    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100)
    doc.text("Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086", W / 2, y, { align: "center" }); y += ln(8)
    doc.text("Tel: 9819022444   ·   aaryadiagnosticsmumbai@gmail.com", W / 2, y, { align: "center" }); y += ln(8) + 2

    doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 5

    // ── Patient info (two-column layout) ──
    doc.setTextColor(0)
    const info: [string, string][] = [["NAME", patient.toUpperCase()], ["DATE", date]]
    if (age)       info.push(["AGE",    `${age} YRS`])
    if (contact)   info.push(["MOBILE", contact])
    info.push(["REF. BY", (refBy || "SELF").toUpperCase()])
    if (gender)    info.push(["SEX",    gender.toUpperCase()])
    if (localSrNo) info.push(["SR. NO", `#${localSrNo}`])

    for (let i = 0; i < info.length; i += 2) {
      const [ll, lv] = info[i]
      doc.setFont("helvetica", "bold"); doc.setFontSize(9)
      doc.text(`${ll}:`, M, y)
      doc.setFont("helvetica", "normal")
      doc.text(lv, M + doc.getTextWidth(`${ll}:`) + 1.5, y)
      if (info[i + 1]) {
        const [rl, rv] = info[i + 1]
        const rx = W / 2 + 5
        doc.setFont("helvetica", "bold"); doc.text(`${rl}:`, rx, y)
        doc.setFont("helvetica", "normal"); doc.text(rv, rx + doc.getTextWidth(`${rl}:`) + 1.5, y)
      }
      y += ln(9) + 0.4
    }

    y += 2; doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 7

    // ── Study title ──
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(0)
    doc.text(study.toUpperCase(), W / 2, y, { align: "center" })
    const sw = doc.getTextWidth(study.toUpperCase())
    doc.setDrawColor(0); doc.setLineWidth(0.3)
    doc.line((W - sw) / 2, y + 1, (W + sw) / 2, y + 1)
    y += ln(12) + 5

    // ── Report body (word-wrapped plain text) ──
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(50)
    const plainText = new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent ?? ""
    const wrappedLines = doc.splitTextToSize(plainText, CW)
    for (const line of wrappedLines) {
      checkPage(5.5); doc.text(line, M, y); y += 5.5
    }

    // ── Signature ──
    checkPage(24); y += 10
    doc.setDrawColor(180); doc.setLineWidth(0.3); doc.line(M, y, M + 60, y); y += 4
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0)
    doc.text((user?.name || "Dr. Ramesh Mehta").toUpperCase(), M, y); y += ln(9)
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100)
    doc.text("Consultant Radiologist", M, y)

    return doc.output("blob")
  }

  // ── Share on WhatsApp: upload PDF → share download link ─────────────────────
  const handleShare = async (to: "patient" | "doctor") => {
    if (!paramId) return
    setShareLoading(true)

    const cleanHtml = stripEditedSpans(bodyRef.current?.innerHTML ?? "")
    const pdfUrl    = `${window.location.origin}/api/patients/${paramId}/pdf`

    const msg = to === "patient"
      ? `Dear ${patient},\n\nYour *${study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}\n\nAarya Diagnostics Center\nTel: 9819022444`
      : `*Aarya Diagnostics Center*\nReport: *${patient}* — *${study}*\nDate: ${date}\n\n📄 Download PDF:\n${pdfUrl}\n\nAarya Diagnostics Center\nTel: 9819022444`

    const num   = to === "patient" ? contact.replace(/\D/g, "") : ""
    const waUrl = num
      ? `https://wa.me/91${num}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`

    // Generate PDF and upload to server so the link works
    try {
      const pdfBlob   = await buildPdfBlob(cleanHtml)
      const arrayBuf  = await pdfBlob.arrayBuffer()
      const bytes     = new Uint8Array(arrayBuf)
      let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
      const base64    = btoa(binary)

      await fetch(`/api/patients/${paramId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reportPdf: base64 }),
      })
    } catch {}

    setShareLoading(false)
    window.open(waUrl, "_blank")
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
      downloadDocxFromBase64(base64, `Report_${patient.replace(/\s+/g, "_") || "Patient"}.docx`)
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
                    `Report_${patient.replace(/\s+/g, "_") || "Patient"}.docx`
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
            <div className="flex items-center border border-gray-200 rounded overflow-hidden mr-1">
              <button
                type="button" title="Decrease font size"
                onMouseDown={(e) => { e.preventDefault(); changeFontSize(-2) }}
                className="h-7 w-6 flex items-center justify-center hover:bg-gray-100 text-gray-600"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-7 text-center text-[11px] font-medium text-gray-700 select-none border-x border-gray-200">
                {fontSize}
              </span>
              <button
                type="button" title="Increase font size"
                onMouseDown={(e) => { e.preventDefault(); changeFontSize(2) }}
                className="h-7 w-6 flex items-center justify-center hover:bg-gray-100 text-gray-600"
              >
                <Plus className="h-3 w-3" />
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

        <div className="max-w-[794px] mx-auto bg-white shadow-xl rounded-sm px-14 py-12 min-h-[1100px]">

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
              {/* Clinic letterhead */}
              <div className="text-center pb-4 border-b-2 border-gray-900 mb-5 select-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.jpeg" alt="Aarya" className="h-16 w-16 rounded-full object-cover mx-auto mb-2" />
                <h1 className="text-xl font-bold uppercase tracking-widest text-gray-900">Aarya Diagnostics Center</h1>
                <p className="text-xs text-gray-500 mt-1">
                  Shop No. 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Tel: 9819022444 &nbsp;·&nbsp; aaryadiagnosticsmumbai@gmail.com
                </p>
              </div>

              {/* Patient info — NON-EDITABLE */}
              <div className="border-b border-gray-300 pb-3 mb-5 select-none">
                <div className="grid grid-cols-2 gap-x-10 gap-y-1 text-xs text-gray-900">
                  <div className="flex gap-2">
                    <span className="font-bold w-16 shrink-0 text-gray-900">NAME:</span>
                    <span className="text-gray-900">{patient.toUpperCase()}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-bold w-16 shrink-0 text-gray-900">DATE:</span>
                    <span className="text-gray-900">{date}</span>
                  </div>
                  {age && (
                    <div className="flex gap-2">
                      <span className="font-bold w-16 shrink-0 text-gray-900">AGE:</span>
                      <span className="text-gray-900">{age} YRS</span>
                    </div>
                  )}
                  {contact && (
                    <div className="flex gap-2">
                      <span className="font-bold w-16 shrink-0 text-gray-900">MOBILE:</span>
                      <span className="text-gray-900">{contact}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="font-bold w-16 shrink-0 text-gray-900">REF. BY:</span>
                    <span className="text-gray-900">{(refBy || "SELF").toUpperCase()}</span>
                  </div>
                  {gender && (
                    <div className="flex gap-2">
                      <span className="font-bold w-16 shrink-0 text-gray-900">SEX:</span>
                      <span className="text-gray-900">{gender.toUpperCase()}</span>
                    </div>
                  )}
                  {/* SR. NO — always visible, editable by doctor */}
                  <div className="flex gap-2 items-center">
                    <span className="font-bold w-16 shrink-0 text-gray-900">SR. NO:</span>
                    {!isReadOnly && editingSrNo ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <span className="text-gray-500 text-xs">#</span>
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
                          className="w-20 border-0 border-b border-blue-400 text-xs text-gray-900 bg-transparent focus:outline-none px-0 py-px"
                          placeholder="e.g. 1001"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900 text-xs">
                          {localSrNo ? `#${localSrNo}` : <span className="text-gray-400 italic">not set</span>}
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
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Study title */}
              <div className="text-center font-bold uppercase text-base py-1 underline underline-offset-4 tracking-wide mb-6 text-gray-900 select-none">
                {study}
              </div>

              {/* Report body — editable or read-only depending on mode */}
              <div
                ref={bodyRef}
                contentEditable={!isReadOnly}
                suppressContentEditableWarning
                data-placeholder="Start typing the report here..."
                className={`doc-field min-h-[400px] text-sm leading-relaxed text-gray-900 focus:outline-none${isReadOnly ? " cursor-default select-text" : ""}`}
              />

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
