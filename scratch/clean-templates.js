const fs = require('fs');

const path = 'src/lib/report-templates.ts';
let code = fs.readFileSync(path, 'utf8');

const PATIENT_INFO_RE = /\b(NAME|DATE|AGE|REF\.?\s*BY|SEX|MOBILE|SR\.?\s*NO|PATIENT)\b/i;

function cleanBody(body) {
  let s = body.trim();
  let stripped = false;
  while (true) {
    const m = s.match(/^<table[\s\S]*?<\/table>/i);
    if (!m) break;
    const tableText = m[0].replace(/<[^>]+>/g, ' ');
    if (!PATIENT_INFO_RE.test(tableText)) break;
    s = s.slice(m[0].length).trim();
    stripped = true;
  }
  return s;
}

let count = 0;
// Match JSON string property for "body": "..."
const regex = /("body":\s*")((?:[^"\\]|\\.)*)(")/g;

const newCode = code.replace(regex, (match, p1, bodyContent, p3) => {
  try {
    const unescaped = JSON.parse('"' + bodyContent + '"');
    const cleaned = cleanBody(unescaped);
    if (cleaned !== unescaped) {
      count++;
      return p1 + JSON.stringify(cleaned).slice(1, -1) + p3;
    }
  } catch (e) {
    console.error('Error parsing body:', e);
  }
  return match;
});

console.log(`Cleaned ${count} template bodies.`);
fs.writeFileSync(path, newCode);
