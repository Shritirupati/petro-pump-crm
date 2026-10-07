import { db, FUELS, PAY_MODES } from './store.js';
import { computeAccount, sortEntries, round2, TYPES, METHODS } from './interest.js';

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
function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('-') : '');

const TYPE_LABEL = {
  [TYPES.UDHAR]: 'Udhar',
  [TYPES.JAMA]: 'Jama',
  [TYPES.BYAAJ_JAMA]: 'Byaaj jama',
  [TYPES.BYAAJ_MAAF]: 'Byaaj maaf',
};

function termsFor(c) {
  const s = db.settings;
  return {
    ratePerMonth: c.ratePerMonth !== '' && c.ratePerMonth != null ? Number(c.ratePerMonth) : Number(s.ratePerMonth),
    graceDays: c.graceDays !== '' && c.graceDays != null ? Number(c.graceDays) : Number(s.graceDays),
    method: s.interestMethod || METHODS.KHATA,
  };
}

function summaryFor(c, asOf = today()) {
  return computeAccount(db.entriesFor(c.id), { ...termsFor(c), asOf });
}

function termsText(t) {
  return t.method === METHODS.FIFO
    ? `Byaaj ${t.ratePerMonth}% mahina · pehle ${t.graceDays} din free`
    : `Byaaj ${t.ratePerMonth}% mahina · CC khata tareeka`;
}

function ageBadge(days, grace) {
  if (!days) return '';
  const cls = days > grace + 60 ? 'danger' : days > grace ? 'warn' : '';
  return `<span class="badge ${cls}">${days} din</span>`;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

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
    title: c.id ? 'Customer badlein' : 'Naya customer',
    body: `
      <div class="field"><label for="f-name">Naam *</label><input id="f-name" name="name" required value="${esc(c.name)}" placeholder="Jaise: Ramesh Transport"></div>
      <div class="grid2">
        <div class="field"><label for="f-mobile">Mobile</label><input id="f-mobile" name="mobile" type="tel" inputmode="tel" value="${esc(c.mobile)}" placeholder="10 digit"></div>
        <div class="field"><label for="f-vehicle">Gaadi number(s)</label><input id="f-vehicle" name="vehicle" value="${esc(c.vehicle)}" placeholder="MP09 AB 1234"></div>
      </div>
      <div class="field"><label for="f-address">Pata</label><input id="f-address" name="address" value="${esc(c.address)}"></div>
      <div class="grid3">
        <div class="field"><label for="f-limit">Credit limit (₹)</label><input id="f-limit" name="creditLimit" type="number" min="0" step="1" value="${esc(c.creditLimit)}" placeholder="Koi limit nahi"></div>
        <div class="field"><label for="f-rate">Byaaj % / mahina</label><input id="f-rate" name="ratePerMonth" type="number" min="0" step="0.01" value="${esc(c.ratePerMonth)}" placeholder="${esc(s.ratePerMonth)} (default)"></div>
        <div class="field"><label for="f-grace">Overdue / free din</label><input id="f-grace" name="graceDays" type="number" min="0" step="1" value="${esc(c.graceDays)}" placeholder="${esc(s.graceDays)} (default)"></div>
      </div>
      <p class="hint">Byaaj ka rate aur din khaali chhodne par Settings wale default lagenge.</p>
      <div class="field"><label for="f-notes">Note</label><textarea id="f-notes" name="notes" rows="2">${esc(c.notes)}</textarea></div>`,
    onSubmit(d) {
      const id = db.upsertCustomer({ ...(c.id ? { id: c.id } : {}), ...d, name: d.name.trim() });
      toast('Customer save ho gaya');
      if (!c.id) location.hash = `#/customer/${id}`;
    },
  });
}

