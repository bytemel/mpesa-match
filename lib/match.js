// Matches M-Pesa money received against a list of people who should pay.
// Pure functions, no network: the same file runs in the browser and in the tests.
//
// Money is matched in this order, strongest first:
//   1. account reference (the A/C No. a payer types on a paybill), exact, ignoring case and spaces
//   2. phone number: full numbers exactly; masked ones (2547******678) when the visible digits fit
//      exactly one person on the list
//   3. name: the payer's name shares at least two words with exactly one person (any order),
//      or one long word when nothing else is close. Name matches are flagged "check".
// A payment that fits two people equally is never guessed: it goes to "needs a person" with both names.

// Header keywords for each field. Exports differ (business portal, statement PDF copied to a sheet),
// so columns are found by meaning, and the page lets you fix the guess.
export const FIELDS = {
  receipt: ["receipt", "transaction id", "trans id", "mpesa code", "code"],
  time: ["completion time", "date", "time", "initiation time"],
  details: ["details", "description", "narrative"],
  paidIn: ["paid in", "credit", "amount in", "received", "amount"],
  withdrawn: ["withdrawn", "debit", "paid out"],
  status: ["transaction status", "status"],
  party: ["other party", "sender", "customer", "msisdn", "phone"],
  account: ["a/c no", "account no", "account", "bill ref", "reference"],
};

export function guessColumns(header) {
  const h = header.map((x) => x.toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim());
  const used = new Set();
  const out = {};
  for (const [field, words] of Object.entries(FIELDS)) {
    for (const w of words) {
      const i = h.findIndex((col, idx) => !used.has(idx) && col.includes(w));
      if (i >= 0) { out[field] = i; used.add(i); break; }
    }
  }
  return out;
}

export function money(value) {
  const s = String(value ?? "").replace(/,/g, "").replace(/ksh|kes/gi, "").trim();
  if (!s || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// Kenyan mobile numbers to the 9 digits after 254. A masked number keeps only what is visible,
// as "<start>*<end>" (2547******104 becomes 7*104), because exports hide different numbers of digits.
export function phoneKey(value) {
  let s = String(value ?? "").replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d*]+$/.test(s)) return null;
  if (s.startsWith("254")) s = s.slice(3);
  else if (s.startsWith("0")) s = s.slice(1);
  if (s.includes("*")) {
    const start = s.slice(0, s.indexOf("*"));
    const end = s.slice(s.lastIndexOf("*") + 1);
    return start.length + end.length >= 3 && start.length + end.length < 9 && /^[71]?/.test(start) ? `${start}*${end}` : null;
  }
  return s.length === 9 && /^[71]/.test(s) ? s : null;
}

const phoneFits = (masked, full) => {
  const [start, end] = masked.split("*");
  return full.startsWith(start) && full.endsWith(end);
};

const STOP = new Set(["mr", "mrs", "ms", "dr", "the", "and", "ltd", "limited", "funds", "received", "from", "payment", "to"]);
export const nameWords = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter((w) => w.length > 1 && !STOP.has(w));

// Pulls the payer's phone and name out of "Other Party Info" or "Details".
// Seen shapes: "254712345678 - JOHN KAMAU", "Funds received from - 2547******678 JOHN KAMAU",
// "0712***678 JOHN KAMAU". Anything else falls back to the words in the text.
export function payer(text) {
  const s = String(text ?? "");
  const m = s.match(/(\+?254[\d*]{6,12}|0[71][\d*]{6,10})/);
  const phone = m ? phoneKey(m[1]) : null;
  const rest = m ? s.slice(m.index + m[0].length) : s.replace(/^.*?(received from|from)\s*-?/i, "");
  const name = rest.replace(/^[\s\-:]+/, "").replace(/\s+/g, " ").trim();
  return { phone, name };
}

export function readStatement({ header, rows }, columns = guessColumns(header)) {
  const get = (r, f) => (columns[f] === undefined ? "" : r[columns[f]] ?? "");
  const seen = new Set();
  const payments = [];
  const skipped = { duplicate: 0, notCompleted: 0, outgoing: 0, unreadable: 0 };
  for (const r of rows) {
    const receipt = get(r, "receipt").toUpperCase();
    const amount = money(get(r, "paidIn"));
    const status = get(r, "status").toLowerCase();
    if (status && !/complete|success/.test(status)) { skipped.notCompleted++; continue; }
    if (Number.isNaN(amount)) { skipped.unreadable++; continue; }
    if (!(amount > 0)) { skipped.outgoing++; continue; }
    // Statements copied from several pages often repeat a row. A receipt number is unique per payment.
    if (receipt && seen.has(receipt)) { skipped.duplicate++; continue; }
    if (receipt) seen.add(receipt);
    const who = payer(get(r, "party") || get(r, "details"));
    if (!who.name && get(r, "party")) Object.assign(who, { name: payer(get(r, "details")).name });
    payments.push({ receipt, time: get(r, "time"), amount, account: get(r, "account").trim(), phone: who.phone, name: who.name, details: get(r, "details") });
  }
  return { payments, skipped };
}

