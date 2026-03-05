/**
 * Markdown → HTML converter for migration and estate reports.
 *
 * Handles the specific constructs produced by report-generator.ts and
 * estate-report-generator.ts. Zero external dependencies — plain TypeScript.
 *
 * Output is a self-contained HTML file with embedded CSS that:
 *   - Renders cleanly in any browser
 *   - Prints well to PDF via Ctrl+P / browser print
 *   - Handles tables, code blocks, blockquotes, lists, inline formatting
 */

// ─── Public API ───────────────────────────────────────────────────────────────

export function migrationReportToHtml(markdown: string, appName: string): string {
  const body = convertMarkdown(markdown);
  return htmlDocument(`Migration Report — ${appName}`, body);
}

export function estateReportToHtml(markdown: string): string {
  const body = convertMarkdown(markdown);
  return htmlDocument('BizTalk Estate Assessment Report', body);
}

// ─── Markdown Parser ──────────────────────────────────────────────────────────

function convertMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ── Fenced code block ````lang`
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      out.push(
        `<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ''}>${escHtml(codeLines.join('\n'))}</code></pre>`
      );
      i++; // skip closing ```
      continue;
    }

    // ── Table (consecutive lines starting with |)
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        tableLines.push(lines[i]!);
        i++;
      }
      out.push(buildTable(tableLines));
      continue;
    }

    // ── Blockquote
    if (line.startsWith('> ')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('> ')) {
        bqLines.push(lines[i]!.slice(2));
        i++;
      }
      const inner = bqLines.map(l => `<p>${inline(l)}</p>`).join('');
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // ── Headings
    const h3 = /^### (.+)/.exec(line);
    if (h3) { out.push(`<h3>${inline(h3[1]!)}</h3>`); i++; continue; }
    const h2 = /^## (.+)/.exec(line);
    if (h2) { out.push(`<h2>${inline(h2[1]!)}</h2>`); i++; continue; }
    const h1 = /^# (.+)/.exec(line);
    if (h1) { out.push(`<h1>${inline(h1[1]!)}</h1>`); i++; continue; }

    // ── Horizontal rule
    if (line === '---') { out.push('<hr>'); i++; continue; }

    // ── Unordered list (collect consecutive items)
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) {
        items.push(`<li>${inline(lines[i]!.slice(2))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // ── Blank line
    if (line.trim() === '') { i++; continue; }

    // ── Regular paragraph
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  return out.join('\n');
}

// ─── Table Builder ────────────────────────────────────────────────────────────

function buildTable(lines: string[]): string {
  // Parse each row into cells (strip leading/trailing |)
  const rows = lines.map(l =>
    l.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
  );
  if (rows.length < 1) return '';

  // Detect separator row (all cells contain only - and spaces/colons)
  const isSeparator = (row: string[]) => row.every(c => /^[-: ]+$/.test(c));

  const headerRow = rows[0]!;
  // Find and skip separator row
  const bodyRows = rows.slice(1).filter(r => !isSeparator(r));

  const thead = `<thead><tr>${headerRow.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
  const tbody = bodyRows.length > 0
    ? `<tbody>${bodyRows.map(r =>
        `<tr>${r.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`
      ).join('')}</tbody>`
    : '';

  return `<table>${thead}${tbody}</table>`;
}

// ─── Inline Formatting ────────────────────────────────────────────────────────

function inline(text: string): string {
  // Bold (**text**) — process before italic to avoid partial matches
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic (*text*) — only single asterisks
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Inline code (`code`)
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Markdown links ([label](url))
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── HTML Document Wrapper ────────────────────────────────────────────────────

function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
/* ── Reset & Base ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --brand:    #0078d4;
  --brand-dk: #005a9e;
  --text:     #1b1b1b;
  --muted:    #555;
  --border:   #d8d8d8;
  --bg:       #ffffff;
  --bg-alt:   #f8f9fa;
  --code-bg:  #f3f4f6;
  --code-fg:  #c7254e;
  --success:  #107c10;
  --warn:     #ca5010;
  --danger:   #d13438;
  --radius:   6px;
}

body {
  font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text);
  background: var(--bg);
  padding: 40px 24px 60px;
}

.page { max-width: 980px; margin: 0 auto; }

/* ── Print Button (screen only) ──────────────────────────────────────────── */
.print-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  float: right;
  margin-top: 4px;
  padding: 6px 14px;
  background: var(--brand);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
}
.print-btn:hover { background: var(--brand-dk); }
@media print { .print-btn { display: none !important; } }

/* ── Headings ─────────────────────────────────────────────────────────────── */
h1 {
  font-size: 22px;
  font-weight: 700;
  color: var(--brand);
  border-bottom: 2px solid var(--brand);
  padding-bottom: 10px;
  margin-bottom: 20px;
  clear: both;
}

h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  border-left: 4px solid var(--brand);
  padding: 2px 0 2px 12px;
  margin: 36px 0 14px;
}

h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 10px;
  color: var(--text);
}

/* ── Paragraphs & Text ───────────────────────────────────────────────────── */
p { margin: 6px 0 10px; }

strong { font-weight: 600; }
em     { font-style: italic; color: var(--muted); }

a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Blockquote (used for report sub-header metadata line) ───────────────── */
blockquote {
  background: var(--bg-alt);
  border-left: 4px solid var(--brand);
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 12px 18px;
  margin: 16px 0 20px;
}
blockquote p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

/* ── Horizontal Rule ─────────────────────────────────────────────────────── */
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 28px 0;
}

/* ── Lists ───────────────────────────────────────────────────────────────── */
ul {
  padding-left: 22px;
  margin: 8px 0 12px;
}
li { margin: 3px 0; }

/* ── Inline Code ─────────────────────────────────────────────────────────── */
code {
  font-family: 'Cascadia Code', 'Consolas', 'Menlo', monospace;
  font-size: 12px;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid #e0e0e0;
}

/* ── Code Blocks ─────────────────────────────────────────────────────────── */
pre {
  background: #1e1e1e;
  border-radius: var(--radius);
  padding: 16px 20px;
  margin: 14px 0;
  overflow-x: auto;
}
pre code {
  background: none;
  color: #d4d4d4;
  border: none;
  padding: 0;
  font-size: 13px;
  white-space: pre;
}

/* ── Tables ──────────────────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0 20px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

thead tr {
  background: var(--brand);
  color: #fff;
}

th {
  padding: 9px 14px;
  text-align: left;
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

td {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

tbody tr:last-child td { border-bottom: none; }
tbody tr:nth-child(even) td { background: var(--bg-alt); }
tbody tr:hover td { background: #e8f0fe; }

/* ── Footer ──────────────────────────────────────────────────────────────── */
.report-footer {
  margin-top: 48px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}

/* ── Print ───────────────────────────────────────────────────────────────── */
@media print {
  body   { padding: 0; font-size: 12px; }
  h2     { page-break-before: auto; }
  table  { page-break-inside: avoid; font-size: 11px; }
  pre    { page-break-inside: avoid; }
  thead  { display: table-header-group; }
  tr     { page-break-inside: avoid; page-break-after: auto; }
}
</style>
</head>
<body>
<div class="page">
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
${body}
<div class="report-footer">
  Generated by <a href="https://biztalkmigrate.com" target="_blank" rel="noopener">BizTalk to Logic Apps Migration Framework</a>
</div>
</div>
</body>
</html>`;
}
