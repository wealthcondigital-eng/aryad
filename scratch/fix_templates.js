const fs = require('fs');
const path = require('path');

const templatesPath = path.join(__dirname, '..', 'src', 'lib', 'report-templates.ts');
const newTemplatesPath = path.join(__dirname, 'obstetric_templates.json');

const newTemplates = JSON.parse(fs.readFileSync(newTemplatesPath, 'utf8')).map(t => ({
  id: t.id,
  name: t.name,
  heading: t.heading,
  preview: t.preview,
  body: t.body
}));

let content = fs.readFileSync(templatesPath, 'utf8');

// Replace the obstetric section with clean objects (without category key)
const startIdx = content.indexOf('"obstetric": [');
if (startIdx !== -1) {
  const endIdx = content.indexOf('],', startIdx) + 2;
  const newStr = `"obstetric": ${JSON.stringify(newTemplates, null, 2)},`;
  content = content.slice(0, startIdx) + newStr + content.slice(endIdx);
  fs.writeFileSync(templatesPath, content, 'utf8');
  console.log("Successfully cleaned obstetric templates in report-templates.ts");
} else {
  console.error("Could not find obstetric section in report-templates.ts");
}
