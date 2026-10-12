// All data lives in this browser's localStorage. Use Settings > Backup to
// download a copy regularly; clearing browser data deletes it.

const KEY = 'petro-pump-crm.v1';

export const FUELS = ['Petrol', 'Diesel', 'CNG', 'Engine Oil', 'Other'];
export const PAY_MODES = ['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Card'];

function defaults() {
  return {
    settings: {
      pumpName: 'My Petrol Pump',
      address: '',
      phone: '',
      interestMethod: 'khata',
      ratePerYear: 24,
      graceDays: 30,
      lastRates: { Petrol: 0, Diesel: 0, CNG: 0 },
    },
    customers: [],
    entries: [],
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.error('Could not read saved data', err);
  }
  return defaults();
}

// Older versions stored the interest rate as % per month; convert to % per year.
function monthlyToYearly(obj) {
  if (obj && obj.ratePerYear === undefined && obj.ratePerMonth !== undefined) {
    const { ratePerMonth, ...rest } = obj;
    const yearly = ratePerMonth === '' || ratePerMonth == null ? '' : Math.round(Number(ratePerMonth) * 12 * 100) / 100;
    return { ...rest, ratePerYear: yearly };
  }
  return obj;
}

function normalize(data) {
  const base = defaults();
  return {
    settings: { ...base.settings, ...monthlyToYearly(data.settings || {}) },
    customers: Array.isArray(data.customers) ? data.customers.map(monthlyToYearly) : [],
    entries: Array.isArray(data.entries) ? data.entries : [],
  };
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    alert('Could not save data. Please download a backup from Settings right away.');
    console.error(err);
    return false;
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  get settings() { return state.settings; },
  get customers() { return state.customers; },
  get entries() { return state.entries; },

  customer(id) { return state.customers.find((c) => c.id === id); },
  entriesFor(customerId) { return state.entries.filter((e) => e.customerId === customerId); },

  updateSettings(patch) { Object.assign(state.settings, patch); save(); },

  upsertCustomer(c) {
    const i = state.customers.findIndex((x) => x.id === c.id);
    if (i >= 0) state.customers[i] = { ...state.customers[i], ...c };
    else state.customers.push({ ...c, id: uid(), createdAt: Date.now() });
    save();
    return i >= 0 ? c.id : state.customers[state.customers.length - 1].id;
  },

  deleteCustomer(id) {
    state.customers = state.customers.filter((c) => c.id !== id);
    state.entries = state.entries.filter((e) => e.customerId !== id);
    save();
  },

  addEntry(e) {
    state.entries.push({ ...e, id: uid(), createdAt: Date.now() });
    save();
  },

  updateEntry(e) {
    const i = state.entries.findIndex((x) => x.id === e.id);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...e };
    save();
  },

  deleteEntry(id) {
    state.entries = state.entries.filter((e) => e.id !== id);
    save();
  },

  exportJson() { return JSON.stringify({ app: 'petro-pump-crm', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2); },

  importJson(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data.customers) || !Array.isArray(data.entries)) throw new Error('This is not a valid backup file');
    state = normalize(data);
    save();
  },

  reset() { state = defaults(); save(); },

  replace(data) { state = normalize(data); save(); },
};
