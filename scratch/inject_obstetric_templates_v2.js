const fs = require('fs');
const path = require('path');

const templatesPath = path.join(__dirname, '..', 'src', 'lib', 'report-templates.ts');
const newTemplatesPath = path.join(__dirname, 'obstetric_templates.json');

const newTemplates = JSON.parse(fs.readFileSync(newTemplatesPath, 'utf8'));

let content = fs.readFileSync(templatesPath, 'utf8');

// 1. Update TemplateCategory type
if (!content.includes('"obstetric"')) {
  content = content.replace(
    'export type TemplateCategory = "usg" | "doppler" | "xray" | "pathology"',
    'export type TemplateCategory = "usg" | "doppler" | "xray" | "pathology" | "obstetric"'
  );
}

// 2. Insert obstetric array inside REPORT_TEMPLATES object
const insertPos = content.indexOf('export const REPORT_TEMPLATES: Record<TemplateCategory, ReportTemplate[]> = {');
if (insertPos === -1) {
  console.error("Could not find REPORT_TEMPLATES object");
  process.exit(1);
}

const keyPos = insertPos + 'export const REPORT_TEMPLATES: Record<TemplateCategory, ReportTemplate[]> = {'.length;

const formattedTemplates = JSON.stringify(newTemplates, null, 2);
const insertionStr = `\n  "obstetric": ${formattedTemplates},`;

const updatedContent = content.slice(0, keyPos) + insertionStr + content.slice(keyPos);

fs.writeFileSync(templatesPath, updatedContent, 'utf8');
console.log(`Successfully injected ${newTemplates.length} obstetric templates into report-templates.ts!`);
