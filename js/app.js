// Bump ?v= here and in index.html on every release so browsers load the new files.
import {
  db, FUELS, PAY_MODES, session, sync, uid, usernameOk, setHandlers, watchAuth, isSetupDone,
  signIn, signOutUser, createOwner, createStaff, setUserActive, changeMyPassword, verifyPassword,
} from './store.js?v=2026-10-14';
import { computeAccount, monthlyBreakdown, sortEntries, round2, TYPES, METHODS } from './interest.js?v=2026-10-14';
import { buildStatementPdf } from './pdf.js?v=2026-10-14';

const app = document.getElementById('app');
const modal = document.getElementById('modal');
const modalForm = document.getElementById('modal-form');

// ---------- helpers ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => {
  const v = round2(Number(n) || 0);
  return (Number.isInteger(v) ? inr : inrPaise).format(v);
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('-') : '');

const TYPE_LABEL = {
  [TYPES.UDHAR]: 'Credit Sale',
  [TYPES.JAMA]: 'Payment',
  [TYPES.BYAAJ_JAMA]: 'Interest Paid',
  [TYPES.BYAAJ_MAAF]: 'Interest Waived',
};
const typeLabel = (t) => TYPE_LABEL[t] || t;

function termsFor(c) {
  const s = db.settings;
  return {
    ratePerYear: c.ratePerYear !== '' && c.ratePerYear != null ? Number(c.ratePerYear) : Number(s.ratePerYear),
    graceDays: c.graceDays !== '' && c.graceDays != null ? Number(c.graceDays) : Number(s.graceDays),
    method: s.interestMethod || METHODS.KHATA,
  };
}

function summaryFor(c, asOf = today()) {
  return computeAccount(db.entriesFor(c.id), { ...termsFor(c), asOf });
}

function termsText(t) {
  return t.method === METHODS.FIFO
    ? `Interest ${t.ratePerYear}% p.a. after ${t.graceDays} interest-free days`
    : `Interest ${t.ratePerYear}% p.a. · Daily balance method`;
}

function ageBadge(days, grace) {
  if (!days) return '';
  const cls = days > grace + 60 ? 'danger' : days > grace ? 'warn' : '';
  return `<span class="badge ${cls}">${days} days</span>`;
}

function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const download = (filename, text, type) => downloadBlob(filename, new Blob([text], { type }));

function waNumber(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

// ---------- modal ----------

let modalSubmit = null;

function openModal({ title, body, submitLabel = 'Save', onSubmit, onOpen }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-submit').textContent = submitLabel;
  document.getElementById('modal-submit').className = 'btn primary';
  modalSubmit = onSubmit;
  modal.showModal();
  onOpen?.(modalForm);
  modalForm.querySelector('input:not([type=hidden]), select, textarea')?.focus();
}

modalForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!modalForm.checkValidity()) {
    modalForm.reportValidity();
    return;
  }
  const data = Object.fromEntries(new FormData(modalForm).entries());
  if (modalSubmit && modalSubmit(data, modalForm) === false) return;
  modal.close();
  render();
});
modal.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-close]')) modal.close();
});

// ---------- forms ----------

function customerForm(c = {}) {
  const s = db.settings;
  openModal({
    title: c.id ? 'Edit customer' : 'New customer',
    body: `
      <div class="field"><label for="f-name">Name *</label><input id="f-name" name="name" required value="${esc(c.name)}" placeholder="e.g. Sharma Transport"></div>
      <div class="grid2">
        <div class="field"><label for="f-mobile">Mobile</label><input id="f-mobile" name="mobile" type="tel" inputmode="tel" value="${esc(c.mobile)}" placeholder="10 digits"></div>
        <div class="field"><label for="f-vehicle">Vehicle number(s)</label><input id="f-vehicle" name="vehicle" value="${esc(c.vehicle)}" placeholder="MP09 AB 1234"></div>
      </div>
      <div class="field"><label for="f-address">Address</label><input id="f-address" name="address" value="${esc(c.address)}"></div>
      <div class="grid3">
        <div class="field"><label for="f-limit">Credit limit (₹)</label><input id="f-limit" name="creditLimit" type="number" min="0" step="1" value="${esc(c.creditLimit)}" placeholder="No limit"></div>
        <div class="field"><label for="f-rate">Interest % per year</label><input id="f-rate" name="ratePerYear" type="number" min="0" step="0.01" value="${esc(c.ratePerYear)}" placeholder="${esc(s.ratePerYear)} (default)"></div>
        <div class="field"><label for="f-grace">Overdue after (days)</label><input id="f-grace" name="graceDays" type="number" min="0" step="1" value="${esc(c.graceDays)}" placeholder="${esc(s.graceDays)} (default)"></div>
      </div>
      <p class="hint">Leave interest rate and days empty to use the defaults from Settings.</p>
      <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" rows="2">${esc(c.notes)}</textarea></div>`,
    onSubmit(d) {
      const id = db.upsertCustomer({ ...(c.id ? { id: c.id } : {}), ...d, name: d.name.trim() });
      toast('Customer saved');
      if (!c.id) location.hash = `#/customer/${id}`;
    },
  });
}

