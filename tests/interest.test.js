import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLedger, computeKhata, computeAccount, monthlyBreakdown, daysBetween } from '../public/js/interest.js';

const opts = (asOf, extra = {}) => ({ ratePerYear: 24, graceDays: 30, asOf, ...extra });
let n = 0;
const udhar = (date, amount) => ({ id: `e${++n}`, type: 'udhar', date, amount, createdAt: n });
const jama = (date, amount) => ({ id: `e${++n}`, type: 'jama', date, amount, createdAt: n });

test('daysBetween handles month and leap-year boundaries', () => {
  assert.equal(daysBetween('2026-01-31', '2026-03-01'), 29);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
});

test('no interest inside the grace period', () => {
  const r = computeLedger([udhar('2026-01-01', 10000)], opts('2026-01-31'));
  assert.equal(r.interestDue, 0);
  assert.equal(r.principalDue, 10000);
});

test('simple interest after the grace period', () => {
  // 90 days old, 60 chargeable days at 24%/year => 10000 * 0.24/365 * 60 = 394.52
  const r = computeLedger([udhar('2026-01-01', 10000)], opts('2026-04-01'));
  assert.equal(r.interestDue, 394.52);
  assert.equal(r.totalDue, 10394.52);
  assert.equal(r.oldestPendingDays, 90);
});

test('payment settles oldest udhar first and stops its interest', () => {
  const entries = [
    udhar('2026-01-01', 5000),
    udhar('2026-02-01', 5000),
    jama('2026-03-02', 5000), // first udhar: 60 days, 30 chargeable => 98.63
  ];
  const r = computeLedger(entries, opts('2026-03-02'));
  assert.equal(r.lots[0].remaining, 0);
  assert.equal(r.lots[0].interest, 98.63);
  assert.equal(r.lots[1].remaining, 5000);
  assert.equal(r.lots[1].interest, 0); // 29 days, still in grace
  assert.equal(r.principalDue, 5000);
  assert.equal(r.interestDue, 98.63);
});

test('partial payment splits interest between paid and pending parts', () => {
  const entries = [udhar('2026-01-01', 10000), jama('2026-03-02', 4000)];
  // paid part: 4000 * 0.24/365 * 30 = 78.90; pending 6000 till 2026-04-01 (60 chargeable) = 236.71
  const r = computeLedger(entries, opts('2026-04-01'));
  assert.equal(r.interestAccrued, 315.62);
  assert.equal(r.principalDue, 6000);
});

test('interest payments and waivers reduce interest due only', () => {
  const entries = [
    udhar('2026-01-01', 10000),
    { id: 'p', type: 'byaaj_jama', date: '2026-04-01', amount: 294.52 },
    { id: 'w', type: 'byaaj_maaf', date: '2026-04-01', amount: 100 },
  ];
  const r = computeLedger(entries, opts('2026-04-01'));
  assert.equal(r.interestDue, 0);
  assert.equal(r.principalDue, 10000);
});

test('overpayment becomes advance and covers the next udhar without interest', () => {
  const entries = [udhar('2026-01-01', 1000), jama('2026-01-10', 3000), udhar('2026-02-01', 1500)];
  const r = computeLedger(entries, opts('2026-06-01'));
  assert.equal(r.principalDue, -500);
  assert.equal(r.advance, 500);
  assert.equal(r.interestDue, 0);
});

test('entries after asOf are ignored and per-customer rate applies', () => {
  const entries = [udhar('2026-01-01', 10000), udhar('2026-05-01', 999)];
  const r = computeLedger(entries, opts('2026-04-01', { ratePerYear: 36.5, graceDays: 0 }));
  // 90 days at 36.5%/year => 10000 * 0.365/365 * 90 = 900
  assert.equal(r.interestDue, 900);
  assert.equal(r.principalDue, 10000);
});

test('khata method: udhar interest minus jama interest (daily balance method)', () => {
  const entries = [udhar('2026-09-07', 50000), jama('2026-09-17', 5000)];
  const r = computeKhata(entries, { ratePerYear: 24, asOf: '2026-10-07' });
  // 24% a year: 50000 for 30 days = 986.30; 5000 for 20 days = 65.75
  assert.equal(r.udharRows[0].days, 30);
  assert.equal(r.udharInterest, 986.3);
  assert.equal(r.jamaRows[0].days, 20);
  assert.equal(r.jamaInterest, 65.75);
  assert.equal(r.interestDue, 920.55);
  assert.equal(r.principalDue, 45000);
  assert.equal(r.totalDue, 45920.55);
});

test('khata method equals daily interest on running balance', () => {
  const entries = [udhar('2026-01-01', 12000), jama('2026-01-21', 3000), udhar('2026-02-10', 6000), jama('2026-03-01', 9000)];
  const r = computeKhata(entries, { ratePerYear: 36, asOf: '2026-04-01' });
  // balances: 12000 x20d, 9000 x20d, 15000 x19d, 6000 x31d
  const expected = (12000 * 20 + 9000 * 20 + 15000 * 19 + 6000 * 31) * 0.36 / 365;
  assert.ok(Math.abs(r.interestDue - expected) < 0.02);
});

test('computeAccount picks the method and keeps byaaj jama / maaf', () => {
  const entries = [udhar('2026-01-01', 10000), { id: 'p', type: 'byaaj_jama', date: '2026-03-01', amount: 100 }];
  const k = computeAccount(entries, { method: 'khata', ratePerYear: 36.5, graceDays: 30, asOf: '2026-04-01' });
  assert.equal(k.interestAccrued, 900); // 90 days, no free days in khata method
  assert.equal(k.interestDue, 800);
  assert.equal(k.oldestPendingDays, 90);
  const f = computeAccount(entries, { method: 'fifo', ratePerYear: 36.5, graceDays: 30, asOf: '2026-04-01' });
  assert.equal(f.interestDue, 500);
});

test('monthly breakdown splits interest by calendar month', () => {
  // 36.5% a year => Rs 10 a day on Rs 10,000
  const entries = [udhar('2026-01-15', 10000), jama('2026-02-10', 4000)];
  const { months, account } = monthlyBreakdown(entries, { method: 'khata', ratePerYear: 36.5, graceDays: 0, asOf: '2026-03-10' });
  assert.deepEqual(months.map((m) => m.month), ['2026-01', '2026-02', '2026-03']);
  // Jan: 17 days x 10 = 170; Feb: 9 days x 10 + 19 days x 6 = 204; Mar: 9 days x 6 = 54
  assert.deepEqual(months.map((m) => m.interest), [170, 204, 54]);
  assert.equal(months.reduce((s, m) => s + m.interest, 0), account.interestAccrued);
  assert.deepEqual(months.map((m) => m.closingBalance), [10000, 6000, 6000]);
  assert.equal(months[1].sales, 0);
  assert.equal(months[1].payments, 4000);
  assert.equal(months[2].totalDue, account.totalDue);
});

test('monthly breakdown follows the interest-free method too', () => {
  const entries = [udhar('2026-01-01', 10000)];
  const { months, account } = monthlyBreakdown(entries, { method: 'fifo', ratePerYear: 36.5, graceDays: 30, asOf: '2026-03-01' });
  // 30 free days (01-01 to 30-01), then interest from 31-01: Jan 1 day, Feb 28 days
  assert.deepEqual(months.map((m) => m.interest), [10, 280, 0]);
  assert.equal(account.interestDue, 290);
});
