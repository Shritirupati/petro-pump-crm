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

## Hosting, database and logins (Firebase)

The app runs on **Firebase Hosting** with data in **Cloud Firestore** and logins through **Firebase Authentication**.

- **Logins**: username + password. The first account, made on the one-time setup screen, is the **owner**.
  The owner adds **staff** logins in Settings → Users and can disable them.
- **Staff** can view customers, add customers, credit sales and payments, and share statements.
  Only the owner can edit or delete entries, delete customers, change settings, restore backups or manage users.
  These rules are enforced by the database (`firestore.rules`), not just hidden in the screens.
- **Sync**: every signed-in device sees changes live.
- **Offline**: entries made without internet are saved on the device and upload when the connection returns;
  the app itself opens offline once it has been loaded (service worker).
- **Upgrade from the browser-only version**: on the owner's device, Settings shows "Data found in this browser"
  to upload the old data once.

Project settings are in `js/firebase-config.js` and `.firebaserc`.

### Deploy

See `DEPLOY.txt`. In short, with Node.js installed:

```bash
npm install -g firebase-tools
firebase login
firebase deploy        # rules + website, prints the https://<project>.web.app link
```

### Local testing

```bash
npm test                                             # interest calculation tests
firebase emulators:start --only auth,firestore       # local auth + database
python3 -m http.server 8090                          # then open http://localhost:8090/?emulator
```

## Code

| File | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page and styling |
| `js/app.js` | Screens, forms, WhatsApp sharing |
| `js/pdf.js` | PDF statement layout |
| `js/store.js` | Firebase login, live data sync, users, backup/restore |
| `js/firebase-config.js` | Firebase project settings |
| `firestore.rules` | Who can read and change what |
| `firebase.json`, `.firebaserc` | Hosting and deploy settings |
| `sw.js`, `manifest.webmanifest`, `icon*` | Offline support and install-as-app |
| `js/interest.js` | Interest calculation (pure functions, tested) |
| `js/vendor/` | jsPDF 4.2.1, jsPDF-AutoTable 5.0.8 (MIT) and the Firebase JS SDK 13.0.0 (Apache-2.0), bundled |
| `tests/interest.test.js` | Interest calculation tests |
