// Report templates.
//
// This file used to bundle 183 built-in templates generated from the clinic's
// Word formats. They are gone on purpose: every template is now clinic-added
// and lives in MongoDB (`templates`), managed from the Add Template page. That
// keeps one source of truth — a template the clinic deletes stays deleted,
// instead of a bundled copy reappearing on the next deploy.
//
// The categories below stay so the category tabs, filters and colours in the
// editor and the Add Template page keep working; the lists are empty because
// nothing ships with the app any more.

export type TemplateCategory = "usg" | "doppler" | "xray" | "pathology" | "obstetric"

export interface ReportTemplate {
  id: string
  name: string
  heading: string   // study heading shown centered + underlined, editable in the editor
  preview: string
  body: string      // HTML for the contentEditable report body
  signatureCount?: number // present on Word imports; limits the fixed sign-off columns
  preserveSignature?: boolean // custom DOCX keeps its own exact sign-off formatting
  _id?: string      // present only on clinic-added templates (backed by MongoDB) — lets
                     // the UI tell them apart from the built-in bundled ones and offer delete
}

export const REPORT_TEMPLATES: Record<TemplateCategory, ReportTemplate[]> = {
  obstetric: [],
  usg: [],
  doppler: [],
  xray: [],
  pathology: [],
}
