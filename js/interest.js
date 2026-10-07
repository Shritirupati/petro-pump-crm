// Interest (byaaj) calculation for one customer's ledger.
//
// Rules:
// - Simple interest, rate given as % per month (1 month = 30 days).
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

export function computeLedger(entries, { ratePerMonth, graceDays, asOf }) {
  const dailyRate = (Number(ratePerMonth) || 0) / 100 / 30;
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
