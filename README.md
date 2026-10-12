# Petrol Pump CRM

A simple web app for a petrol pump to manage credit customers: record credit sales and
payments, calculate interest automatically, and share account statements as PDF.

## Features

- **Customers**: name, mobile, vehicle numbers, address, credit limit, and an optional per-customer interest rate
- **Credit sales**: date, fuel/item, litres × rate = amount (auto), vehicle no., bill no.
- **Payments**: against balance, interest payments, or interest waivers (Cash / UPI / Cheque…)
- **Interest**: % per year, calculated automatically (see below)
- **Ledger**: running balance, days and interest for every entry, statement for any date
- **PDF statement**: download a formatted A4 PDF of the customer's account
- **Send PDF on WhatsApp**: on phones the PDF is attached directly through the share menu;
  on computers the PDF is downloaded and the customer's WhatsApp chat opens to attach it
- **Print**: print-friendly statement (totals printed once, at the end)
- **WhatsApp reminder**: one-click text message with the outstanding amount
- **Dashboard**: total receivable, interest, overdue customers, this month's sales and collections
- **Mistake guard**: warns when a payment is larger than the balance (e.g. an extra zero)
- **Backup**: JSON download/restore and CSV export for Excel
- Works on mobile and desktop

## Interest

The rate is set as **% per year** (simple interest, 365-day year), in Settings and optionally per customer.

### 1. Daily balance method (default)

- Every **credit sale** is charged interest from its date to the statement date.
- Every **payment** earns interest back from its date to the statement date.
- Total outstanding = sales + interest on sales − payments − interest on payments − interest paid/waived.

Example at 24% per year, statement date 07-10-2026:

| | Amount | Days | Interest |
|---|---|---|---|
| Credit sale 07-09-2026 | ₹50,000 | 30 | + ₹986.30 |
| Payment 17-09-2026 | ₹5,000 | 20 | − ₹65.75 |
| **Total outstanding** | ₹45,000 principal + ₹920.55 interest | | **₹45,920.55** |

Interest = amount × rate% ÷ 365 × days. This equals daily interest on the running balance.

### 2. Interest-free period method

- Each credit sale is interest-free for a set number of days (default 30), then interest applies.
- Payments clear the oldest unpaid sale first.

Data saved by older versions (rate per month) is converted automatically: 2% per month becomes 24% per year.

## Running

No server or database needed; it is a static website.

```bash
npm start        # open http://localhost:8080
npm test         # interest calculation tests
```

Or without Node: run `python3 -m http.server 8080` and open `http://localhost:8080`.

### Online (GitHub Pages, free)

Repository **Settings → Pages → Branch: `main` / root → Save**. The app will be available at
`https://<username>.github.io/petro-pump-crm/`.

## Where data is stored (important)

All data is stored in **this browser only** (localStorage):

- It does not sync to other phones or computers.
- Clearing browser data can erase it.
- Use **Settings → Download backup** daily or weekly.

For several devices or staff logins, the next step is an online database (e.g. Firebase or Supabase) with login.

## Code

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page and styling |
| `js/app.js` | Screens, forms, WhatsApp sharing |
| `js/pdf.js` | PDF statement layout |
| `js/store.js` | Saving/loading data, backup, migration |
| `js/interest.js` | Interest calculation (pure functions, tested) |
| `js/vendor/` | jsPDF 4.2.1 and jsPDF-AutoTable 5.0.8 (MIT licence) |
| `tests/interest.test.js` | Interest calculation tests |