export function readExpected({ header, rows }) {
  const h = header.map((x) => x.toLowerCase());
  const taken = new Set();
  const col = (...words) => {
    const i = h.findIndex((c, idx) => !taken.has(idx) && words.some((w) => c.includes(w)));
    if (i >= 0) taken.add(i);
    return i;
  };
  // Name first, so "member name" is not mistaken for the "member no" reference column.
  const c = { name: col("name"), phone: col("phone", "mobile", "msisdn", "number"), amount: col("amount", "due", "expected", "fee", "contribution"), ref: col("ref", "account", "member", "id", "code") };
  if (c.name < 0) throw new Error("The list needs a name column.");
  if (c.amount < 0) throw new Error("The list needs an amount column (what each person should pay).");
  return rows.map((r, i) => ({
    row: i + 2,
    name: r[c.name] || "",
    phone: c.phone >= 0 ? phoneKey(r[c.phone]) : null,
    amount: money(r[c.amount]),
    ref: c.ref >= 0 ? String(r[c.ref] || "").trim() : "",
  })).filter((p) => p.name || p.phone || p.ref);
}

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, "");

export function matchPayments(expected, payments) {
  const people = expected.map((p) => ({ ...p, words: new Set(nameWords(p.name)), paid: 0, payments: [] }));
  const byRef = new Map();
  for (const p of people) if (p.ref) byRef.set(norm(p.ref), [...(byRef.get(norm(p.ref)) || []), p]);
  const unmatched = [];
  const ambiguous = [];

  for (const pay of payments) {
    let hit = null;
    let how = "";
    let candidates = [];
    const refHits = pay.account ? byRef.get(norm(pay.account)) || [] : [];
    if (refHits.length === 1) { hit = refHits[0]; how = "account"; }
    if (!hit && pay.phone) {
      const phoneHits = people.filter((p) => p.phone && (pay.phone.includes("*") ? phoneFits(pay.phone, p.phone) : p.phone === pay.phone));
      if (phoneHits.length === 1) { hit = phoneHits[0]; how = pay.phone.includes("*") ? "masked phone" : "phone"; }
      else if (phoneHits.length > 1) {
        // A masked number fits several people: let the name break the tie.
        const words = nameWords(pay.name);
        const best = phoneHits.filter((p) => words.filter((w) => p.words.has(w)).length >= 1);
        if (best.length === 1) { hit = best[0]; how = "masked phone and name"; } else candidates = phoneHits;
      }
    }
    if (!hit && !candidates.length && pay.name) {
      const words = nameWords(pay.name);
      const scored = people.map((p) => ({ p, shared: words.filter((w) => p.words.has(w)) })).filter((x) => x.shared.length);
      const strong = scored.filter((x) => x.shared.length >= 2);
      if (strong.length === 1) { hit = strong[0].p; how = "name"; }
      else if (strong.length > 1) candidates = strong.map((x) => x.p);
      else {
        const long = scored.filter((x) => x.shared.some((w) => w.length >= 5));
        if (long.length === 1 && scored.length === 1) { hit = long[0].p; how = "one name"; }
        else if (scored.length > 1) candidates = scored.map((x) => x.p);
      }
    }
    if (hit) {
      hit.paid = Math.round((hit.paid + pay.amount) * 100) / 100;
      hit.payments.push({ ...pay, how, check: how === "name" || how === "one name" });
    } else if (candidates.length) {
      ambiguous.push({ ...pay, candidates: candidates.map((p) => p.name) });
    } else {
      unmatched.push(pay);
    }
  }

  const rows = people.map(({ words, ...p }) => {
    const balance = Math.round((p.amount - p.paid) * 100) / 100;
    const status = p.paid === 0 ? "unpaid" : balance > 0 ? "part" : balance < 0 ? "over" : "paid";
    return { ...p, balance, status, check: p.payments.some((x) => x.check) };
  });
  const sum = (xs, f) => Math.round(xs.reduce((s, x) => s + f(x), 0) * 100) / 100;
  return {
    people: rows,
    unmatched,
    ambiguous,
    totals: {
      expected: sum(rows, (p) => p.amount),
      collected: sum(rows, (p) => p.paid),
      outstanding: sum(rows, (p) => Math.max(0, p.balance)),
      unmatched: sum(unmatched, (p) => p.amount) + sum(ambiguous, (p) => p.amount),
      counts: rows.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), { paid: 0, part: 0, over: 0, unpaid: 0 }),
    },
  };
}
