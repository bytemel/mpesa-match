// M-Pesa Match page. Everything happens here in the browser; nothing is sent anywhere.
import { parseRows } from "../lib/csv.js";
import { FIELDS, guessColumns, readStatement, readExpected, matchPayments } from "../lib/match.js";

const $ = (id) => document.getElementById(id);
const kes = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const LABELS = { receipt: "Receipt", time: "Time", details: "Details", paidIn: "Paid in", withdrawn: "Withdrawn", status: "Status", party: "Other party", account: "Account no." };
const STATUS = {
  paid: ["Paid", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  over: ["Paid more", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.5v7M4.5 8h7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'],
  part: ["Part paid", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor"/></svg>'],
  unpaid: ["Not paid", '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'],
};
let columns = null;
let last = null;

function el(tag, { dataset, ...props } = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...kids.filter((k) => k != null && k !== false));
  return node;
}
function status(message, kind = "") {
  $("status").hidden = !message;
  $("status").textContent = message || "";
  $("status").className = `notice ${kind}`;
}
const statusBadge = (s) => {
  const span = el("span", { className: `st st-${s}` });
  span.innerHTML = STATUS[s][1]; // static SVG from the table above, no user data
  span.append(STATUS[s][0]);
  return span;
};

function buildMapping(header) {
  $("mapping").hidden = !header.length;
  $("map-grid").replaceChildren(...Object.keys(FIELDS).filter((f) => f !== "withdrawn").map((f) => {
    const select = el("select", { id: `map-${f}` }, el("option", { value: "", textContent: "(none)" }), ...header.map((h, i) => el("option", { value: String(i), textContent: h || `Column ${i + 1}` })));
    select.value = columns[f] === undefined ? "" : String(columns[f]);
    select.addEventListener("change", () => {
      if (select.value === "") delete columns[f]; else columns[f] = Number(select.value);
      run(false);
    });
    return el("label", {}, LABELS[f], select);
  }));
}

function run(regrow = true) {
  status("");
  const st = $("statement").value.trim();
  const ex = $("expected").value.trim();
  if (!st || !ex) { $("results").hidden = true; return; }
  try {
    const statement = parseRows(st);
    if (regrow || !columns) { columns = guessColumns(statement.header); buildMapping(statement.header); }
    if (columns.paidIn === undefined) throw new Error("Could not find the money-in column. Open \"Columns used\" and pick it.");
    const { payments, skipped } = readStatement(statement, columns);
    const expected = readExpected(parseRows(ex));
    if (!expected.length) throw new Error("The list of who should pay is empty.");
    last = matchPayments(expected, payments);
    render(skipped, payments.length);
  } catch (e) {
    $("results").hidden = true;
    status(e.message, "notice-alert");
  }
}

function render(skipped, used) {
  const { people, unmatched, ambiguous, totals } = last;
  $("results").hidden = false;
  $("t-collected").textContent = `KES ${kes.format(totals.collected)}`;
  $("t-collected-sub").textContent = `of KES ${kes.format(totals.expected)} due`;
  $("t-owed").textContent = `KES ${kes.format(totals.outstanding)}`;
  $("t-owed-sub").textContent = `${totals.counts.unpaid} not paid, ${totals.counts.part} part paid`;
  $("t-paid").textContent = `${totals.counts.paid + totals.counts.over} of ${people.length}`;
  $("t-paid-sub").textContent = totals.counts.over ? `${totals.counts.over} paid more than due` : "people";
  $("t-unknown").textContent = `KES ${kes.format(totals.unmatched)}`;
  $("t-unknown-sub").textContent = `${ambiguous.length} ${ambiguous.length === 1 ? "fits two people" : "fit two or more people"}, ${unmatched.length} from strangers`;

  const filter = $("filter").value;
  const show = people.filter((p) => filter === "all" || (filter === "owe" && (p.status === "unpaid" || p.status === "part")) || (filter === "check" && p.check) || p.status === filter);
  $("people").replaceChildren(...show.map((p) => {
    const hows = [...new Set(p.payments.map((x) => x.how))];
    const tr = el("tr", {},
      el("td", {}, p.name || `Row ${p.row}`, p.ref ? el("span", { className: "sub", textContent: p.ref }) : null),
      el("td", { className: "num", textContent: kes.format(p.amount), dataset: { label: "Due" } }),
      el("td", { className: "num", textContent: kes.format(p.paid), dataset: { label: "Paid" } }),
      el("td", {}, statusBadge(p.status), p.status === "part" ? el("span", { className: "sub", textContent: `owes ${kes.format(p.balance)}` }) : p.status === "over" ? el("span", { className: "sub", textContent: `${kes.format(-p.balance)} extra` }) : null),
      el("td", { className: "how" }, hows.length ? hows.join(", ") : "", p.check ? el("span", { className: "badge badge-warn", textContent: "check", title: "Matched by name only. Confirm before you mark it." }) : null, p.payments.length ? el("span", { className: "sub", textContent: p.payments.map((x) => x.receipt).filter(Boolean).join(" ") }) : null),
      el("td", {}, (p.status === "unpaid" || p.status === "part") && p.phone ? el("a", { className: "btn", href: whatsapp(p), target: "_blank", rel: "noopener", textContent: "WhatsApp" }) : null));
    return tr;
  }));
  const item = (pay, extra) => el("li", {}, el("span", { className: "amt", textContent: `KES ${kes.format(pay.amount)}` }), el("span", { textContent: `${pay.name || "Unknown name"}${pay.account ? `, account "${pay.account}"` : ""}` }), el("span", { className: "sub", textContent: [pay.receipt, pay.time].filter(Boolean).join(", ") }), extra);
  $("ambiguous").replaceChildren(...(ambiguous.length ? ambiguous.map((a) => item(a, el("span", { className: "sub", textContent: `Could be: ${a.candidates.join(" or ")}` }))) : [el("li", { className: "empty", textContent: "None. Every payment fits one person or nobody." })]));
  $("unmatched").replaceChildren(...(unmatched.length ? unmatched.map((u) => item(u)) : [el("li", { className: "empty", textContent: "None." })]));
  const s = [];
  if (skipped.duplicate) s.push(`${skipped.duplicate} repeated ${skipped.duplicate === 1 ? "row" : "rows"} (same receipt) counted once`);
  if (skipped.notCompleted) s.push(`${skipped.notCompleted} not completed (failed or reversed)`);
  if (skipped.outgoing) s.push(`${skipped.outgoing} money out or charges`);
  if (skipped.unreadable) s.push(`${skipped.unreadable} with an amount that could not be read`);
  $("skipped").textContent = `Used ${used} payments in. Left out: ${s.length ? s.join("; ") : "nothing"}.`;
}

function whatsapp(p) {
  const text = $("tpl").value
    .replaceAll("{first}", (p.name || "").split(/\s+/)[0] || "there")
    .replaceAll("{name}", p.name || "")
    .replaceAll("{owed}", kes.format(Math.max(0, p.balance)))
    .replaceAll("{paid}", kes.format(p.paid))
    .replaceAll("{due}", kes.format(p.amount));
  return `https://wa.me/254${p.phone}?text=${encodeURIComponent(text)}`;
}

function csv() {
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["name", "reference", "phone", "due", "paid", "balance", "status", "matched by", "receipts", "check"];
  const rows = last.people.map((p) => [p.name, p.ref, p.phone ? `+254${p.phone}` : "", p.amount, p.paid, p.balance, STATUS[p.status][0], [...new Set(p.payments.map((x) => x.how))].join(" "), p.payments.map((x) => x.receipt).join(" "), p.check ? "yes" : ""]);
  const blob = new Blob(["﻿", [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
  el("a", { href: URL.createObjectURL(blob), download: "mpesa-match.csv" }).click();
}

async function loadFile(input, target) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { status("That file is over 5 MB. Export a shorter date range.", "notice-alert"); return; }
  $(target).value = await file.text();
  run();
}

let timer = null;
const later = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
$("statement").addEventListener("input", later);
$("expected").addEventListener("input", later);
$("statement-file").addEventListener("change", (e) => loadFile(e.target, "statement"));
$("expected-file").addEventListener("change", (e) => loadFile(e.target, "expected"));
$("filter").addEventListener("change", () => last && run(false));
$("tpl").addEventListener("input", () => last && run(false));
$("csv").addEventListener("click", () => last && csv());
$("sample").addEventListener("click", async () => {
  const [a, b] = await Promise.all(["sample/statement.csv", "sample/members.csv"].map((f) => fetch(f).then((r) => r.text())));
  $("statement").value = a;
  $("expected").value = b;
  run();
  $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});

// /?sample opens with the sample loaded, so a shared link shows results straight away.
if (new URLSearchParams(location.search).has("sample")) $("sample").click();
