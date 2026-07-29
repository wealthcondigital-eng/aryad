const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const dir = path.join(__dirname, '..', 'OBSTRETIC FORMATS');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.docx'));

async function processFiles() {
  const templates = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const result = await mammoth.convertToHtml({ path: filePath }, { styleMap: ["u => u"] });
    let html = result.value;

    // Convert paragraphs to clinic divs
    html = html.replace(/<p>([\s\S]*?)<\/p>/gi, (_match, inner) => {
      const trimmed = inner.replace(/&nbsp;/gi, "").trim();
      if (!trimmed) return "<div><br></div>";
      return `<div>${inner}</div>`;
    });
    html = html.replace(/(?:<div><br><\/div>\s*){2,}/gi, "<div><br></div>");

    const nameWithoutExt = file.replace(/\.docx$/i, "");
    const id = nameWithoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const name = nameWithoutExt
      .split(/[\s_-]+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    // Extract heading or derive from name
    const heading = `ULTRASOUND OF ${name.toUpperCase()}`;

    // Clean plain text preview
    const cleanText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const preview = cleanText.length > 100 ? cleanText.slice(0, 100) + "…" : cleanText;

    templates.push({
      id,
      name,
      category: "OBSTETRIC USG",
      heading,
      preview,
      body: html
    });
  }

  fs.writeFileSync(path.join(__dirname, 'obstetric_templates.json'), JSON.stringify(templates, null, 2));
  console.log(`Successfully processed ${templates.length} obstetric templates.`);
}

processFiles().catch(console.error);
