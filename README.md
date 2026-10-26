# M-Pesa Match

Who paid, who didn't, in one minute. Paste an M-Pesa statement and the list of people who should pay. It matches every payment, adds up part payments, and shows who still owes and which money came from people not on the list.

**Live: [mpesa-match.vercel.app/?sample](https://mpesa-match.vercel.app/?sample)** (opens with a sample chama loaded)

Runs in the browser. The statement never leaves the device: no server, no database, no account.

## The problem it fixes

A chama treasurer, a programme collecting fees, a community selling tickets on a paybill: each month someone sits with the M-Pesa statement in one window and the member list in another and ticks names. People pay from a spouse's phone, type the wrong account number, pay in two halves, or pay twice. Statements copied from several PDF pages repeat rows. A failed payment still shows up as a line. Ticking by hand gets it wrong in exactly those cases.

## How it matches

Strongest first, and it never guesses:

1. **Account number** (the A/C No. typed on a paybill), ignoring case and spaces.
2. **Phone number.** Full numbers exactly. Masked numbers like `2547******104` by their visible digits, only when they fit one person; if a masked number fits two, the name breaks the tie.
3. **Name.** Two shared words with one person, in any order (`KAMAU JOHN` is John Kamau). A single long shared word only when nobody else is close. Name matches are marked **check** so a person confirms them.

A payment that fits two people equally goes to **Needs a person** and is not counted. Money from nobody on the list goes to **Not on your list**.

Also handled: the same receipt pasted twice counts once; failed or reversed rows and money out (charges, withdrawals) are left out and counted in a note; part payments add up; over-payments are shown, not hidden.

## Using it

- **Statement:** a CSV export (the business portal export works as is) or rows copied from a spreadsheet, header row included. Columns are found by meaning (Receipt, Paid In, Other Party Info, A/C No.); open **Columns used** to fix a guess.
- **Who should pay:** `name` and `amount`, plus `phone` and a member or account number if you have them.
- **Results:** filter by status, download a CSV, and open a WhatsApp reminder for anyone who still owes, from a template you edit.

## Code

| Path | What |
|---|---|
| `lib/match.js` | Column guessing, statement reading, phone and name rules, the matcher. Pure functions |
| `lib/csv.js` | CSV and tab-separated reader |
| `app/` | The page |
| `sample/` | A made-up chama: 8 members, 11 statement rows with a repeat, a failure, a masked phone, a part payment, a payment from another phone and a stranger |
| `test/` | `npm test` (Node 20+, no dependencies) |

The sample statement follows the column names of an M-Pesa business export. If your export uses different names, the column picker handles it.

## Limits

- It does not read the password-protected statement PDF directly. Open it, copy the table into a sheet, export CSV.
- Name matching works on words, so nicknames and spelling differences (Wanjiku vs Wanjiru) will not match. Those land in **Not on your list** for a person to assign.

MIT licence. Built by [Timothy Mwangi](https://timmwangi.com).
