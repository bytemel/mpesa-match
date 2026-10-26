// A small CSV reader: quoted fields with commas or line breaks inside, "" for a quote, Windows line
// endings, the byte order mark Excel adds, and tab-separated text (what you get copying from a sheet).
// Adapted from bytemel/sms-kit-kenya.

export function parseRows(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const sep = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const filled = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!filled.length) return { header: [], rows: [] };
  return { header: filled[0].map((h) => h.trim()), rows: filled.slice(1).map((r) => r.map((v) => v.trim())) };
}