function udharForm(customer, entry = {}) {
  const s = db.settings;
  const fuel = entry.fuel || 'Diesel';
  openModal({
    title: `${entry.id ? 'Udhar badlein' : 'Udhar entry'} – ${customer.name}`,
    submitLabel: 'Udhar save karein',
    body: `
      <div class="grid2">
        <div class="field"><label for="u-date">Tareekh *</label><input id="u-date" name="date" type="date" required max="${today()}" value="${esc(entry.date || today())}"></div>
        <div class="field"><label for="u-fuel">Item</label><select id="u-fuel" name="fuel">${FUELS.map((f) => `<option ${f === fuel ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
      </div>
      <div class="grid3">
        <div class="field"><label for="u-qty">Litre</label><input id="u-qty" name="qty" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(entry.qty)}"></div>
        <div class="field"><label for="u-rate">Rate (₹/L)</label><input id="u-rate" name="rate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(entry.rate ?? (s.lastRates[fuel] || ''))}"></div>
        <div class="field"><label for="u-amount">Amount (₹) *</label><input id="u-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(entry.amount)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="u-vehicle">Gaadi number</label><input id="u-vehicle" name="vehicle" value="${esc(entry.vehicle ?? customer.vehicle ?? '')}"></div>
        <div class="field"><label for="u-bill">Bill / slip no.</label><input id="u-bill" name="billNo" value="${esc(entry.billNo)}"></div>
      </div>
      <div class="field"><label for="u-note">Note</label><input id="u-note" name="note" value="${esc(entry.note)}" placeholder="Jaise: Driver ka naam"></div>
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
        form.querySelector('#u-limit').textContent = `Credit limit ${money(limit)} · abhi udhar baaki ${money(due)} · bacha ${money(limit - due)}`;
      }
    },
    onSubmit(d) {
      const amount = round2(parseFloat(d.amount));
      if (!(amount > 0)) { alert('Amount sahi daalein'); return false; }
      const limit = Number(customer.creditLimit) || 0;
      if (limit && !entry.id) {
        const due = summaryFor(customer).principalDue;
        if (due + amount > limit && !confirm(`Is entry ke baad udhar ${money(due + amount)} ho jayega, jo credit limit ${money(limit)} se zyada hai. Phir bhi save karein?`)) return false;
      }
      const rec = { customerId: customer.id, type: TYPES.UDHAR, date: d.date, fuel: d.fuel, qty: d.qty, rate: d.rate, amount, vehicle: d.vehicle, billNo: d.billNo, note: d.note };
      if (parseFloat(d.rate) > 0) db.updateSettings({ lastRates: { ...s.lastRates, [d.fuel]: parseFloat(d.rate) } });
      if (entry.id) db.updateEntry({ ...rec, id: entry.id }); else db.addEntry(rec);
      toast(`Udhar ${money(amount)} save ho gaya`);
    },
  });
}

