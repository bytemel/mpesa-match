import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRows } from "../lib/csv.js";
import { guessColumns, readStatement, readExpected, matchPayments, payer, phoneKey, money, nameWords } from "../lib/match.js";

const load = (f) => parseRows(readFileSync(new URL(`../sample/${f}`, import.meta.url), "utf8"));

test("columns are found by meaning", () => {
  const { header } = load("statement.csv");
  const c = guessColumns(header);
  assert.equal(header[c.receipt], "Receipt No.");
  assert.equal(header[c.paidIn], "Paid In");
  assert.equal(header[c.withdrawn], "Withdrawn");
  assert.equal(header[c.party], "Other Party Info");
  assert.equal(header[c.account], "A/C No.");
  assert.equal(header[c.time], "Completion Time");
});

test("phones, money and payer text", () => {
  assert.equal(phoneKey("+254 712 000 101"), "712000101");
  assert.equal(phoneKey("0112-000-101"), "112000101");
  assert.equal(phoneKey("2547******104"), "7*104");
  assert.equal(phoneKey("0712***101"), "712*101");
  assert.equal(phoneKey("254*********"), null, "nothing visible, nothing to match");
  assert.equal(phoneKey("020 123 4567"), null);
  assert.equal(money("KES 1,500.50"), 1500.5);
  assert.equal(money(""), 0);
  assert.ok(Number.isNaN(money("abc")));
  assert.deepEqual(payer("254712000101 - AKINYI OTIENO"), { phone: "712000101", name: "AKINYI OTIENO" });
  assert.deepEqual(payer("Funds received from - 0712***101 JANE DOE"), { phone: "712*101", name: "JANE DOE" });
  assert.deepEqual(nameWords("Mr. KAMAU, John"), ["kamau", "john"]);
});

test("the statement drops failures, outgoing money and repeated receipts", () => {
  const { payments, skipped } = readStatement(load("statement.csv"));
  assert.equal(payments.length, 8);
  assert.deepEqual(skipped, { duplicate: 1, notCompleted: 1, outgoing: 1, unreadable: 0 });
});

test("the sample chama matches the way a treasurer would", () => {
  const { payments } = readStatement(load("statement.csv"));
  const r = matchPayments(readExpected(load("members.csv")), payments);
  const by = Object.fromEntries(r.people.map((p) => [p.name, p]));
  assert.equal(by["Akinyi Otieno"].status, "paid");
  assert.equal(by["Akinyi Otieno"].payments[0].how, "account");
  assert.equal(by["Baraka Mwangi"].status, "paid", "two payments of 1000 add up");
  assert.deepEqual(by["Baraka Mwangi"].payments.map((p) => p.how).sort(), ["account", "phone"]);
  assert.equal(by["Chebet Kiprono"].paid, 2000, "the repeated receipt counted once");
  assert.equal(by["Daudi Ochieng"].status, "part");
  assert.equal(by["Daudi Ochieng"].balance, 500);
  assert.equal(by["Daudi Ochieng"].payments[0].how, "masked phone");
  assert.equal(by["Esther Njoroge"].status, "over", "paid from another phone, matched by name");
  assert.equal(by["Esther Njoroge"].check, true, "name matches are flagged for a human");
  assert.equal(by["Faith Achieng"].status, "unpaid", "a failed payment is not a payment");
  assert.equal(by["John Kamau"].status, "paid", "full name beats the shared surname");
  assert.equal(by["Mary Kamau"].status, "unpaid");
  assert.equal(r.unmatched.length + r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0]?.name || r.unmatched[0]?.name, "PETER KAMAU");
  assert.deepEqual(r.totals.counts, { paid: 4, part: 1, over: 1, unpaid: 2 });
  assert.equal(r.ambiguous[0].candidates.length, 2, "Peter Kamau shares only a surname with two members");
});

test("a payment that fits two people is never guessed", () => {
  const expected = [{ name: "Grace Wanjiku", phone: null, amount: 100, ref: "" }, { name: "Grace Wambui", phone: null, amount: 100, ref: "" }];
  const r = matchPayments(expected, [{ receipt: "X", amount: 100, account: "", phone: null, name: "GRACE W" }]);
  assert.equal(r.ambiguous.length, 1);
  assert.deepEqual(r.ambiguous[0].candidates, ["Grace Wanjiku", "Grace Wambui"]);
  assert.equal(r.people.every((p) => p.paid === 0), true);
});

test("a masked phone that fits two people uses the name to decide", () => {
  const expected = [{ name: "Ann Mumbi", phone: "712000104", amount: 100, ref: "" }, { name: "Joy Atieno", phone: "713000104", amount: 100, ref: "" }];
  const r = matchPayments(expected, [{ receipt: "Y", amount: 100, account: "", phone: "7*104", name: "JOY ATIENO" }]);
  assert.equal(r.people[1].status, "paid");
  assert.equal(r.people[1].payments[0].how, "masked phone and name");
});

test("tab separated text from a spreadsheet works", () => {
  const { header, rows } = parseRows("Name\tAmount\nA B\t100\n");
  assert.deepEqual(header, ["Name", "Amount"]);
  assert.deepEqual(rows, [["A B", "100"]]);
});
