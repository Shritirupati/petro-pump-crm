// Data layer for the Cloudflare version (Worker API + D1 database).
//
// Screens read an in-memory copy of the data, so they render instantly. The
// copy is saved on this device, so the app opens and works without internet.
// Changes are applied locally at once and queued in an outbox that is sent to
// the server as soon as there is a connection. Other devices' changes are
// pulled every few seconds.

export const FUELS = ['Petrol', 'Diesel', 'CNG', 'Engine Oil', 'Other'];
export const PAY_MODES = ['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Card'];
export const usernameOk = (u) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);

const CACHE_KEY = 'pump-crm.cache.v2';
const OUTBOX_KEY = 'pump-crm.outbox.v2';
const OLD_LOCAL_KEY = 'petro-pump-crm.v1'; // the first, browser-only version
const POLL_MS = 15000;

export function defaultSettings() {
  return {
    pumpName: 'My Petrol Pump',
    address: '',
    phone: '',
    interestMethod: 'khata',
    ratePerYear: 24,
    graceDays: 30,
    lastRates: { Petrol: 0, Diesel: 0, CNG: 0 },
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- server calls ----------

async function api(path, body) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CRM': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    const err = new Error('No internet connection.');
    err.code = 'network';
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.code = data?.code || (res.status >= 500 ? 'server' : 'error');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- state ----------

const state = { settings: defaultSettings(), customers: [], entries: [], users: [] };
let since = 0;
let loaded = false;
let outbox = [];
let flushing = false;
let pollTimer = null;
let authCb = () => {};
let onChange = () => {};
let onError = () => {};

export const session = {
  profile: null,
  get username() { return this.profile?.username || ''; },
  get isOwner() { return this.profile?.role === 'owner' && this.profile?.active === true; },
};

export const sync = {
  get pending() { return outbox.length > 0; },
  get pendingCount() { return outbox.length; },
  get loaded() { return loaded; },
};

export function setHandlers({ change, error }) {
  if (change) onChange = change;
  if (error) onError = error;
}
const emit = () => onChange();

function saveLocal() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: session.profile?.id, profile: session.profile, since, ...state }));
    localStorage.setItem(OUTBOX_KEY, JSON.stringify({ userId: session.profile?.id, ops: outbox }));
  } catch (err) {
    console.warn('Could not save data on this device', err);
  }
}

function loadLocal() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    const box = JSON.parse(localStorage.getItem(OUTBOX_KEY) || 'null');
    return { cache, ops: box && cache && box.userId === cache.userId ? box.ops || [] : [] };
  } catch {
    return { cache: null, ops: [] };
  }
}

function clearLocal() {
  state.settings = defaultSettings();
  state.customers = [];
  state.entries = [];
  state.users = [];
  since = 0;
  loaded = false;
  outbox = [];
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(OUTBOX_KEY);
  } catch { /* ignore */ }
}

function applyCache(cache, ops) {
  state.settings = { ...defaultSettings(), ...(cache.settings || {}) };
  state.customers = cache.customers || [];
  state.entries = cache.entries || [];
  state.users = cache.users || [];
  since = cache.since || 0;
  outbox = ops || [];
  loaded = true;
}

// ---------- sync ----------

const pendingIds = () => new Set(outbox.map((o) => o.id).filter(Boolean));

function merge(list, incoming, full) {
  const keep = pendingIds();
  const byId = new Map(full ? list.filter((r) => keep.has(r.id)).map((r) => [r.id, r]) : list.map((r) => [r.id, r]));
  for (const r of incoming) {
    if (keep.has(r.id)) continue; // a local change is still on its way to the server
    if (r.deleted) byId.delete(r.id);
    else byId.set(r.id, r);
  }
  return [...byId.values()];
}

function handleAuthError(err) {
  if (err.code === 'signed-out') { stopPolling(); clearLocal(); session.profile = null; authCb('signedOut'); return true; }
  if (err.code === 'disabled') { stopPolling(); clearLocal(); authCb('noAccess'); return true; }
  return false;
}

async function pull() {
  const full = !since;
  // Ask for a little overlap so changes saved during the last request are not missed.
  const data = await api(`sync?since=${full ? 0 : since - 5000}`);
  session.profile = data.me;
  if (!pendingIds().has('settings')) state.settings = { ...defaultSettings(), ...data.settings };
  state.customers = merge(state.customers, data.customers, full);
  state.entries = merge(state.entries, data.entries, full);
  state.users = data.users;
  since = data.now;
  loaded = true;
  saveLocal();
}

async function flush() {
  if (flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const batch = outbox.slice(0, 25);
      const res = await api('ops', { ops: batch });
      outbox = outbox.slice(batch.length);
      saveLocal();
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) {
        onError(failed[0].error || 'Some changes could not be saved.');
        since = 0; // reload everything so the screen matches the server
      }
    }
  } finally {
    flushing = false;
  }
}

export async function syncNow() {
  try {
    await flush();
    await pull();
    emit();
  } catch (err) {
    if (!handleAuthError(err) && err.code !== 'network') console.warn('Sync problem', err);
    emit();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, POLL_MS);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}
window.addEventListener('online', () => { if (session.profile) syncNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session.profile) syncNow(); });

function queue(op) {
  outbox.push(op);
  saveLocal();
  emit();
  flush().then(emit).catch((err) => { if (!handleAuthError(err) && err.code !== 'network') onError(err.message); emit(); });
}

// ---------- sign in / setup ----------

// status: 'signedOut' | 'noAccess' | 'ready'
export function watchAuth(cb) {
  authCb = cb;
  start();
}

