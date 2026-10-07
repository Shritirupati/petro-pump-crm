import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLedger, computeKhata, computeAccount, daysBetween } from '../js/interest.js';

const opts = (asOf, extra = {}) => ({ ratePerMonth: 2, graceDays: 30, asOf, ...extra });
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
  // 90 days old, 60 chargeable days at 2%/month => 10000 * 0.02/30 * 60 = 400
  const r = computeLedger([udhar('2026-01-01', 10000)], opts('2026-04-01'));
  assert.equal(r.interestDue, 400);
  assert.equal(r.totalDue, 10400);
  assert.equal(r.oldestPendingDays, 90);
});

test('payment settles oldest udhar first and stops its interest', () => {
  const entries = [
    udhar('2026-01-01', 5000),
    udhar('2026-02-01', 5000),
    jama('2026-03-02', 5000), // first udhar: 60 days, 30 chargeable => 100
  ];
  const r = computeLedger(entries, opts('2026-03-02'));
  assert.equal(r.lots[0].remaining, 0);
  assert.equal(r.lots[0].interest, 100);
  assert.equal(r.lots[1].remaining, 5000);
  assert.equal(r.lots[1].interest, 0); // 29 days, still in grace
  assert.equal(r.principalDue, 5000);
  assert.equal(r.interestDue, 100);
});

test('partial payment splits interest between paid and pending parts', () => {
  const entries = [udhar('2026-01-01', 10000), jama('2026-03-02', 4000)];
  // paid part: 4000 * 0.02/30 * 30 = 80; pending 6000 till 2026-04-01 (60 chargeable) = 240
  const r = computeLedger(entries, opts('2026-04-01'));
  assert.equal(r.interestAccrued, 320);
  assert.equal(r.principalDue, 6000);
});

test('interest payments and waivers reduce interest due only', () => {
  const entries = [
    udhar('2026-01-01', 10000),
    { id: 'p', type: 'byaaj_jama', date: '2026-04-01', amount: 300 },
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
  const r = computeLedger(entries, opts('2026-04-01', { ratePerMonth: 3, graceDays: 0 }));
  // 90 days at 3%/month => 10000 * 0.03/30 * 90 = 900
  assert.equal(r.interestDue, 900);
  assert.equal(r.principalDue, 10000);
});

test('khata method: udhar interest minus jama interest (CC style)', () => {
  const entries = [udhar('2026-09-07', 50000), jama('2026-09-17', 5000)];
  const r = computeKhata(entries, { ratePerMonth: 2, asOf: '2026-10-07' });
  // 50000 for 30 days = 1000; 5000 for 20 days = 66.67
  assert.equal(r.udharRows[0].days, 30);
  assert.equal(r.udharInterest, 1000);
  assert.equal(r.jamaRows[0].days, 20);
  assert.equal(r.jamaInterest, 66.67);
  assert.equal(r.interestDue, 933.33);
  assert.equal(r.principalDue, 45000);
  assert.equal(r.totalDue, 45933.33);
});

test('khata method equals daily interest on running balance', () => {
  const entries = [udhar('2026-01-01', 12000), jama('2026-01-21', 3000), udhar('2026-02-10', 6000), jama('2026-03-01', 9000)];
  const r = computeKhata(entries, { ratePerMonth: 3, asOf: '2026-04-01' });
  // balances: 12000 x20d, 9000 x20d, 15000 x19d, 6000 x31d
  const expected = (12000 * 20 + 9000 * 20 + 15000 * 19 + 6000 * 31) * 0.03 / 30;
  assert.ok(Math.abs(r.interestDue - expected) < 0.02);
});

test('computeAccount picks the method and keeps byaaj jama / maaf', () => {
  const entries = [udhar('2026-01-01', 10000), { id: 'p', type: 'byaaj_jama', date: '2026-03-01', amount: 100 }];
  const k = computeAccount(entries, { method: 'khata', ratePerMonth: 2, graceDays: 30, asOf: '2026-04-01' });
  assert.equal(k.interestAccrued, 600); // 90 days, no free days in khata method
  assert.equal(k.interestDue, 500);
  assert.equal(k.oldestPendingDays, 90);
  const f = computeAccount(entries, { method: 'fifo', ratePerMonth: 2, graceDays: 30, asOf: '2026-04-01' });
  assert.equal(f.interestDue, 300);
});
