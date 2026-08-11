// Per-study report slug generation — the pretty `/<name>-<study>-report.pdf`
// URL that gets shared over WhatsApp.

import Patient from "@/models/Patient"

interface SlugPatient {
  name: string
  srNo: number
  studies: Array<{ reportSlug?: string }>
}

export async function generateReportSlug(
  patient: SlugPatient,
  studyName: string,
  excludeId: string
): Promise<string> {
  const nameBase  = patient.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const studyBase = studyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  let slug = `${nameBase}-${studyBase}-report`
  const taken = await Patient.findOne({
    _id: { $ne: excludeId },
    $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }],
  }).select("_id")
  if (taken) slug = `${nameBase}-${studyBase}-${patient.srNo}-report`
  // also make sure it doesn't clash with another study of the same patient
  const clash = patient.studies.filter((s: { reportSlug?: string }) => s.reportSlug === slug).length
  if (clash) slug = `${slug}-${clash + 1}`
  return slug
}