async function start() {
  const { cache, ops } = loadLocal();
  try {
    const { user } = await api('me');
    session.profile = user;
    if (cache && cache.userId === user.id) applyCache(cache, ops);
    else clearLocal();
    authCb(loaded ? 'ready' : 'loading');
    await syncNow();
    startPolling();
    authCb('ready');
  } catch (err) {
    if (err.code === 'network' && cache?.profile) {
      // Offline: open with the copy saved on this device.
      session.profile = cache.profile;
      applyCache(cache, ops);
      startPolling();
      authCb('ready');
      return;
    }
    if (err.code === 'disabled') { authCb('noAccess'); return; }
    if (err.code === 'network') { authCb('signedOut'); return; }
    clearLocal();
    session.profile = null;
    authCb('signedOut');
  }
}

// { setupDone, pumpName } or null when offline.
export async function getStatus() {
  try { return await api('status'); } catch { return null; }
}

export async function signIn(username, password) {
  await api('login', { username: username.trim().toLowerCase(), password });
  await start();
}

export async function createOwner({ pumpName, name, username, password }) {
  await api('setup', { pumpName, name, username, password });
  await start();
}

export async function signOutUser() {
  stopPolling();
  try { await api('logout', {}); } catch { /* offline: the cookie expires on its own */ }
  clearLocal();
  session.profile = null;
  authCb('signedOut');
}

export const verifyPassword = (password) => api('verify-password', { password });
export const changeMyPassword = (current, next) => api('password', { current, next });

export async function createStaff({ name, username, password }) {
  await api('users', { name, username, password });
  await syncNow();
}

export function setUserActive(userId, active) {
  api('users/active', { id: userId, active })
    .then(syncNow)
    .catch((err) => onError(err.message));
}

// ---------- data API used by the screens ----------

function normalizeBackup(data) {
  // Older backups stored the interest rate as % per month.
  const yearly = (o) => {
    if (o && o.ratePerYear === undefined && o.ratePerMonth !== undefined) {
      const { ratePerMonth, ...rest } = o;
      return { ...rest, ratePerYear: ratePerMonth === '' || ratePerMonth == null ? '' : Math.round(Number(ratePerMonth) * 1200) / 100 };
    }
    return o;
  };
  if (!data || !Array.isArray(data.customers) || !Array.isArray(data.entries)) throw new Error('This is not a valid backup file');
  return {
    settings: { ...defaultSettings(), ...yearly(data.settings || {}) },
    customers: data.customers.map(yearly),
    entries: data.entries.map((e) => ({ ...e, amount: Number(e.amount) })),
  };
}

async function reloadAll() {
  since = 0;
  await syncNow();
}

export const db = {
  get settings() { return state.settings; },
  get customers() { return state.customers; },
  get entries() { return state.entries; },
  get users() { return state.users; },

  customer(id) { return state.customers.find((c) => c.id === id); },
  entriesFor(customerId) { return state.entries.filter((e) => e.customerId === customerId); },

  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    queue({ op: 'updateSettings', id: 'settings', patch });
  },

  upsertCustomer(c) {
    const { id: existing, ...data } = c;
    const id = existing || uid();
    const record = existing ? data : { ...data, createdAt: Date.now(), createdBy: session.username };
    const i = state.customers.findIndex((x) => x.id === id);
    if (i >= 0) state.customers[i] = { ...state.customers[i], ...record };
    else state.customers.push({ ...record, id });
    queue({ op: 'upsertCustomer', id, data: record });
    return id;
  },

  // Needs internet and the owner's password.
  async deleteCustomer(id, password) {
    await api('customers/delete', { id, password });
    state.customers = state.customers.filter((c) => c.id !== id);
    state.entries = state.entries.filter((e) => e.customerId !== id);
    saveLocal();
    emit();
  },

  addEntry(e) {
    const id = uid();
    const record = { ...e, createdAt: Date.now(), by: session.username };
    state.entries.push({ ...record, id });
    queue({ op: 'addEntry', id, data: record });
  },

  updateEntry(e) {
    const { id, ...data } = e;
    const i = state.entries.findIndex((x) => x.id === id);
    if (i < 0) return;
    state.entries[i] = { ...state.entries[i], ...data };
    const { id: _, ...full } = state.entries[i];
    queue({ op: 'updateEntry', id, data: full });
  },

  deleteEntry(id) {
    state.entries = state.entries.filter((e) => e.id !== id);
    queue({ op: 'deleteEntry', id });
  },

  exportJson() {
    const { settings, customers, entries } = state;
    return JSON.stringify({ app: 'petro-pump-crm', version: 3, exportedAt: new Date().toISOString(), settings, customers, entries }, null, 2);
  },

  // Replace everything with the backup's contents (owner, needs password).
  async importJson(text, password) {
    const data = normalizeBackup(JSON.parse(text));
    await api('restore', { password, data });
    outbox = [];
    await reloadAll();
  },

  async reset(password) {
    await api('reset', { password });
    outbox = [];
    await reloadAll();
  },

  // Data saved by the first, browser-only version, if any.
  localData() {
    try {
      const raw = localStorage.getItem(OLD_LOCAL_KEY);
      if (!raw) return null;
      const data = normalizeBackup(JSON.parse(raw));
      return data.customers.length || data.entries.length ? data : null;
    } catch {
      return null;
    }
  },

  async uploadLocalData() {
    const data = this.localData();
    if (!data) return 0;
    await api('import', { data });
    try {
      localStorage.setItem(`${OLD_LOCAL_KEY}.uploaded`, localStorage.getItem(OLD_LOCAL_KEY));
      localStorage.removeItem(OLD_LOCAL_KEY);
    } catch { /* ignore */ }
    await reloadAll();
    return data.entries.length;
  },
};
