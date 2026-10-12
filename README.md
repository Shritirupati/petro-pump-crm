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

## Hosting, database and logins (Cloudflare)

The app runs on a **Cloudflare Worker** (free plan): it serves the files in `public/` and an API under `/api/`,
with data in a **Cloudflare D1** (SQLite) database.

- **Logins**: username + password (PBKDF2-hashed), HttpOnly session cookie for 60 days, and lock-out after
  8 wrong passwords in 15 minutes. The first account, made on the one-time setup screen, is the **owner**.
  The owner adds or disables **staff** logins in Settings → Users.
- **Staff** can view and add customers, add credit sales and payments, and share statements.
  Only the owner can edit or delete entries, delete customers, change settings, restore or erase data, or manage users.
  These rules are checked by the server (`worker/index.js`), not just hidden in the screens.
- **Deleting a customer, erasing or restoring data** needs a yes/no confirmation plus the owner's password and typing DELETE;
  the server checks the password again.
- **Sync**: changes reach the server immediately; other devices pick them up within about 15 seconds.
- **Offline**: the data is kept on the device, so the app opens and works without internet; changes wait in an
  outbox and upload when the connection returns (header shows "Offline · will sync").
- **Upgrade from the browser-only version**: on the owner's device, Settings shows "Data found in this browser"
  to upload the old data once.

### Deploy

See `DEPLOY.txt`. In short, with Node.js installed and a Cloudflare account:

```bash
npm install
npx wrangler login
npm run deploy                                   # creates the D1 database (first time), applies migrations, uploads
npm run reset-password -- <username> <password>  # if someone forgets a password
```

### Local testing

```bash
npm test        # interest calculation tests
npm run dev     # local database + app at http://localhost:8787
```

## Code

| File | Purpose |
|---|---|
| `public/index.html`, `public/css/style.css` | Page and styling |
| `public/js/app.js` | Screens, forms, WhatsApp sharing |
| `public/js/pdf.js` | PDF statement layout |
| `public/js/store.js` | Sign-in, sync with the server, offline outbox, backup/restore |
| `worker/index.js` | API: logins, sessions, permissions, data |
| `migrations/` | Database tables |
| `wrangler.toml` | Cloudflare settings (database id is filled in by the first deploy) |
| `deploy.mjs`, `reset-password.mjs` | Deploy and password-reset helpers |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icon*` | Offline support and install-as-app |
| `public/js/interest.js` | Interest calculation (pure functions, tested) |
| `public/js/vendor/` | jsPDF 4.2.1 and jsPDF-AutoTable 5.0.8 (MIT) |
| `tests/interest.test.js` | Interest calculation tests |