function jamaForm(customer, entry = {}) {
  const sum = summaryFor(customer);
  const type = entry.type || TYPES.JAMA;
  openModal({
    title: `${entry.id ? 'Entry badlein' : 'Jama / Payment'} – ${customer.name}`,
    submitLabel: 'Jama save karein',
    body: `
      <p class="small muted" style="margin-top:0">Abhi baaki: udhar <b>${money(sum.principalDue)}</b> · byaaj <b>${money(sum.interestDue)}</b></p>
      <div class="field"><label for="j-type">Kis cheez ka</label>
        <select id="j-type" name="type">
          <option value="${TYPES.JAMA}" ${type === TYPES.JAMA ? 'selected' : ''}>Udhar ka paisa jama (sabse purana udhar pehle katega)</option>
          <option value="${TYPES.BYAAJ_JAMA}" ${type === TYPES.BYAAJ_JAMA ? 'selected' : ''}>Byaaj ka paisa jama</option>
          <option value="${TYPES.BYAAJ_MAAF}" ${type === TYPES.BYAAJ_MAAF ? 'selected' : ''}>Byaaj maaf (discount)</option>
        </select></div>
      <div class="grid2">
        <div class="field"><label for="j-date">Tareekh *</label><input id="j-date" name="date" type="date" required max="${today()}" value="${esc(entry.date || today())}"></div>
        <div class="field"><label for="j-amount">Amount (₹) *</label><input id="j-amount" name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${esc(entry.amount)}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="j-mode">Mode</label><select id="j-mode" name="mode">${PAY_MODES.map((m) => `<option ${m === entry.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label for="j-ref">Reference / UTR</label><input id="j-ref" name="ref" value="${esc(entry.ref)}"></div>
      </div>
      <div class="field"><label for="j-note">Note</label><input id="j-note" name="note" value="${esc(entry.note)}"></div>`,
    onSubmit(d) {
      const amount = round2(parseFloat(d.amount));
      if (!(amount > 0)) { alert('Amount sahi daalein'); return false; }
      const rec = { customerId: customer.id, type: d.type, date: d.date, amount, mode: d.mode, ref: d.ref, note: d.note };
      if (entry.id) db.updateEntry({ ...rec, id: entry.id }); else db.addEntry(rec);
      toast(`${TYPE_LABEL[d.type]} ${money(amount)} save ho gaya`);
    },
  });
}

function editEntry(entry) {
  const c = db.customer(entry.customerId);
  if (entry.type === TYPES.UDHAR) udharForm(c, entry); else jamaForm(c, entry);
}

// ---------- pages ----------

function pageDashboard() {
  const asOf = today();
  const s = db.settings;
  const rows = db.customers.map((c) => ({ c, sum: summaryFor(c, asOf), terms: termsFor(c) }));
  const total = (k) => rows.reduce((a, r) => a + Math.max(0, r.sum[k]), 0);
  const monthStart = asOf.slice(0, 8) + '01';
  const thisMonth = db.entries.filter((e) => e.date >= monthStart && e.date <= asOf);
  const mUdhar = thisMonth.filter((e) => e.type === TYPES.UDHAR).reduce((a, e) => a + Number(e.amount), 0);
  const mJama = thisMonth.filter((e) => e.type === TYPES.JAMA || e.type === TYPES.BYAAJ_JAMA).reduce((a, e) => a + Number(e.amount), 0);
  const due = rows.filter((r) => r.sum.totalDue > 0.5).sort((a, b) => b.sum.totalDue - a.sum.totalDue);
  const overdue = due.filter((r) => r.sum.oldestPendingDays > r.terms.graceDays).length;
  const recent = sortEntries(db.entries).reverse().slice(0, 8);

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><div class="sub">Aaj ${fmtDate(asOf)} tak ka hisaab · ${esc(termsText(termsFor({})))}</div></div>
      <div class="actions">
        <button class="btn primary" data-act="new-customer">+ Naya customer</button>
      </div>
    </div>

    ${db.customers.length ? '' : `
      <div class="panel"><div class="empty">
        <p><b>Abhi koi customer nahi hai.</b></p>
        <p>Pehla customer jodiye, ya app dekhne ke liye demo data daaliye.</p>
        <div class="actions" style="justify-content:center">
          <button class="btn primary" data-act="new-customer">+ Pehla customer jodein</button>
          <button class="btn" data-act="demo">Demo data daalein</button>
        </div>
      </div></div>`}

    <div class="cards">
      <div class="card"><div class="label">Kul udhar baaki</div><div class="value">${money(total('principalDue'))}</div></div>
      <div class="card warn"><div class="label">Kul byaaj baaki</div><div class="value">${money(total('interestDue'))}</div></div>
      <div class="card danger"><div class="label">Kul lena hai</div><div class="value">${money(total('totalDue'))}</div></div>
      <div class="card"><div class="label">Customers · overdue</div><div class="value">${db.customers.length} · <span class="text-danger">${overdue}</span></div></div>
      <div class="card"><div class="label">Is mahine udhar diya</div><div class="value">${money(mUdhar)}</div></div>
      <div class="card ok"><div class="label">Is mahine vasooli</div><div class="value">${money(mJama)}</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Sabse zyada baaki</h2><a href="#/customers" class="small">Sab customers →</a></div>
      ${due.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Mobile</th><th class="num">Udhar</th><th class="num">Byaaj</th><th class="num">Kul</th><th>Sabse purana</th></tr></thead>
        <tbody>${due.slice(0, 10).map(({ c, sum, terms }) => `
          <tr class="clickable" data-href="#/customer/${c.id}">
            <td><b>${esc(c.name)}</b></td><td>${esc(c.mobile)}</td>
            <td class="num">${money(sum.principalDue)}</td><td class="num">${money(sum.interestDue)}</td>
            <td class="num"><b>${money(sum.totalDue)}</b></td><td>${ageBadge(sum.oldestPendingDays, terms.graceDays)}</td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Kisi ka kuch baaki nahi hai.</div>'}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Haal ki entries</h2></div>
      ${recent.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Tareekh</th><th>Customer</th><th>Entry</th><th>Vivran</th><th class="num">Amount</th></tr></thead>
        <tbody>${recent.map((e) => {
          const c = db.customer(e.customerId);
          return `<tr class="clickable" data-href="#/customer/${e.customerId}">
            <td>${fmtDate(e.date)}</td><td>${esc(c?.name)}</td><td><span class="badge ${e.type}">${TYPE_LABEL[e.type]}</span></td>
            <td class="muted">${esc(entryDetails(e))}</td><td class="num">${money(e.amount)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Abhi koi entry nahi.</div>'}
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
        <input type="search" class="search" id="search" placeholder="Naam, mobile ya gaadi no. se khojein" value="${esc(query)}">
        <button class="btn primary" data-act="new-customer">+ Naya customer</button>
      </div>
    </div>
    <div class="panel">
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Naam</th><th>Mobile</th><th>Gaadi</th><th class="num">Udhar baaki</th><th class="num">Byaaj</th><th class="num">Kul baaki</th><th>Sabse purana</th></tr></thead>
        <tbody>${list.map(({ c, sum, terms }) => {
          const over = Number(c.creditLimit) > 0 && sum.principalDue > Number(c.creditLimit);
          return `<tr class="clickable" data-href="#/customer/${c.id}">
            <td><b>${esc(c.name)}</b>${over ? ' <span class="badge danger">Limit paar</span>' : ''}</td>
            <td>${esc(c.mobile)}</td><td>${esc(c.vehicle)}</td>
            <td class="num">${money(sum.principalDue)}</td><td class="num">${money(sum.interestDue)}</td>
            <td class="num"><b class="${sum.totalDue > 0.5 ? 'text-danger' : ''}">${money(sum.totalDue)}</b></td>
            <td>${ageBadge(sum.oldestPendingDays, terms.graceDays)}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td colspan="3">Kul</td><td class="num">${money(sumOf('principalDue'))}</td><td class="num">${money(sumOf('interestDue'))}</td><td class="num">${money(sumOf('totalDue'))}</td><td></td></tr></tfoot>
        </table></div>` : `<div class="empty">${q ? 'Koi customer nahi mila.' : 'Abhi koi customer nahi. "+ Naya customer" dabaiye.'}</div>`}
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

function entryDetails(e) {
  if (e.type === TYPES.UDHAR) {
    return [e.fuel, e.qty ? `${e.qty} L` : '', e.rate ? `@ ₹${e.rate}` : '', e.vehicle, e.billNo ? `Bill ${e.billNo}` : '', e.note].filter(Boolean).join(' · ');
  }
  return [e.mode, e.ref, e.note].filter(Boolean).join(' · ');
}

let customerTab = 'ledger';
let customerAsOf = null;

function pageCustomer(id) {
  const c = db.customer(id);
  if (!c) { app.innerHTML = '<div class="panel"><div class="empty">Customer nahi mila. <a href="#/customers">Wapas jayein</a></div></div>'; return; }
  const s = db.settings;
  const asOf = customerAsOf || today();
  const terms = termsFor(c);
  const sum = computeAccount(db.entriesFor(c.id), { ...terms, asOf });
  const entries = sortEntries(db.entriesFor(c.id).filter((e) => e.date <= asOf));
  const limit = Number(c.creditLimit) || 0;

  const rowInterest = interestByEntry(sum);
  let bal = 0;
  const ledgerRows = entries.map((e) => {
    if (e.type === TYPES.UDHAR) bal += Number(e.amount);
    if (e.type === TYPES.JAMA) bal -= Number(e.amount);
    const isDebit = e.type === TYPES.UDHAR;
    const ri = rowInterest.get(e.id);
    return `<tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="badge ${e.type}">${TYPE_LABEL[e.type]}</span></td>
      <td class="muted">${esc(entryDetails(e))}</td>
      <td class="num text-danger">${isDebit ? money(e.amount) : ''}</td>
      <td class="num text-ok">${!isDebit ? money(e.amount) : ''}</td>
      <td class="num"><b>${money(bal)}</b></td>
      <td class="num muted">${ri?.days ?? ''}</td>
      <td class="num ${ri && ri.value < 0 ? 'text-ok' : 'text-danger'}">${ri && ri.value ? (ri.value < 0 ? '− ' : '+ ') + money(Math.abs(ri.value)) : ''}</td>
      <td class="no-print"><button class="icon-btn" title="Badlein" data-edit="${e.id}">✎</button><button class="icon-btn" title="Delete" data-del="${e.id}">🗑</button></td>
    </tr>`;
  }).join('');

  const lotRows = (sum.lots || []).map((l) => {
    const paid = l.payments.map((p) => `${fmtDate(p.date)}: ${money(p.amount)}${p.fromAdvance ? ' (advance se)' : ` · ${p.days} din ka byaaj ${money(p.interest)}`}`).join('<br>');
    return `<tr>
      <td>${fmtDate(l.date)}</td><td class="num">${money(l.amount)}</td>
      <td class="small">${paid || '<span class="muted">—</span>'}</td>
      <td class="num">${l.remaining ? money(l.remaining) : '<span class="text-ok">Chuka diya</span>'}</td>
      <td class="num">${l.remaining ? `${l.pendingDays} din` : ''}</td>
      <td class="num"><b>${money(l.interest)}</b></td></tr>`;
  }).join('');

  const waText = `Namaste ${c.name} ji,\n${s.pumpName} se yaad dilana tha ki ${fmtDate(asOf)} tak aapka hisaab:\nUdhar baaki: ${money(sum.principalDue)}\nByaaj: ${money(sum.interestDue)}\nKul baaki: ${money(sum.totalDue)}\nKripya jald bhugtaan karein. Dhanyavaad.${s.phone ? `\nSampark: ${s.phone}` : ''}`;
  const wa = waNumber(c.mobile);

  app.innerHTML = `
    <div class="print-only" style="margin-bottom:12px">
      <h1>${esc(s.pumpName)}</h1>
      <div>${esc(s.address)} ${s.phone ? `· ${esc(s.phone)}` : ''}</div>
      <h2 style="margin-top:10px">Customer statement – ${fmtDate(asOf)} tak</h2>
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
        <button class="btn udhar" data-act="udhar">+ Udhar</button>
        <button class="btn jama" data-act="jama">+ Jama</button>
        ${wa ? `<a class="btn" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(waText)}">WhatsApp reminder</a>` : ''}
        <button class="btn" data-act="print">Print</button>
        <button class="btn" data-act="edit-customer">Edit</button>
        <button class="btn ghost text-danger" data-act="delete-customer">Delete</button>
      </div>
    </div>

    <div class="cards">
      <div class="card"><div class="label">Mool baaki (udhar − jama)</div><div class="value">${money(sum.principalDue)}</div>${sum.advance ? `<div class="small text-ok">Advance ${money(sum.advance)}</div>` : ''}</div>
      <div class="card warn"><div class="label">Byaaj baaki</div><div class="value">${money(sum.interestDue)}</div>${sum.interestPaid || sum.interestWaived ? `<div class="small muted">Bana ${money(sum.interestAccrued)} · jama ${money(sum.interestPaid)} · maaf ${money(sum.interestWaived)}</div>` : ''}</div>
      <div class="card danger"><div class="label">Kul baaki</div><div class="value">${money(sum.totalDue)}</div></div>
      <div class="card"><div class="label">Sabse purana baaki udhar</div><div class="value">${sum.oldestPendingDate ? `${sum.oldestPendingDays} din` : '—'}</div>${sum.oldestPendingDate ? `<div class="small muted">${fmtDate(sum.oldestPendingDate)} se</div>` : ''}</div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="tabs no-print">
          <button data-tab="ledger" class="${customerTab === 'ledger' ? 'active' : ''}">Khata (ledger)</button>
          <button data-tab="interest" class="${customerTab === 'interest' ? 'active' : ''}">Byaaj ka hisaab</button>
        </div>
        <div class="no-print" style="display:flex;align-items:center;gap:8px">
          <label for="asof" style="margin:0">Hisaab kis tareekh tak</label>
          <input type="date" id="asof" value="${asOf}" style="width:auto">
        </div>
      </div>
      ${customerTab === 'ledger' ? (entries.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Tareekh</th><th>Entry</th><th>Vivran</th><th class="num">Udhar (+)</th><th class="num">Jama (−)</th><th class="num">Mool baaki</th><th class="num">Din</th><th class="num">Byaaj</th><th class="no-print"></th></tr></thead>
        <tbody>${ledgerRows}</tbody>
        <tfoot><tr><td colspan="3">Kul</td><td class="num">${money(sum.totalUdhar)}</td><td class="num">${money(sum.totalJama)}</td><td class="num">${money(sum.principalDue)}</td><td></td><td class="num">${money(sum.interestDue)}</td><td class="no-print"></td></tr></tfoot>
        </table></div>
        ${summaryBox(sum, asOf)}` : '<div class="empty">Abhi koi entry nahi. "+ Udhar" ya "+ Jama" dabaiye.</div>')
      : sum.method === METHODS.KHATA ? khataHtml(sum, terms, asOf)
      : (sum.lots.length ? `<div class="panel-body small muted">Har udhar par ${esc(terms.graceDays)} din ke baad ${esc(terms.ratePerMonth)}% mahina (simple) byaaj lagta hai. Jama paisa sabse purane udhar mein adjust hota hai, aur jitna hissa chukaya gaya uska byaaj usi din ruk jaata hai.</div>
        <div class="table-wrap"><table>
        <thead><tr><th>Udhar tareekh</th><th class="num">Udhar</th><th>Kab-kab chukaya</th><th class="num">Baaki</th><th class="num">Byaaj wale din</th><th class="num">Byaaj</th></tr></thead>
        <tbody>${lotRows}</tbody>
        <tfoot>
          <tr><td colspan="5">Kul byaaj bana</td><td class="num">${money(sum.interestAccrued)}</td></tr>
          ${sum.interestPaid ? `<tr><td colspan="5">Byaaj jama</td><td class="num">− ${money(sum.interestPaid)}</td></tr>` : ''}
          ${sum.interestWaived ? `<tr><td colspan="5">Byaaj maaf</td><td class="num">− ${money(sum.interestWaived)}</td></tr>` : ''}
          <tr><td colspan="5">Byaaj baaki</td><td class="num">${money(sum.interestDue)}</td></tr>
        </tfoot></table></div>
        ${summaryBox(sum, asOf)}` : '<div class="empty">Koi udhar nahi.</div>')}
    </div>
    ${c.notes ? `<div class="panel"><div class="panel-body"><b>Note:</b> ${esc(c.notes)}</div></div>` : ''}`;

  app.querySelector('[data-act=udhar]').onclick = () => udharForm(c);
  app.querySelector('[data-act=jama]').onclick = () => jamaForm(c);
  app.querySelector('[data-act=print]').onclick = () => window.print();
  app.querySelector('[data-act=edit-customer]').onclick = () => customerForm(c);
  app.querySelector('[data-act=delete-customer]').onclick = () => {
    if (confirm(`"${c.name}" aur unki saari ${db.entriesFor(c.id).length} entries delete ho jayengi. Pakka?`)) {
      db.deleteCustomer(c.id);
      toast('Customer delete ho gaya');
      location.hash = '#/customers';
    }
  };
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { customerTab = b.dataset.tab; render(); }; });
  app.querySelector('#asof').onchange = (ev) => { customerAsOf = ev.target.value || null; render(); };
  app.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => editEntry(db.entries.find((e) => e.id === b.dataset.edit)); });
  app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const e = db.entries.find((x) => x.id === b.dataset.del);
      if (confirm(`${fmtDate(e.date)} ki ${TYPE_LABEL[e.type]} entry (${money(e.amount)}) delete karein?`)) {
        db.deleteEntry(e.id);
        toast('Entry delete ho gayi');
        render();
      }
    };
  });
}

function khataHtml(sum, terms, asOf) {
  if (!sum.udharRows.length && !sum.jamaRows.length) return '<div class="empty">Abhi koi entry nahi.</div>';
  const rate = terms.ratePerMonth;
  const table = (title, cls, rows, total, interest, empty) => `
    <div class="khata-col">
      <h3 class="${cls}">${title}</h3>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Tareekh</th><th class="vivran">Vivran</th><th class="num">Amount</th><th class="num">Din</th><th class="num">Byaaj</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${fmtDate(r.date)}</td><td class="muted small vivran">${esc(entryDetails(r.entry))}</td><td class="num">${money(r.amount)}</td><td class="num">${r.days}</td><td class="num">${money(r.interest)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Kul</td><td class="vivran"></td><td class="num">${money(total)}</td><td></td><td class="num">${money(interest)}</td></tr></tfoot>
      </table></div>` : `<div class="empty">${empty}</div>`}
    </div>`;
  return `
    <div class="panel-body small muted">Bank CC ki tarah: har udhar par uski tareekh se ${fmtDate(asOf)} tak byaaj judta hai, aur har jama par uski tareekh se ${fmtDate(asOf)} tak byaaj ghatta hai.
      Byaaj = amount × ${esc(rate)}% ÷ 30 × din.</div>
    <div class="khata-grid">
      ${table('Udhar (naam) aur uska byaaj', 'text-danger', sum.udharRows, sum.totalUdhar, sum.udharInterest, 'Koi udhar nahi')}
      ${table('Jama aur uska byaaj', 'text-ok', sum.jamaRows, sum.totalJama, sum.jamaInterest, 'Koi jama nahi')}
    </div>
    ${summaryBox(sum, asOf)}`;
}

// Per-entry interest for the ledger: + on udhar, − on jama / byaaj jama / maaf.
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

// Mool (principal) + byaaj = kul baaki, shown under both tabs.
function summaryBox(sum, asOf) {
  const line = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${value}</td></tr>`;
  const interestLines = sum.method === METHODS.KHATA
    ? line('Udhar par byaaj', `+ ${money(sum.udharInterest)}`) + line('Jama par byaaj', `− ${money(sum.jamaInterest)}`)
    : line('Kul byaaj bana', `+ ${money(sum.interestAccrued)}`);
  return `
    <div class="summary-box">
      <h3>Poora hisaab (${fmtDate(asOf)} tak)</h3>
      <div class="summary-grid">
        <table><tbody>
          <tr class="head"><td colspan="2">Mool amount (asal)</td></tr>
          ${line('Kul udhar', `+ ${money(sum.totalUdhar)}`)}
          ${line('Kul jama', `− ${money(sum.totalJama)}`)}
          ${line('Mool baaki', money(sum.principalDue), 'subtotal')}
        </tbody></table>
        <table><tbody>
          <tr class="head"><td colspan="2">Byaaj</td></tr>
          ${interestLines}
          ${sum.interestPaid ? line('Byaaj ka paisa jama', `− ${money(sum.interestPaid)}`) : ''}
          ${sum.interestWaived ? line('Byaaj maaf', `− ${money(sum.interestWaived)}`) : ''}
          ${line('Byaaj baaki', money(sum.interestDue), 'subtotal')}
        </tbody></table>
      </div>
      <table class="summary-total"><tbody>
        ${line(`Kul baaki = mool ${money(sum.principalDue)} + byaaj ${money(sum.interestDue)}`, money(sum.totalDue), 'grand')}
      </tbody></table>
    </div>`;
}

function pageSettings() {
  const s = db.settings;
  app.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Pump ki jaankari, byaaj ke niyam aur backup</div></div></div>

    <form class="panel" id="settings-form">
      <div class="panel-head"><h2>Pump aur byaaj</h2></div>
      <div class="panel-body">
        <div class="field"><label for="s-name">Petrol pump ka naam</label><input id="s-name" name="pumpName" value="${esc(s.pumpName)}"></div>
        <div class="grid2">
          <div class="field"><label for="s-address">Pata</label><input id="s-address" name="address" value="${esc(s.address)}"></div>
          <div class="field"><label for="s-phone">Phone</label><input id="s-phone" name="phone" value="${esc(s.phone)}"></div>
        </div>
        <div class="field"><label for="s-method">Byaaj ka tareeka</label>
          <select id="s-method" name="interestMethod">
            <option value="${METHODS.KHATA}" ${s.interestMethod !== METHODS.FIFO ? 'selected' : ''}>Bank CC / khata jaisa: har udhar par byaaj judta hai, har jama par byaaj ghatta hai</option>
            <option value="${METHODS.FIFO}" ${s.interestMethod === METHODS.FIFO ? 'selected' : ''}>Free din ke baad: jama purane udhar mein katta hai, free din ke baad byaaj</option>
          </select></div>
        <div class="grid2">
          <div class="field"><label for="s-rate">Default byaaj (% per mahina)</label><input id="s-rate" name="ratePerMonth" type="number" min="0" step="0.01" required value="${esc(s.ratePerMonth)}">
            <div class="hint">2% mahina = 24% saal. Simple interest, 1 mahina = 30 din.</div></div>
          <div class="field"><label for="s-grace">Overdue / free din</label><input id="s-grace" name="graceDays" type="number" min="0" step="1" required value="${esc(s.graceDays)}">
            <div class="hint">Itne din se purana udhar "overdue" dikhega. Doosre tareeke mein itne din byaaj nahi lagta.</div></div>
        </div>
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>

    <div class="panel">
      <div class="panel-head"><h2>Backup</h2></div>
      <div class="panel-body">
        <p class="small muted" style="margin-top:0">Saara data isi computer/phone ke browser mein save hota hai. Browser ka data clear karne par sab mit jayega, isliye <b>roz ya hafte mein ek baar backup download karein</b> aur Google Drive ya pen drive mein rakhein.</p>
        <div class="actions">
          <button class="btn primary" data-act="backup">Backup download (.json)</button>
          <label class="btn" style="margin:0;color:var(--text);font-size:inherit">Backup se wapas laayein<input type="file" id="restore" accept=".json,application/json" hidden></label>
          <button class="btn" data-act="csv">Saari entries Excel (CSV) mein</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Demo / Reset</h2></div>
      <div class="panel-body actions">
        <button class="btn" data-act="demo">Demo data daalein</button>
        <button class="btn danger" data-act="reset">Saara data mitayein</button>
      </div>
    </div>`;

  document.getElementById('settings-form').onsubmit = (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target).entries());
    db.updateSettings({ ...d, ratePerMonth: Number(d.ratePerMonth), graceDays: Number(d.graceDays) });
    toast('Settings save ho gayi');
    render();
  };
  app.querySelector('[data-act=backup]').onclick = () => download(`petrol-pump-backup-${today()}.json`, db.exportJson(), 'application/json');
  app.querySelector('[data-act=csv]').onclick = exportCsv;
  app.querySelector('[data-act=reset]').onclick = () => {
    if (confirm('Saare customers aur entries hamesha ke liye mit jayenge. Pehle backup le liya hai?') && confirm('Pakka? Ye wapas nahi hoga.')) {
      db.reset();
      toast('Data mita diya');
      render();
    }
  };
  document.getElementById('restore').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (!confirm('Abhi ka data hata kar backup wala data aa jayega. Aage badhein?')) return;
    try {
      db.importJson(await file.text());
      toast('Backup se data wapas aa gaya');
      render();
    } catch (err) {
      alert(`Backup nahi khul paya: ${err.message}`);
    }
  };
}

function exportCsv() {
  const head = ['Date', 'Customer', 'Mobile', 'Type', 'Item', 'Litre', 'Rate', 'Amount', 'Vehicle', 'Bill No', 'Mode', 'Reference', 'Note'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = sortEntries(db.entries).map((e) => {
    const c = db.customer(e.customerId) || {};
    return [fmtDate(e.date), c.name, c.mobile, TYPE_LABEL[e.type], e.fuel, e.qty, e.rate, e.amount, e.vehicle, e.billNo, e.mode, e.ref, e.note].map(cell).join(',');
  });
  download(`petrol-pump-entries-${today()}.csv`, '\ufeff' + [head.map(cell).join(','), ...lines].join('\r\n'), 'text/csv');
}

function loadDemo() {
  if (db.customers.length && !confirm('Demo data abhi ke data ke saath jud jayega. Aage badhein?')) return;
  const t = today();
  const d = (n) => shiftDate(t, -n);
  const demo = [
    { name: 'Sharma Transport', mobile: '9876543210', vehicle: 'MP09 HG 4521, MP09 HG 4522', address: 'Transport Nagar', creditLimit: 150000,
      entries: [['udhar', 120, 'Diesel', 400, 87.6], ['udhar', 95, 'Diesel', 350, 87.6], ['jama', 70, 30000], ['udhar', 40, 'Diesel', 500, 88.1], ['udhar', 10, 'Diesel', 200, 88.1]] },
    { name: 'Ramesh Kumar (Tractor)', mobile: '9123456780', vehicle: 'MP13 T 7788', address: 'Gram Palasia',
      entries: [['udhar', 75, 'Diesel', 60, 87.6], ['udhar', 50, 'Diesel', 45, 88.1], ['jama', 20, 3000]] },
    { name: 'Gupta Kirana Store', mobile: '9988776655', vehicle: 'MP09 ZX 1010', ratePerMonth: 1.5,
      entries: [['udhar', 25, 'Petrol', 20, 106.4], ['udhar', 12, 'Petrol', 15, 106.4]] },
    { name: 'City School Bus', mobile: '9000011111', vehicle: 'MP09 PA 2020', graceDays: 15,
      entries: [['udhar', 65, 'Diesel', 150, 87.6], ['jama', 30, 13140], ['byaaj_jama', 30, 175], ['udhar', 8, 'Diesel', 120, 88.1]] },
  ];
  const partyA = db.upsertCustomer({ name: 'Party A', mobile: '9811122233', vehicle: 'MP09 AA 0001' });
  db.addEntry({ customerId: partyA, type: 'udhar', date: '2026-09-07', fuel: 'Engine Oil', amount: 50000, note: 'Oil' });
  db.addEntry({ customerId: partyA, type: 'jama', date: '2026-09-17', amount: 5000, mode: 'Cash' });
  for (const { entries, ...c } of demo) {
    const id = db.upsertCustomer(c);
    for (const [type, ago, a, b, cc] of entries) {
      if (type === 'udhar') db.addEntry({ customerId: id, type, date: d(ago), fuel: a, qty: b, rate: cc, amount: round2(b * cc), vehicle: c.vehicle.split(',')[0] });
      else db.addEntry({ customerId: id, type, date: d(ago), amount: a, mode: 'Cash' });
    }
  }
  toast('Demo data daal diya');
  render();
}

// ---------- router ----------

function render() {
  const hash = location.hash || '#/';
  const [, page, id] = hash.split('/');
  document.getElementById('pump-name').textContent = db.settings.pumpName || 'Petrol Pump CRM';
  document.title = `${db.settings.pumpName || 'Petrol Pump'} – CRM`;
  const nav = page === 'customer' ? 'customers' : page || 'dashboard';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));

  if (page === 'customers') pageCustomers(document.getElementById('search')?.value || '');
  else if (page === 'customer') pageCustomer(id);
  else if (page === 'settings') pageSettings();
  else pageDashboard();
}

let lastPage = null;
window.addEventListener('hashchange', () => {
  const page = location.hash.split('/')[1];
  if (page !== 'customer' || lastPage !== location.hash) { customerTab = 'ledger'; customerAsOf = null; }
  lastPage = location.hash;
  render();
  window.scrollTo(0, 0);
});

app.addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'new-customer') customerForm();
  else if (act === 'demo') loadDemo();
  const row = ev.target.closest('tr[data-href]');
  if (row && !ev.target.closest('a, button')) location.hash = row.dataset.href;
});

render();
