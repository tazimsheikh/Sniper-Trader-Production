const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mdPath = path.join(process.cwd(), 'server', 'trading', 'optimizer', 'chronological_ist_trade_schedule.md');
const htmlPath = path.join(process.cwd(), 'server', 'trading', 'optimizer', 'chronological_ist_trade_schedule.html');
const pdfPath = path.join(process.cwd(), 'server', 'trading', 'optimizer', 'chronological_ist_trade_schedule.pdf');

if (!fs.existsSync(mdPath)) {
  console.error("Markdown file not found!");
  process.exit(1);
}

const mdContent = fs.readFileSync(mdPath, 'utf8');

// Simple Markdown to HTML parser for table and headings
function mdToHtml(md) {
  let lines = md.split('\n');
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 40px;
    color: #1e293b;
    background-color: #ffffff;
    line-height: 1.5;
  }
  h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; font-size: 24px; }
  h2 { color: #1e293b; margin-top: 30px; font-size: 18px; }
  p { font-size: 13px; color: #475569; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 15px;
    font-size: 12px;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 8px 10px;
    text-align: left;
  }
  th {
    background-color: #f1f5f9;
    color: #0f172a;
    font-weight: 600;
  }
  tr:nth-child(even) {
    background-color: #f8fafc;
  }
  strong { color: #0f172a; }
  code { background-color: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 11px; }
  ul { font-size: 13px; color: #334155; }
  li { margin-bottom: 6px; }
</style>
</head>
<body>
`;

  let inTable = false;
  let tableHeaderDone = false;

  for (let line of lines) {
    line = line.trim();
    if (!line) {
      if (inTable) {
        html += `</tbody></table>\n`;
        inTable = false;
        tableHeaderDone = false;
      }
      continue;
    }

    if (line.startsWith('# ')) {
      html += `<h1>${line.replace('# ', '')}</h1>\n`;
    } else if (line.startsWith('## ')) {
      html += `<h2>${line.replace('## ', '')}</h2>\n`;
    } else if (line.startsWith('---')) {
      html += `<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">\n`;
    } else if (line.startsWith('|')) {
      // Table row
      if (line.includes('---')) continue; // skip delimiter row

      let cells = line.split('|').slice(1, -1).map(c => c.trim());
      
      // Parse markdown formatting inside cells
      cells = cells.map(c => {
        return c.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
      });

      if (!inTable) {
        inTable = true;
        html += `<table><thead><tr>\n`;
        for (let cell of cells) {
          html += `<th>${cell}</th>`;
        }
        html += `\n</tr></thead><tbody>\n`;
      } else {
        html += `<tr>\n`;
        for (let cell of cells) {
          html += `<td>${cell}</td>`;
        }
        html += `\n</tr>\n`;
      }
    } else if (line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ')) {
      html += `<p style="font-weight: bold; margin-top: 12px; margin-bottom: 4px;">${line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>\n`;
    } else if (line.startsWith('- ')) {
      let content = line.replace('- ', '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      html += `<li style="margin-left: 20px;">${content}</li>\n`;
    } else {
      let content = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      html += `<p>${content}</p>\n`;
    }
  }

  if (inTable) {
    html += `</tbody></table>\n`;
  }

  html += `</body></html>`;
  return html;
}

const htmlContent = mdToHtml(mdContent);
fs.writeFileSync(htmlPath, htmlContent, 'utf8');

// Find Edge executable
const edgePaths = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

let edgeExe = edgePaths.find(p => fs.existsSync(p));

if (!edgeExe) {
  console.error("Microsoft Edge executable not found!");
  process.exit(1);
}

console.log("Using Edge at:", edgeExe);

const cmd = `"${edgeExe}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath}"`;
console.log("Running command:", cmd);

try {
  execSync(cmd);
  console.log("✅ PDF GENERATED INSTANTLY AT:", pdfPath);
} catch (err) {
  console.error("Failed to render PDF via Edge:", err.message);
} finally {
  if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
}