function saleForm(customer, entry = {}) {
  const s = db.settings;
  const fuel = entry.fuel || 'Diesel';
  openModal({
    title: `${entry.id ? 'Edit credit sale' : 'New credit sale'} – ${customer.name}`,
    submitLabel: 'Save sale',
    body: `
      <div class="grid2">
        <div class="field"><label for="u-date">Date *</label><input id="u-date" name="date" type="date" required max="${today()}" value="${esc(entry.date || today())}"></div>
        <div class="field"><label for="u-fuel">Item</label><select id="u-fuel" name="fuel">${FUELS.map((f) => `<option ${f === fuel ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      </div>
      <div class="grid3">
        <div class="field"><label for="u-qty">Litres</label><input id="u-qty" name="qty" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(entry.qty)}"></div>
        <div class="field"><label for="u-rate">Rate (₹/L)</label><input id="u-rate" name="rate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(entry.rate ?? (s.lastRates[fuel] || ''))}"></div>
        <div class="field"><label for="u-amount">Amount (₹) *</label><input id="u-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(entry.amount)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="u-vehicle">Vehicle number</label><input id="u-vehicle" name="vehicle" value="${esc(entry.vehicle ?? customer.vehicle ?? '')}"></div>
        <div class="field"><label for="u-bill">Bill / slip no.</label><input id="u-bill" name="billNo" value="${esc(entry.billNo)}"></div>
      </div>
      <div class="field"><label for="u-note">Note</label><input id="u-note" name="note" value="${esc(entry.note)}" placeholder="e.g. driver name"></div>
      <p class="hint" id="u-limit"></p>`,
    onOpen(form) {
      const qty = form.elements.qty, rate = form.elements.rate, amount = form.elements.amount, fuelSel = form.elements.fuel;
      const recalc = () => {
        const q = parseFloat(qty.value), r = parseFloat(rate.value);
        if (q > 0 && r > 0) amount.value = round2(q * r);
      };
      qty.addEventListener('input', recalc);
      rate.addEventListener('input', recalc);
      fuelSel.addEventListener('change', () => {
        const last = s.lastRates[fuelSel.value];
        if (last) { rate.value = last; recalc(); }
      });
      const limit = Number(customer.creditLimit) || 0;
      if (limit) {
        const due = summaryFor(customer).principalDue;
        form.querySelector('#u-limit').textContent = `Credit limit ${money(limit)} · current balance ${money(due)} · available ${money(limit - due)}`;
      }
    },
    onSubmit(d) {
      const amount = round2(parseFloat(d.amount));
      if (!(amount > 0)) { alert('Please enter a valid amount.'); return false; }
      const limit = Number(customer.creditLimit) || 0;
      if (limit && !entry.id) {
        const due = summaryFor(customer).principalDue;
        if (due + amount > limit && !confirm(`After this sale the balance will be ${money(due + amount)}, which is above the credit limit of ${money(limit)}. Save anyway?`)) return false;
      }
      const rec = { customerId: customer.id, type: TYPES.UDHAR, date: d.date, fuel: d.fuel, qty: d.qty, rate: d.rate, amount, vehicle: d.vehicle, billNo: d.billNo, note: d.note };
      if (parseFloat(d.rate) > 0) db.updateSettings({ lastRates: { ...s.lastRates, [d.fuel]: parseFloat(d.rate) } });
      if (entry.id) db.updateEntry({ ...rec, id: entry.id }); else db.addEntry(rec);
      toast(`Credit sale of ${money(amount)} saved`);
    },
  });
}

function paymentForm(customer, entry = {}) {
  const sum = summaryFor(customer);
  const type = entry.type || TYPES.JAMA;
  openModal({
    title: `${entry.id ? 'Edit entry' : 'Receive payment'} – ${customer.name}`,
    submitLabel: 'Save payment',
    body: `
      <p class="small muted" style="margin-top:0">Outstanding now: principal <b>${money(sum.principalDue)}</b> · interest <b>${money(sum.interestDue)}</b> · total <b>${money(sum.totalDue)}</b></p>
      <div class="field"><label for="j-type">Payment for</label>
        <select id="j-type" name="type">
          <option value="${TYPES.JAMA}" ${type === TYPES.JAMA ? 'selected' : ''}>Payment against balance</option>
          <option value="${TYPES.BYAAJ_JAMA}" ${type === TYPES.BYAAJ_JAMA ? 'selected' : ''}>Interest payment</option>
          <option value="${TYPES.BYAAJ_MAAF}" ${type === TYPES.BYAAJ_MAAF ? 'selected' : ''}>Interest waiver (discount)</option>
        </select></div>
      <div class="grid2">
        <div class="field"><label for="j-date">Date *</label><input id="j-date" name="date" type="date" required max="${today()}" value="${esc(entry.date || today())}"></div>
        <div class="field"><label for="j-amount">Amount (₹) *</label><input id="j-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(entry.amount)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="j-mode">Mode</label><select id="j-mode" name="mode">${PAY_MODES.map((m) => `<option ${m === entry.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="j-ref">Reference / UTR</label><input id="j-ref" name="ref" value="${esc(entry.ref)}"></div>
      </div>
      <div class="field"><label for="j-note">Note</label><input id="j-note" name="note" value="${esc(entry.note)}"></div>`,
    onSubmit(d) {
      const amount = round2(parseFloat(d.amount));
      if (!(amount > 0)) { alert('Please enter a valid amount.'); return false; }
      // Catch typing mistakes such as an extra zero (30,00,000 instead of 3,00,000).
      const previous = entry.id && entry.type === d.type ? Number(entry.amount) || 0 : 0;
      const limit = d.type === TYPES.JAMA ? sum.principalDue + previous : sum.interestDue + previous;
      if (amount > Math.max(0, limit) + 0.5 &&
        !confirm(`${money(amount)} is more than the ${d.type === TYPES.JAMA ? 'principal balance' : 'interest due'} of ${money(Math.max(0, limit))}.\n\nPlease check the amount for an extra zero. Save anyway?`)) return false;
      const rec = { customerId: customer.id, type: d.type, date: d.date, amount, mode: d.mode, ref: d.ref, note: d.note };
      if (entry.id) db.updateEntry({ ...rec, id: entry.id }); else db.addEntry(rec);
      toast(`${typeLabel(d.type)} of ${money(amount)} saved`);
    },
  });
}

function editEntry(entry) {
  const c = db.customer(entry.customerId);
  if (entry.type === TYPES.UDHAR) saleForm(c, entry); else paymentForm(c, entry);
}

// ---------- statement data (shared by screen, print and PDF) ----------

// Per-entry interest: + on credit sales, − on payments / interest paid / waived.
function interestByEntry(sum) {
  const map = new Map();
  if (sum.method === METHODS.KHATA) {
    for (const r of sum.udharRows) map.set(r.entry.id, { days: r.days, value: r.interest });
    for (const r of sum.jamaRows) map.set(r.entry.id, { days: r.days, value: -r.interest });
    for (const r of sum.byaajRows) map.set(r.entry.id, { value: -r.amount });
  } else {
    for (const l of sum.lots) map.set(l.id, { days: l.remaining ? l.pendingDays : '', value: l.interest });
  }
  for (const e of db.entries) {
    if ((e.type === TYPES.BYAAJ_JAMA || e.type === TYPES.BYAAJ_MAAF) && !map.has(e.id)) map.set(e.id, { value: -Number(e.amount) });
  }
  return map;
}

function statementData(c, asOf) {
  const terms = termsFor(c);
  const { account: sum, months } = monthlyBreakdown(db.entriesFor(c.id), { ...terms, asOf });
  const interest = interestByEntry(sum);
  let balance = 0;
  const rows = sortEntries(db.entriesFor(c.id).filter((e) => e.date <= asOf)).map((e) => {
    if (e.type === TYPES.UDHAR) balance += Number(e.amount);
    if (e.type === TYPES.JAMA) balance -= Number(e.amount);
    const ri = interest.get(e.id);
    return { e, balance: round2(balance), days: ri?.days ?? '', interest: ri?.value || 0 };
  });
  return { terms, sum, rows, months };
}

const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

function entryDetails(e) {
  if (e.type === TYPES.UDHAR) {
    return [e.fuel, e.qty ? `${e.qty} L` : '', e.rate ? `@ ₹${e.rate}` : '', e.vehicle, e.billNo ? `Bill ${e.billNo}` : '', e.note].filter(Boolean).join(' · ');
  }
  return [e.mode, e.ref, e.note].filter(Boolean).join(' · ');
}
const entryBy = (e) => (e.by ? ` · by ${e.by}` : '');

// ---------- PDF and WhatsApp ----------

function makePdf(c, asOf) {
  if (!window.jspdf || !window.autoTable) throw new Error('PDF library did not load. Please refresh the page.');
  const { terms, sum, rows, months } = statementData(c, asOf);
  const doc = buildStatementPdf({
    settings: db.settings, customer: c, termsLabel: termsText(terms), sum, rows, months, asOf,
    fmtDate, typeLabel, details: entryDetails, monthName,
  });
  const safe = c.name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'customer';
  return { blob: doc.output('blob'), filename: `Statement_${safe}_${fmtDate(asOf)}.pdf`, sum };
}

function reminderText(c, sum, asOf) {
  const s = db.settings;
  return `Dear ${c.name},\nThis is a reminder from ${s.pumpName}. Your account as of ${fmtDate(asOf)}:\n` +
    `Principal balance: ${money(sum.principalDue)}\nInterest due: ${money(sum.interestDue)}\nTotal outstanding: ${money(sum.totalDue)}\n` +
    `Kindly clear the payment at the earliest. Thank you.${s.phone ? `\nContact: ${s.phone}` : ''}`;
}

function downloadPdf(c, asOf) {
  try {
    const { blob, filename } = makePdf(c, asOf);
    downloadBlob(filename, blob);
    toast('PDF downloaded');
  } catch (err) {
    alert(err.message);
  }
}

async function sendPdfOnWhatsApp(c, asOf) {
  let pdf;
  try { pdf = makePdf(c, asOf); } catch (err) { alert(err.message); return; }
  const text = reminderText(c, pdf.sum, asOf);
  const file = new File([pdf.blob], pdf.filename, { type: 'application/pdf' });

  // Phones (Android / iPhone): the share sheet attaches the PDF directly; pick WhatsApp there.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: pdf.filename, text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  // Computers: WhatsApp does not let a website attach files, so download the PDF and open the chat.
  downloadBlob(pdf.filename, pdf.blob);
  const wa = waNumber(c.mobile);
  const url = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
  toast('PDF downloaded. In the WhatsApp chat, click the 📎 attach button and choose the PDF.', 8000);
}

// ---------- pages ----------

function pageDashboard() {
  const asOf = today();
  const rows = db.customers.map((c) => ({ c, sum: summaryFor(c, asOf), terms: termsFor(c) }));
  const total = (k) => rows.reduce((a, r) => a + Math.max(0, r.sum[k]), 0);
  const monthStart = asOf.slice(0, 8) + '01';
  const thisMonth = db.entries.filter((e) => e.date >= monthStart && e.date <= asOf);
  const mSales = thisMonth.filter((e) => e.type === TYPES.UDHAR).reduce((a, e) => a + Number(e.amount), 0);
  const mPaid = thisMonth.filter((e) => e.type === TYPES.JAMA || e.type === TYPES.BYAAJ_JAMA).reduce((a, e) => a + Number(e.amount), 0);
  const due = rows.filter((r) => r.sum.totalDue > 0.5).sort((a, b) => b.sum.totalDue - a.sum.totalDue);
  const overdue = due.filter((r) => r.sum.oldestPendingDays > r.terms.graceDays).length;
  const recent = sortEntries(db.entries).reverse().slice(0, 8);

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><div class="sub">As of ${fmtDate(asOf)} · ${esc(termsText(termsFor({})))}</div></div>
      <div class="actions">
        <button class="btn primary" data-act="new-customer">+ New customer</button>
      </div>
    </div>

    ${db.customers.length ? '' : `
      <div class="panel"><div class="empty">
        <p><b>No customers yet.</b></p>
        <p>Add your first customer to start.</p>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" data-act="new-customer">+ Add first customer</button>
        </div>
      </div></div>`}

    <div class="cards">
      <div class="card"><div class="label">Principal outstanding</div><div class="value">${money(total('principalDue'))}</div></div>
      <div class="card warn"><div class="label">Interest outstanding</div><div class="value">${money(total('interestDue'))}</div></div>
      <div class="card danger"><div class="label">Total receivable</div><div class="value">${money(total('totalDue'))}</div></div>
      <div class="card"><div class="label">Customers · overdue</div><div class="value">${db.customers.length} · <span class="text-danger">${overdue}</span></div></div>
      <div class="card"><div class="label">Credit sales this month</div><div class="value">${money(mSales)}</div></div>
      <div class="card ok"><div class="label">Collected this month</div><div class="value">${money(mPaid)}</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Highest outstanding</h2><a href="#/customers" class="small">All customers →</a></div>
      ${due.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Mobile</th><th class="num">Principal</th><th class="num">Interest</th><th class="num">Total</th><th>Oldest due</th></tr></thead>
        <tbody>${due.slice(0, 10).map(({ c, sum, terms }) => `
          <tr class="clickable" data-href="#/customer/${c.id}">
            <td><b>${esc(c.name)}</b></td><td>${esc(c.mobile)}</td>
            <td class="num">${money(sum.principalDue)}</td><td class="num">${money(sum.interestDue)}</td>
            <td class="num"><b>${money(sum.totalDue)}</b></td><td>${ageBadge(sum.oldestPendingDays, terms.graceDays)}</td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing outstanding.</div>'}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Recent entries</h2></div>
      ${recent.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Details</th><th class="num">Amount</th></tr></thead>
        <tbody>${recent.map((e) => {
          const c = db.customer(e.customerId);
          return `<tr class="clickable" data-href="#/customer/${e.customerId}">
            <td>${fmtDate(e.date)}</td><td>${esc(c?.name)}</td><td><span class="badge ${e.type}">${typeLabel(e.type)}</span></td>
            <td class="muted">${esc(entryDetails(e))}</td><td class="num">${money(e.amount)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">No entries yet.</div>'}
    </div>`;
}

function pageCustomers(query = '') {
  const asOf = today();
  const q = query.trim().toLowerCase();
  const list = db.customers
    .filter((c) => !q || [c.name, c.mobile, c.vehicle].some((v) => String(v || '').toLowerCase().includes(q)))
    .map((c) => ({ c, sum: summaryFor(c, asOf), terms: termsFor(c) }))
    .sort((a, b) => b.sum.totalDue - a.sum.totalDue || a.c.name.localeCompare(b.c.name));
  const sumOf = (k) => list.reduce((a, r) => a + r.sum[k], 0);

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Customers</h1><div class="sub">${db.customers.length} customers</div></div>
      <div class="actions">
        <input type="search" class="search" id="search" placeholder="Search name, mobile or vehicle no." value="${esc(query)}">
        <button class="btn primary" data-act="new-customer">+ New customer</button>
      </div>
    </div>
    <div class="panel">
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Mobile</th><th>Vehicle</th><th class="num">Principal</th><th class="num">Interest</th><th class="num">Total due</th><th>Oldest due</th></tr></thead>
        <tbody>${list.map(({ c, sum, terms }) => {
          const over = Number(c.creditLimit) > 0 && sum.principalDue > Number(c.creditLimit);
          return `<tr class="clickable" data-href="#/customer/${c.id}">
            <td><b>${esc(c.name)}</b>${over ? ' <span class="badge danger">Over limit</span>' : ''}</td>
            <td>${esc(c.mobile)}</td><td>${esc(c.vehicle)}</td>
            <td class="num">${money(sum.principalDue)}</td><td class="num">${money(sum.interestDue)}</td>
            <td class="num"><b class="${sum.totalDue > 0.5 ? 'text-danger' : ''}">${money(sum.totalDue)}</b></td>
            <td>${ageBadge(sum.oldestPendingDays, terms.graceDays)}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num">${money(sumOf('principalDue'))}</td><td class="num">${money(sumOf('interestDue'))}</td><td class="num">${money(sumOf('totalDue'))}</td><td></td></tr></tfoot>
        </table></div>` : `<div class="empty">${q ? 'No matching customers.' : 'No customers yet. Click "+ New customer".'}</div>`}
    </div>`;

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    const pos = search.selectionStart;
    pageCustomers(search.value);
    const s2 = document.getElementById('search');
    s2.focus();
    s2.setSelectionRange(pos, pos);
  });
}

let customerTab = 'ledger';
const openMonths = new Map(); // customer id -> months the user has opened

// Printing shows every month, open or not.
window.addEventListener('beforeprint', () => document.querySelectorAll('details.month').forEach((d) => { d.open = true; }));
let customerAsOf = null;

function pageCustomer(id) {
  const c = db.customer(id);
  if (!c) { app.innerHTML = '<div class="panel"><div class="empty">Customer not found. <a href="#/customers">Go back</a></div></div>'; return; }
  const s = db.settings;
  const asOf = customerAsOf || today();
  const { terms, sum, rows, months } = statementData(c, asOf);
  const limit = Number(c.creditLimit) || 0;
  const wa = waNumber(c.mobile);

  const ledgerRow = ({ e, balance, days, interest }) => {
    const isSale = e.type === TYPES.UDHAR;
    return `<tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="badge ${e.type}">${typeLabel(e.type)}</span></td>
      <td class="muted">${esc(entryDetails(e))}<span class="small">${esc(entryBy(e))}</span></td>
      <td class="num text-danger">${isSale ? money(e.amount) : ''}</td>
      <td class="num text-ok">${!isSale ? money(e.amount) : ''}</td>
      <td class="num"><b>${money(balance)}</b></td>
      <td class="num muted">${days}</td>
      <td class="num ${interest < 0 ? 'text-ok' : 'text-danger'}">${interest ? (interest < 0 ? '− ' : '+ ') + money(Math.abs(interest)) : ''}</td>
      <td class="no-print">${session.isOwner ? `<button class="icon-btn" title="Edit" data-edit="${e.id}">✎</button><button class="icon-btn" title="Delete" data-del="${e.id}">🗑</button>` : ''}</td>
    </tr>`;
  };
  const rowsByMonth = (ym) => rows.filter((r) => r.e.date.slice(0, 7) === ym);
  if (!openMonths.has(c.id) && months.length) openMonths.set(c.id, new Set([months[months.length - 1].month]));
  const open = openMonths.get(c.id) || new Set();
  const cell = (label, value, cls = '') => `<span class="m-cell ${cls}"><small>${label}</small>${value}</span>`;
  const monthsHtml = months.map((m) => {
    const list = rowsByMonth(m.month);
    return `<details class="month" data-month="${m.month}" ${open.has(m.month) ? 'open' : ''}>
      <summary>
        <span class="m-name">${monthName(m.month)}<small>${list.length} ${list.length === 1 ? 'entry' : 'entries'}</small></span>
        ${cell('Sales', money(m.sales), 'text-danger')}
        ${cell('Payments', money(m.payments), 'text-ok')}
        ${cell('Interest', money(m.interest), 'text-warn')}
        ${cell('Closing balance', money(m.closingBalance))}
        ${cell('Total due', money(m.totalDue), 'strong')}
      </summary>
      <div class="month-strip">
        <span>Opening balance <b>${money(m.openingBalance)}</b></span>
        <span>+ Sales <b>${money(m.sales)}</b></span>
        <span>− Payments <b>${money(m.payments)}</b></span>
        <span>= Closing balance <b>${money(m.closingBalance)}</b></span>
        <span>Interest this month <b>${money(m.interest)}</b></span>
        ${m.interestPaid ? `<span>Interest paid <b>${money(m.interestPaid)}</b></span>` : ''}
        ${m.interestWaived ? `<span>Interest waived <b>${money(m.interestWaived)}</b></span>` : ''}
        <span>Interest due at month end <b>${money(m.interestDue)}</b></span>
        <span>Total due at month end <b>${money(m.totalDue)}</b></span>
      </div>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Sale (+)</th><th class="num">Payment (−)</th><th class="num">Balance</th><th class="num">Days</th><th class="num">Interest till ${fmtDate(asOf)}</th><th class="no-print"></th></tr></thead>
        <tbody>${list.map(ledgerRow).join('')}</tbody>
      </table></div>` : '<div class="empty small">No entries this month. Interest is on the balance carried forward.</div>'}
    </details>`;
  }).join('');

  const lotRows = (sum.lots || []).map((l) => {
    const paid = l.payments.map((p) => `${fmtDate(p.date)}: ${money(p.amount)}${p.fromAdvance ? ' (from advance)' : ` · interest for ${p.days} days ${money(p.interest)}`}`).join('<br>');
    return `<tr>
      <td>${fmtDate(l.date)}</td><td class="num">${money(l.amount)}</td>
      <td class="small">${paid || '<span class="muted">—</span>'}</td>
      <td class="num">${l.remaining ? money(l.remaining) : '<span class="text-ok">Paid</span>'}</td>
      <td class="num">${l.remaining ? `${l.pendingDays} days` : ''}</td>
      <td class="num"><b>${money(l.interest)}</b></td></tr>`;
  }).join('');

  app.innerHTML = `
    <div class="print-only" style="margin-bottom:12px">
      <h1>${esc(s.pumpName)}</h1>
      <div>${esc(s.address)} ${s.phone ? `· ${esc(s.phone)}` : ''}</div>
      <h2 style="margin-top:10px">Account statement as of ${fmtDate(asOf)}</h2>
    </div>
    <div class="page-head">
      <div>
        <div class="no-print small"><a href="#/customers">← Customers</a></div>
        <h1>${esc(c.name)}</h1>
        <div class="info-row">
          ${c.mobile ? `<span>📞 <a href="tel:${esc(c.mobile)}">${esc(c.mobile)}</a></span>` : ''}
          ${c.vehicle ? `<span>🚚 ${esc(c.vehicle)}</span>` : ''}
          ${c.address ? `<span>📍 ${esc(c.address)}</span>` : ''}
          <span>${esc(termsText(terms))}</span>
          ${limit ? `<span>Limit ${money(limit)}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        <button class="btn udhar" data-act="sale">+ Credit sale</button>
        <button class="btn jama" data-act="payment">+ Payment</button>
        <button class="btn wa" data-act="wa-pdf">Send PDF on WhatsApp</button>
        <button class="btn" data-act="pdf">Download PDF</button>
        <button class="btn" data-act="print">Print</button>
        ${wa ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(reminderText(c, sum, asOf))}">WhatsApp reminder</a>` : ''}
        <button class="btn" data-act="edit-customer">Edit</button>
        ${session.isOwner ? '<button class="btn ghost text-danger" data-act="delete-customer">Delete</button>' : ''}
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="label">Principal balance</div><div class="value">${money(sum.principalDue)}</div>${sum.advance ? `<div class="small text-ok">Advance ${money(sum.advance)}</div>` : ''}</div>
      <div class="card warn"><div class="label">Interest due</div><div class="value">${money(sum.interestDue)}</div>${sum.interestPaid || sum.interestWaived ? `<div class="small muted">Charged ${money(sum.interestAccrued)} · paid ${money(sum.interestPaid)} · waived ${money(sum.interestWaived)}</div>` : ''}</div>
      <div class="card danger"><div class="label">Total outstanding</div><div class="value">${money(sum.totalDue)}</div></div>
      <div class="card"><div class="label">Oldest unpaid sale</div><div class="value">${sum.oldestPendingDate ? `${sum.oldestPendingDays} days` : '—'}</div>${sum.oldestPendingDate ? `<div class="small muted">since ${fmtDate(sum.oldestPendingDate)}</div>` : ''}</div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="tabs no-print">
          <button data-tab="ledger" class="${customerTab === 'ledger' ? 'active' : ''}">Ledger</button>
          <button data-tab="interest" class="${customerTab === 'interest' ? 'active' : ''}">Interest details</button>
        </div>
        <div class="no-print" style="display:flex;align-items:center;gap:8px">
          <label for="asof" style="margin:0">Statement date</label>
          <input type="date" id="asof" value="${asOf}" style="width:auto">
        </div>
      </div>
      ${customerTab === 'ledger' ? (rows.length ? `
        <div class="month-tools no-print">
          <span class="small muted">Month-wise ledger. Click a month to open or close it.</span>
          <span><button class="btn small" data-months="open">Open all</button> <button class="btn small" data-months="close">Close all</button></span>
        </div>
        <div class="months">${monthsHtml}</div>
        <div class="months-total">
          <span class="m-name">All months</span>
          ${cell('Sales', money(sum.totalUdhar), 'text-danger')}
          ${cell('Payments', money(sum.totalJama), 'text-ok')}
          ${cell('Interest', money(sum.interestAccrued), 'text-warn')}
          ${cell('Balance', money(sum.principalDue))}
          ${cell('Total due', money(sum.totalDue), 'strong')}
        </div>
        ${summaryBox(sum, asOf)}` : '<div class="empty">No entries yet. Click "+ Credit sale" or "+ Payment".</div>')
      : sum.method === METHODS.KHATA ? khataHtml(sum, terms, asOf)
      : (sum.lots.length ? `<div class="panel-body small muted">Each credit sale is interest-free for ${esc(terms.graceDays)} days, then charged ${esc(terms.ratePerYear)}% per year (simple interest). Payments clear the oldest sale first, and interest stops on the part that is paid.</div>
        <div class="table-wrap"><table>
        <thead><tr><th>Sale date</th><th class="num">Amount</th><th>Payments received</th><th class="num">Unpaid</th><th class="num">Interest days</th><th class="num">Interest</th></tr></thead>
        <tbody>${lotRows}</tbody>
        <tfoot>
          <tr><td colspan="5">Interest charged</td><td class="num">${money(sum.interestAccrued)}</td></tr>
          ${sum.interestPaid ? `<tr><td colspan="5">Interest paid</td><td class="num">− ${money(sum.interestPaid)}</td></tr>` : ''}
          ${sum.interestWaived ? `<tr><td colspan="5">Interest waived</td><td class="num">− ${money(sum.interestWaived)}</td></tr>` : ''}
          <tr><td colspan="5">Interest due</td><td class="num">${money(sum.interestDue)}</td></tr>
        </tfoot></table></div>
        ${summaryBox(sum, asOf)}` : '<div class="empty">No credit sales.</div>')}
    </div>
    ${c.notes ? `<div class="panel"><div class="panel-body"><b>Notes:</b> ${esc(c.notes)}</div></div>` : ''}`;

  const on = (act, fn) => { const el = app.querySelector(`[data-act=${act}]`); if (el) el.onclick = fn; };
  on('sale', () => saleForm(c));
  on('payment', () => paymentForm(c));
  on('wa-pdf', () => sendPdfOnWhatsApp(c, asOf));
  on('pdf', () => downloadPdf(c, asOf));
  on('print', () => window.print());
  on('edit-customer', () => customerForm(c));
  on('delete-customer', () => confirmWithPassword({
    title: `Delete ${c.name}`,
    warning: `Delete "${c.name}" and all ${db.entriesFor(c.id).length} entries? This cannot be undone.`,
    action: () => {
      db.deleteCustomer(c.id);
      toast('Customer deleted');
      location.hash = '#/customers';
    },
  }));
  app.querySelectorAll('details.month').forEach((d) => {
    d.addEventListener('toggle', () => {
      const set = openMonths.get(c.id) || new Set();
      if (d.open) set.add(d.dataset.month); else set.delete(d.dataset.month);
      openMonths.set(c.id, set);
    });
  });
  app.querySelectorAll('[data-months]').forEach((b) => {
    b.onclick = () => {
      const openAll = b.dataset.months === 'open';
      openMonths.set(c.id, new Set(openAll ? months.map((m) => m.month) : []));
      app.querySelectorAll('details.month').forEach((d) => { d.open = openAll; });
    };
  });
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { customerTab = b.dataset.tab; render(); }; });
  app.querySelector('#asof').onchange = (ev) => { customerAsOf = ev.target.value || null; render(); };
  app.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editEntry(db.entries.find((e) => e.id === b.dataset.edit)); });
  app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const e = db.entries.find((x) => x.id === b.dataset.del);
      if (confirm(`Delete the ${typeLabel(e.type)} of ${money(e.amount)} dated ${fmtDate(e.date)}?`)) {
        db.deleteEntry(e.id);
        toast('Entry deleted');
        render();
      }
    };
  });
}

function khataHtml(sum, terms, asOf) {
  if (!sum.udharRows.length && !sum.jamaRows.length) return '<div class="empty">No entries yet.</div>';
  const table = (title, cls, rows, total, interest, empty) => `
    <div class="khata-col">
      <h3 class="${cls}">${title}</h3>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th class="vivran">Details</th><th class="num">Amount</th><th class="num">Days</th><th class="num">Interest</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td class="muted small vivran">${esc(entryDetails(r.entry))}</td><td class="num">${money(r.amount)}</td><td class="num">${r.days}</td><td class="num">${money(r.interest)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="vivran"></td><td class="num">${money(total)}</td><td></td><td class="num">${money(interest)}</td></tr></tfoot>
      </table></div>` : `<div class="empty">${empty}</div>`}
    </div>`;
  return `
    <div class="panel-body small muted">Daily balance method: every credit sale is charged interest from its date to ${fmtDate(asOf)}, and every payment earns interest back from its date to ${fmtDate(asOf)}.
      Interest = amount × ${esc(terms.ratePerYear)}% ÷ 365 × days.</div>
    <div class="khata-grid">
      ${table('Credit sales and interest charged', 'text-danger', sum.udharRows, sum.totalUdhar, sum.udharInterest, 'No credit sales')}
      ${table('Payments and interest credited', 'text-ok', sum.jamaRows, sum.totalJama, sum.jamaInterest, 'No payments')}
    </div>
    ${summaryBox(sum, asOf)}`;
}

// Principal + interest = total outstanding, shown under both tabs.
function summaryBox(sum, asOf) {
  const line = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`;
  const interestLines = sum.method === METHODS.KHATA
    ? line('Interest on sales', `+ ${money(sum.udharInterest)}`) + line('Interest on payments', `− ${money(sum.jamaInterest)}`)
    : line('Interest charged', `+ ${money(sum.interestAccrued)}`);
  return `
    <div class="summary-box">
      <h3>Full calculation (as of ${fmtDate(asOf)})</h3>
      <div class="summary-grid">
        <table><tbody>
          <tr class="head"><td colspan="2">Principal</td></tr>
          ${line('Total credit sales', `+ ${money(sum.totalUdhar)}`)}
          ${line('Total payments', `− ${money(sum.totalJama)}`)}
          ${line('Principal balance', money(sum.principalDue), 'subtotal')}
        </tbody></table>
        <table><tbody>
          <tr class="head"><td colspan="2">Interest</td></tr>
          ${interestLines}
          ${sum.interestPaid ? line('Interest paid', `− ${money(sum.interestPaid)}`) : ''}
          ${sum.interestWaived ? line('Interest waived', `− ${money(sum.interestWaived)}`) : ''}
          ${line('Interest due', money(sum.interestDue), 'subtotal')}
        </tbody></table>
      </div>
      <table class="summary-total"><tbody>
        ${line(`Total outstanding = principal ${money(sum.principalDue)} + interest ${money(sum.interestDue)}`, money(sum.totalDue), 'grand')}
      </tbody></table>
    </div>`;
}

function pageSettings() {
  const s = db.settings;
  const owner = session.isOwner;
  const dis = owner ? '' : 'disabled';
  const local = owner ? db.localData() : null;
  const users = [...db.users].sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1) || a.username.localeCompare(b.username));
  app.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">${owner ? 'Pump details, interest rules, users and backup' : 'Only the owner can change these settings'}</div></div></div>

    ${local ? `
    <div class="panel highlight">
      <div class="panel-head"><h2>Data found in this browser</h2></div>
      <div class="panel-body">
        <p style="margin-top:0">This browser still has ${local.customers.length} customers and ${local.entries.length} entries from the earlier offline version. Upload them to the online database so they appear on every device.</p>
        <button class="btn primary" data-act="upload-local">Upload ${local.entries.length} entries</button>
      </div>
    </div>` : ''}

    <form class="panel" id="settings-form">
      <div class="panel-head"><h2>Pump and interest</h2></div>
      <div class="panel-body">
        <fieldset ${dis}>
        <div class="field"><label for="s-name">Petrol pump name</label><input id="s-name" name="pumpName" value="${esc(s.pumpName)}"></div>
        <div class="grid2">
          <div class="field"><label for="s-address">Address</label><input id="s-address" name="address" value="${esc(s.address)}"></div>
          <div class="field"><label for="s-phone">Phone</label><input id="s-phone" name="phone" value="${esc(s.phone)}"></div>
        </div>
        <div class="field"><label for="s-method">Interest method</label>
          <select id="s-method" name="interestMethod">
            <option value="${METHODS.KHATA}" ${s.interestMethod !== METHODS.FIFO ? 'selected' : ''}>Daily balance method: interest added on every sale, reduced on every payment</option>
            <option value="${METHODS.FIFO}" ${s.interestMethod === METHODS.FIFO ? 'selected' : ''}>Interest-free period: payments clear the oldest sale first, interest after the free days</option>
          </select></div>
        <div class="grid2">
          <div class="field"><label for="s-rate">Default interest rate (% per year)</label><input id="s-rate" name="ratePerYear" type="number" min="0" step="0.01" required value="${esc(s.ratePerYear)}">
            <div class="hint">Simple interest on a 365-day year. 24% per year = 2% per month.</div></div>
          <div class="field"><label for="s-grace">Overdue after (days)</label><input id="s-grace" name="graceDays" type="number" min="0" step="1" required value="${esc(s.graceDays)}">
            <div class="hint">Sales older than this are shown as overdue. In the interest-free method, no interest is charged for these days.</div></div>
        </div>
        ${owner ? '<button class="btn primary" type="submit">Save</button>' : ''}
        </fieldset>
      </div>
    </form>

    ${owner ? `
    <div class="panel">
      <div class="panel-head"><h2>Users</h2><button class="btn small primary" data-act="add-user">+ Add staff</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td>${esc(u.name)}</td><td>${esc(u.username)}</td>
          <td>${u.role === 'owner' ? '<span class="badge jama">Owner</span>' : 'Staff'}</td>
          <td>${u.active ? '<span class="text-ok">Active</span>' : '<span class="text-danger">Disabled</span>'}</td>
          <td class="num">${u.role === 'owner' ? '' : `<button class="btn small" data-user="${u.uid}" data-active="${u.active ? '0' : '1'}">${u.active ? 'Disable' : 'Enable'}</button>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="panel-body small muted">Staff can view customers, add credit sales and payments, and share statements. Only the owner can edit or delete entries, delete customers, change settings and manage users.
        If a staff member forgets their password, disable that login and add a new one.</div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-head"><h2>My account</h2></div>
      <div class="panel-body">
        <p style="margin-top:0">Signed in as <b>${esc(session.profile?.name)}</b> · username <b>${esc(session.username)}</b> · ${owner ? 'Owner' : 'Staff'}</p>
        <div class="actions"><button class="btn" data-act="change-password">Change password</button><button class="btn" data-act="sign-out">Sign out</button></div>
      </div>
    </div>

    ${owner ? `
    <div class="panel">
      <div class="panel-head"><h2>Backup</h2></div>
      <div class="panel-body">
        <p class="small muted" style="margin-top:0">Data is saved online and syncs to every signed-in device. As extra safety, download a backup once a month and keep it on Google Drive or a pen drive.</p>
        <div class="actions">
          <button class="btn primary" data-act="backup">Download backup (.json)</button>
          <label class="btn" style="margin:0;color:var(--text);font-size:inherit">Restore from backup<input type="file" id="restore" accept=".json,application/json" hidden></label>
          <button class="btn" data-act="csv">Export all entries to Excel (CSV)</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Erase data</h2></div>
      <div class="panel-body">
        <p class="small muted" style="margin-top:0">Permanently deletes every customer and entry for all users. Download a backup first. You will be asked twice, the second time with your password.</p>
        <div class="actions">
          <button class="btn danger" data-act="reset">Erase all data</button>
        </div>
      </div>
    </div>` : ''}`;

  const on = (act, fn) => { const el = app.querySelector(`[data-act=${act}]`); if (el) el.onclick = fn; };
  on('sign-out', () => signOutUser());
  on('change-password', passwordForm);
  if (!owner) return;

  document.getElementById('settings-form').onsubmit = (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target).entries());
    db.updateSettings({ ...d, ratePerYear: Number(d.ratePerYear), graceDays: Number(d.graceDays) });
    toast('Settings saved');
  };
  on('add-user', staffForm);
  app.querySelectorAll('[data-user]').forEach((b) => {
    b.onclick = () => {
      const u = db.users.find((x) => x.uid === b.dataset.user);
      const enable = b.dataset.active === '1';
      if (enable || confirm(`Disable the login "${u.username}"? They will be signed out and cannot sign in again until enabled.`)) {
        setUserActive(u.uid, enable);
        toast(enable ? 'Login enabled' : 'Login disabled');
      }
    };
  });
  on('upload-local', async () => {
    toast('Uploading…', 10000);
    try {
      const n = await db.uploadLocalData();
      toast(`${n} entries uploaded`);
      render();
    } catch (err) {
      alert(`Upload failed: ${err.message}. Please check the internet connection and try again.`);
    }
  });
  on('backup', () => download(`petrol-pump-backup-${today()}.json`, db.exportJson(), 'application/json'));
  on('csv', exportCsv);
  on('reset', () => confirmWithPassword({
    title: 'Erase all data',
    warning: `All ${db.customers.length} customers and ${db.entries.length} entries will be permanently deleted for every user. Have you downloaded a backup?`,
    action: async () => {
      toast('Erasing…', 10000);
      try { await db.reset(); toast('All data erased'); } catch (err) { alert(`Could not erase: ${err.message}`); }
    },
  }));
  document.getElementById('restore').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const text = await file.text();
    ev.target.value = '';
    confirmWithPassword({
      title: 'Restore from backup',
      warning: 'All current data (for every user) will be deleted and replaced with the backup. Continue?',
      action: async () => {
        toast('Restoring… keep this page open', 20000);
        try {
          await db.importJson(text);
          toast('Data restored from backup');
        } catch (err) {
          alert(`Could not restore the backup: ${err.message}`);
        }
      },
    });
  };
}

// Deleting data needs two confirmations: a yes/no question, then the owner's
// password plus typing DELETE.
function confirmWithPassword({ title, warning, action }) {
  if (!confirm(`${warning}\n\nStep 1 of 2: click OK to continue.`)) return;
  let busy = false;
  openModal({
    title: `${title} – step 2 of 2`,
    submitLabel: 'Delete permanently',
    body: `
      <p style="margin-top:0" class="text-danger"><b>${esc(warning)}</b></p>
      <div class="field"><label for="cp-pass">Your password</label><input id="cp-pass" name="password" type="password" required autocomplete="current-password"></div>
      <div class="field"><label for="cp-word">Type <b>DELETE</b> to confirm</label><input id="cp-word" name="word" required autocomplete="off" autocapitalize="characters"></div>
      <p class="text-danger small" id="cp-error" role="alert"></p>`,
    onOpen(form) { form.querySelector('#modal-submit').classList.add('danger'); },
    onSubmit(d, form) {
      const err = form.querySelector('#cp-error');
      if (d.word.trim() !== 'DELETE') { err.textContent = 'Please type DELETE in capital letters.'; return false; }
      if (busy) return false;
      busy = true;
      err.textContent = 'Checking password…';
      verifyPassword(d.password)
        .then(() => { modal.close(); action(); })
        .catch((e) => {
          err.textContent = /wrong-password|invalid-credential/.test(e.code) ? 'Wrong password. Nothing was deleted.'
            : e.code === 'auth/network-request-failed' ? 'Needs internet to check the password. Nothing was deleted.'
              : e.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes.' : e.message;
        })
        .finally(() => { busy = false; });
      return false;
    },
  });
}

function staffForm() {
  openModal({
    title: 'Add staff login',
    submitLabel: 'Create login',
    body: `
      <div class="field"><label for="u-name">Name *</label><input id="u-name" name="name" required placeholder="e.g. Ramesh"></div>
      <div class="grid2">
        <div class="field"><label for="u-username">Username *</label><input id="u-username" name="username" required autocomplete="off" autocapitalize="none" placeholder="e.g. ramesh">
          <div class="hint">Small letters, numbers, dot, dash. At least 3 characters.</div></div>
        <div class="field"><label for="u-pass">Password *</label><input id="u-pass" name="password" required minlength="6" autocomplete="new-password">
          <div class="hint">At least 6 characters. Share it with the staff member.</div></div>
      </div>`,
    onSubmit(d) {
      const username = d.username.trim().toLowerCase();
      if (!usernameOk(username)) { alert('Username can use small letters, numbers, dot and dash (3 to 30 characters).'); return false; }
      createStaff({ name: d.name.trim(), username, password: d.password })
        .then(() => toast(`Login "${username}" created`))
        .catch((err) => alert(err.code === 'auth/email-already-in-use' ? `The username "${username}" is already taken.` : `Could not create the login: ${err.message}`));
    },
  });
}

function passwordForm() {
  openModal({
    title: 'Change password',
    submitLabel: 'Change password',
    body: `
      <div class="field"><label for="p-cur">Current password</label><input id="p-cur" name="current" type="password" required autocomplete="current-password"></div>
      <div class="grid2">
        <div class="field"><label for="p-new">New password</label><input id="p-new" name="next" type="password" required minlength="6" autocomplete="new-password"></div>
        <div class="field"><label for="p-new2">Repeat new password</label><input id="p-new2" name="next2" type="password" required minlength="6" autocomplete="new-password"></div>
      </div>`,
    onSubmit(d) {
      if (d.next !== d.next2) { alert('The new passwords do not match.'); return false; }
      changeMyPassword(d.current, d.next)
        .then(() => toast('Password changed'))
        .catch((err) => alert(/wrong-password|invalid-credential/.test(err.code) ? 'The current password is wrong.' : `Could not change the password: ${err.message}`));
    },
  });
}

function exportCsv() {
  const head = ['Date', 'Customer', 'Mobile', 'Type', 'Item', 'Litres', 'Rate', 'Amount', 'Vehicle', 'Bill No', 'Mode', 'Reference', 'Note', 'Entered by'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = sortEntries(db.entries).map((e) => {
    const c = db.customer(e.customerId) || {};
    return [fmtDate(e.date), c.name, c.mobile, typeLabel(e.type), e.fuel, e.qty, e.rate, e.amount, e.vehicle, e.billNo, e.mode, e.ref, e.note, e.by].map(cell).join(',');
  });
  download(`petrol-pump-entries-${today()}.csv`, '﻿' + [head.map(cell).join(','), ...lines].join('\r\n'), 'text/csv');
}

// ---------- sign in ----------

let authStatus = 'loading'; // loading | signedOut | noAccess | ready
let setupMode = false;

async function pageSignIn() {
  app.innerHTML = '<div class="auth-card"><p class="muted">Loading…</p></div>';
  const setupDone = await isSetupDone();
  if (authStatus !== 'signedOut') return;
  if (setupDone === false) { pageSetup(); return; }
  app.innerHTML = `
    <form class="auth-card" id="login-form">
      <div class="auth-logo" aria-hidden="true">⛽</div>
      <h1>Sign in</h1>
      <p class="muted small">Petrol Pump CRM</p>
      <div class="field"><label for="l-user">Username</label><input id="l-user" name="username" required autocomplete="username" autocapitalize="none" autofocus></div>
      <div class="field"><label for="l-pass">Password</label><input id="l-pass" name="password" type="password" required autocomplete="current-password"></div>
      <p class="text-danger small" id="l-error" role="alert"></p>
      <button class="btn primary block" type="submit">Sign in</button>
      ${setupDone === null ? '<p class="hint">No internet connection. Devices that signed in before can still open the app offline.</p>' : ''}
    </form>`;
  document.getElementById('login-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target).entries());
    const err = document.getElementById('l-error');
    const btn = ev.target.querySelector('button[type=submit]');
    err.textContent = '';
    btn.disabled = true;
    try {
      await signIn(d.username, d.password);
    } catch (e) {
      err.textContent = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(e.code) ? 'Wrong username or password.'
        : e.code === 'auth/network-request-failed' ? 'No internet connection.'
          : e.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes.' : e.message;
      btn.disabled = false;
    }
  };
}

function pageSetup() {
  app.innerHTML = `
    <form class="auth-card wide" id="setup-form">
      <div class="auth-logo" aria-hidden="true">⛽</div>
      <h1>First-time setup</h1>
      <p class="muted small">Create the owner login. Only the owner can add staff and change settings. This screen appears only once.</p>
      <div class="field"><label for="su-pump">Petrol pump name *</label><input id="su-pump" name="pumpName" required></div>
      <div class="field"><label for="su-name">Owner name *</label><input id="su-name" name="name" required></div>
      <div class="grid2">
        <div class="field"><label for="su-user">Owner username *</label><input id="su-user" name="username" required autocomplete="username" autocapitalize="none" placeholder="e.g. owner">
          <div class="hint">Small letters, numbers, dot, dash.</div></div>
        <div class="field"><label for="su-pass">Password *</label><input id="su-pass" name="password" type="password" required minlength="6" autocomplete="new-password">
          <div class="hint">At least 6 characters.</div></div>
      </div>
      <p class="text-danger small" id="su-error" role="alert"></p>
      <button class="btn primary block" type="submit">Create owner login</button>
    </form>`;
  document.getElementById('setup-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target).entries());
    const err = document.getElementById('su-error');
    const username = d.username.trim().toLowerCase();
    if (!usernameOk(username)) { err.textContent = 'Username can use small letters, numbers, dot and dash (3 to 30 characters).'; return; }
    ev.target.querySelector('button[type=submit]').disabled = true;
    setupMode = true;
    try {
      await createOwner({ pumpName: d.pumpName.trim(), name: d.name.trim(), username, password: d.password });
      toast('Owner login created');
    } catch (e) {
      err.textContent = e.code === 'auth/email-already-in-use' ? 'This username is already taken.' : `Setup failed: ${e.message}`;
      ev.target.querySelector('button[type=submit]').disabled = false;
    } finally {
      setupMode = false;
      render();
    }
  };
}

function pageNoAccess() {
  app.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo" aria-hidden="true">🔒</div>
      <h1>No access</h1>
      <p class="muted">This login is disabled or not set up. Please ask the owner.</p>
      <button class="btn block" id="na-out">Sign out</button>
    </div>`;
  document.getElementById('na-out').onclick = () => signOutUser();
}

// ---------- header, sync status and router ----------

function renderHeader() {
  const signedIn = authStatus === 'ready';
  document.querySelector('.topbar nav').hidden = !signedIn;
  const userBox = document.getElementById('user-box');
  userBox.hidden = !signedIn;
  if (signedIn) {
    const offline = !navigator.onLine;
    document.getElementById('sync-status').textContent = offline ? (sync.pending ? 'Offline · will sync' : 'Offline') : (sync.pending ? 'Syncing…' : '');
    document.getElementById('sync-status').className = `sync ${offline ? 'off' : ''}`;
    document.getElementById('user-name').textContent = session.profile?.name || session.username;
  }
  document.getElementById('pump-name').textContent = (signedIn && db.settings.pumpName) || 'Petrol Pump CRM';
  document.title = `${(signedIn && db.settings.pumpName) || 'Petrol Pump'} – CRM`;
}

function render() {
  renderHeader();
  if (authStatus === 'loading' || (authStatus === 'ready' && !sync.loaded)) {
    app.innerHTML = '<div class="auth-card"><p class="muted">Loading…</p></div>';
    return;
  }
  if (authStatus === 'signedOut') { if (!app.querySelector('#login-form, #setup-form')) pageSignIn(); return; }
  if (authStatus === 'noAccess') { if (!setupMode) pageNoAccess(); return; }

  const hash = location.hash || '#/';
  const [, page, id] = hash.split('/');
  const nav = page === 'customer' ? 'customers' : page || 'dashboard';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));

  if (page === 'customers') pageCustomers(document.getElementById('search')?.value || '');
  else if (page === 'customer') pageCustomer(id);
  else if (page === 'settings') pageSettings();
  else pageDashboard();
}

// Data from other devices arrives at any time. Don't redraw while someone is typing
// on the page; redraw once they leave the field.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const el = document.activeElement;
    if (modal.open || (el && app.contains(el) && el.matches('input, select, textarea'))) {
      renderHeader();
      app.addEventListener('focusout', () => setTimeout(scheduleRender, 0), { once: true });
      return;
    }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });
}
modal.addEventListener('close', () => scheduleRender());

let lastPage = null;
window.addEventListener('hashchange', () => {
  const page = location.hash.split('/')[1];
  if (page !== 'customer' || lastPage !== location.hash) { customerTab = 'ledger'; customerAsOf = null; }
  lastPage = location.hash;
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('online', renderHeader);
window.addEventListener('offline', renderHeader);

app.addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'new-customer') customerForm();
  const row = ev.target.closest('tr[data-href]');
  if (row && !ev.target.closest('a, button')) location.hash = row.dataset.href;
});
document.getElementById('sign-out').onclick = () => { if (confirm('Sign out?')) signOutUser(); };

setHandlers({ change: scheduleRender, error: (msg) => toast(msg, 6000) });
watchAuth((status) => {
  authStatus = status;
  render();
});
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline support unavailable', err));
}
