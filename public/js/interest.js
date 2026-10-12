// Interest (byaaj) calculation for one customer's ledger.
//
// Rules:
// - Simple interest, rate given as % per year (365-day year).
// - No interest for the first `graceDays` days after each udhar entry.
// - A jama (payment) settles the oldest pending udhar first (FIFO).
// - Interest on each part of an udhar runs until the day that part is paid
//   (or until `asOf` if it is still pending).
// - "byaaj_jama" (interest paid) and "byaaj_maaf" (interest waived) reduce the
//   interest due without touching the udhar principal.
// - Extra payment beyond all pending udhar becomes advance and is used up by
//   the next udhar on its own date (so no interest is charged on that part).

const DAY_MS = 86400000;

export const TYPES = {
  UDHAR: 'udhar',
  JAMA: 'jama',
  BYAAJ_JAMA: 'byaaj_jama',
  BYAAJ_MAAF: 'byaaj_maaf',
};

const TYPE_ORDER = { udhar: 0, jama: 1, byaaj_jama: 2, byaaj_maaf: 3 };

export function dayNumber(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function daysBetween(fromIso, toIso) {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const EPS = 0.005;

export function sortEntries(entries) {
  return entries.slice().sort((a, b) =>
    a.date.localeCompare(b.date) ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    (a.createdAt || 0) - (b.createdAt || 0));
}

export function computeLedger(entries, { ratePerYear, graceDays, asOf }) {
  const dailyRate = (Number(ratePerYear) || 0) / 100 / 365;
  const grace = Math.max(0, Number(graceDays) || 0);
  const chargeableDays = (from, to) => Math.max(0, daysBetween(from, to) - grace);

  const lots = [];
  let advance = 0;
  let interestPaid = 0;
  let interestWaived = 0;
  let totalUdhar = 0;
  let totalJama = 0;

  for (const e of sortEntries(entries.filter((x) => x.date <= asOf))) {
    const amount = Number(e.amount) || 0;
    if (e.type === TYPES.UDHAR) {
      totalUdhar += amount;
      const lot = { id: e.id, date: e.date, amount, remaining: amount, interest: 0, payments: [] };
      if (advance > EPS) {
        const used = Math.min(advance, amount);
        lot.remaining -= used;
        lot.payments.push({ date: e.date, amount: used, days: 0, interest: 0, fromAdvance: true });
        advance -= used;
      }
      lots.push(lot);
    } else if (e.type === TYPES.JAMA) {
      totalJama += amount;
      let left = amount;
      for (const lot of lots) {
        if (left <= EPS) break;
        if (lot.remaining <= EPS) continue;
        const used = Math.min(left, lot.remaining);
        const days = chargeableDays(lot.date, e.date);
        const interest = used * dailyRate * days;
        lot.interest += interest;
        lot.remaining -= used;
        lot.payments.push({ date: e.date, amount: used, days, interest });
        left -= used;
      }
      advance += Math.max(0, left);
    } else if (e.type === TYPES.BYAAJ_JAMA) {
      interestPaid += amount;
    } else if (e.type === TYPES.BYAAJ_MAAF) {
      interestWaived += amount;
    }
  }

  let principalDue = 0;
  let oldestPendingDate = null;
  for (const lot of lots) {
    lot.pendingDays = 0;
    lot.pendingInterest = 0;
    if (lot.remaining > EPS) {
      lot.pendingDays = chargeableDays(lot.date, asOf);
      lot.pendingInterest = lot.remaining * dailyRate * lot.pendingDays;
      lot.interest += lot.pendingInterest;
      principalDue += lot.remaining;
      if (!oldestPendingDate) oldestPendingDate = lot.date;
    } else {
      lot.remaining = 0;
    }
    lot.interest = round2(lot.interest);
    lot.remaining = round2(lot.remaining);
    lot.pendingInterest = round2(lot.pendingInterest);
    lot.ageDays = daysBetween(lot.date, asOf);
  }

  const interestAccrued = round2(lots.reduce((s, l) => s + l.interest, 0));
  const interestDue = round2(interestAccrued - interestPaid - interestWaived);
  principalDue = round2(principalDue - advance);

  return {
    lots,
    totalUdhar: round2(totalUdhar),
    totalJama: round2(totalJama),
    advance: round2(advance),
    principalDue,
    interestAccrued,
    interestPaid: round2(interestPaid),
    interestWaived: round2(interestWaived),
    interestDue,
    totalDue: round2(principalDue + interestDue),
    oldestPendingDate,
    oldestPendingDays: oldestPendingDate ? daysBetween(oldestPendingDate, asOf) : 0,
  };
}

// Daily balance method:
// every udhar earns interest from its own date until `asOf`, and every jama
// earns the customer interest from its own date until `asOf`. Net interest is
// udhar interest minus jama interest. Same result as daily interest on the
// running balance, but every entry's share is visible.
export function computeKhata(entries, { ratePerYear, asOf }) {
  const dailyRate = (Number(ratePerYear) || 0) / 100 / 365;
  const udharRows = [];
  const jamaRows = [];
  const byaajRows = [];

  for (const e of sortEntries(entries.filter((x) => x.date <= asOf))) {
    const amount = Number(e.amount) || 0;
    const days = daysBetween(e.date, asOf);
    const row = { entry: e, date: e.date, amount, days, interest: round2(amount * dailyRate * days) };
    if (e.type === TYPES.UDHAR) udharRows.push(row);
    else if (e.type === TYPES.JAMA) jamaRows.push(row);
    else byaajRows.push({ ...row, days: 0, interest: 0 });
  }

  const sum = (rows, k) => round2(rows.reduce((s, r) => s + r[k], 0));
  const totalUdhar = sum(udharRows, 'amount');
  const udharInterest = sum(udharRows, 'interest');
  const totalJama = sum(jamaRows, 'amount');
  const jamaInterest = sum(jamaRows, 'interest');
  const interestPaid = sum(byaajRows.filter((r) => r.entry.type === TYPES.BYAAJ_JAMA), 'amount');
  const interestWaived = sum(byaajRows.filter((r) => r.entry.type === TYPES.BYAAJ_MAAF), 'amount');
  const interestAccrued = round2(udharInterest - jamaInterest);
  const principalDue = round2(totalUdhar - totalJama);
  const interestDue = round2(interestAccrued - interestPaid - interestWaived);

  return {
    udharRows, jamaRows, byaajRows,
    totalUdhar, udharInterest, totalJama, jamaInterest,
    interestAccrued, interestPaid, interestWaived,
    principalDue, interestDue,
    totalDue: round2(principalDue + interestDue),
  };
}

export const METHODS = { KHATA: 'khata', FIFO: 'fifo' };

// One summary shape for the UI, whichever interest method is selected.
export function computeAccount(entries, { method = METHODS.KHATA, ratePerYear, graceDays, asOf }) {
  if (method === METHODS.FIFO) {
    return { method, ...computeLedger(entries, { ratePerYear, graceDays, asOf }) };
  }
  const khata = computeKhata(entries, { ratePerYear, asOf });
  const age = computeLedger(entries, { ratePerYear: 0, graceDays: 0, asOf });
  return {
    method: METHODS.KHATA,
    ...khata,
    advance: round2(Math.max(0, -khata.principalDue)),
    oldestPendingDate: age.oldestPendingDate,
    oldestPendingDays: age.oldestPendingDays,
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
};

// Month-by-month view of an account: sales, payments, balances and the
// interest that built up during each month (on the selected method), up to `asOf`.
// Monthly interest is adjusted by a few paise in the last month so the months
// add up exactly to the account's total interest.
export function monthlyBreakdown(entries, { method = METHODS.KHATA, ratePerYear, graceDays, asOf }) {
  const account = computeAccount(entries, { method, ratePerYear, graceDays, asOf });
  const dailyRate = (Number(ratePerYear) || 0) / 100 / 365;
  const end = dayNumber(asOf);

  // Interest-bearing amounts as [amount, fromDay, toDay): interest runs on `amount` for each day in range.
  const spans = [];
  if (account.method === METHODS.FIFO) {
    for (const lot of account.lots) {
      for (const p of lot.payments) {
        if (p.days > 0) spans.push([p.amount, dayNumber(p.date) - p.days, dayNumber(p.date)]);
      }
      if (lot.remaining > 0 && lot.pendingDays > 0) spans.push([lot.remaining, end - lot.pendingDays, end]);
    }
  } else {
    for (const r of account.udharRows) spans.push([r.amount, dayNumber(r.date), end]);
    for (const r of account.jamaRows) spans.push([-r.amount, dayNumber(r.date), end]);
  }

  const sorted = sortEntries(entries.filter((x) => x.date <= asOf));
  if (!sorted.length) return { account, months: [] };

  const months = [];
  let principal = 0;
  let interestDue = 0;
  for (let ym = sorted[0].date.slice(0, 7); ym <= asOf.slice(0, 7); ym = nextMonth(ym)) {
    const from = dayNumber(`${ym}-01`);
    const to = Math.min(dayNumber(`${nextMonth(ym)}-01`), end);
    const list = sorted.filter((e) => e.date.slice(0, 7) === ym);
    const total = (type) => round2(list.filter((e) => e.type === type).reduce((s, e) => s + (Number(e.amount) || 0), 0));
    const sales = total(TYPES.UDHAR);
    const payments = total(TYPES.JAMA);
    const interestPaid = total(TYPES.BYAAJ_JAMA);
    const interestWaived = total(TYPES.BYAAJ_MAAF);
    const interest = spans.reduce((s, [amount, a, b]) => s + amount * dailyRate * Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
    months.push({
      month: ym,
      entries: list,
      openingBalance: round2(principal),
      sales, payments, interestPaid, interestWaived,
      interest: round2(interest),
      closingBalance: round2(principal + sales - payments),
    });
    principal += sales - payments;
  }

  const diff = round2(account.interestAccrued - months.reduce((s, m) => s + m.interest, 0));
  if (diff) months[months.length - 1].interest = round2(months[months.length - 1].interest + diff);

  for (const m of months) {
    interestDue += m.interest - m.interestPaid - m.interestWaived;
    m.interestDue = round2(interestDue);
    m.totalDue = round2(m.closingBalance + m.interestDue);
  }
  return { account, months };
}
