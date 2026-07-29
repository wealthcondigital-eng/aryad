const fs = require('fs');
const path = require('path');

const templatesPath = path.join(__dirname, '..', 'src', 'lib', 'report-templates.ts');
const newTemplatesPath = path.join(__dirname, 'obstetric_templates.json');

const newTemplates = JSON.parse(fs.readFileSync(newTemplatesPath, 'utf8'));

let content = fs.readFileSync(templatesPath, 'utf8');

// Check if OBSTETRIC USG is already in TemplateCategory type
if (!content.includes('"OBSTETRIC USG"')) {
  content = content.replace(
    'export type TemplateCategory =',
    'export type TemplateCategory =\n  | "OBSTETRIC USG"'
  );
}

// Find the start of REPORT_TEMPLATES array
const arrayStart = content.indexOf('export const REPORT_TEMPLATES: ReportTemplate[] = [');
if (arrayStart === -1) {
  console.error("Could not find REPORT_TEMPLATES array");
  process.exit(1);
}

// Insert the 21 new templates right after the array opening bracket
const insertPos = arrayStart + 'export const REPORT_TEMPLATES: ReportTemplate[] = ['.length;

const formattedNew = newTemplates.map(t => JSON.stringify(t, null, 2)).join(',\n') + ',\n';

const updatedContent = content.slice(0, insertPos) + '\n' + formattedNew + content.slice(insertPos);

fs.writeFileSync(templatesPath, updatedContent, 'utf8');
console.log(`Successfully injected ${newTemplates.length} Obstetric USG templates into report-templates.ts`);
