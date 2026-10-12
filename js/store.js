// Data layer backed by Firebase (Auth + Firestore).
//
// The app reads from an in-memory copy of the data that Firestore listeners keep
// up to date, so screens render synchronously. Writes are applied to that copy
// straight away and sent to Firestore, which queues them while offline and
// syncs when the connection returns.

import { firebaseConfig } from './firebase-config.js?v=2026-10-13';
import * as fb from './vendor/firebase.js?v=2026-10-13';

export const FUELS = ['Petrol', 'Diesel', 'CNG', 'Engine Oil', 'Other'];
export const PAY_MODES = ['Cash', 'UPI', 'Cheque', 'Bank Transfer', 'Card'];

// Usernames are turned into e-mail style logins behind the scenes; users never see this.
const LOGIN_DOMAIN = 'users.pumpcrm.app';
export const usernameOk = (u) => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
const loginEmail = (username) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

// Key used by the earlier browser-only version of the app.
const OLD_LOCAL_KEY = 'petro-pump-crm.v1';

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

// ---------- Firebase setup ----------

const useEmulator = new URLSearchParams(location.search).has('emulator');
const fbApp = fb.initializeApp(firebaseConfig);
const auth = fb.getAuth(fbApp);
const fs = fb.initializeFirestore(fbApp, {
  ignoreUndefinedProperties: true,
  localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
});
if (useEmulator) {
  fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  fb.connectFirestoreEmulator(fs, '127.0.0.1', 8080);
}

const ref = (col, id) => fb.doc(fs, col, id);

// ---------- in-memory state ----------

const state = { settings: defaultSettings(), customers: [], entries: [], users: [] };
const loaded = { settings: false, customers: false, entries: false };
let pendingWrites = false;
let listeners = [];
let onChange = () => {};
let onError = () => {};

export const session = {
  user: null,
  profile: null,
  get username() { return this.profile?.username || ''; },
  get isOwner() { return this.profile?.role === 'owner' && this.profile?.active === true; },
};

export const sync = {
  get pending() { return pendingWrites; },
  get loaded() { return loaded.settings && loaded.customers && loaded.entries; },
};

export function setHandlers({ change, error }) {
  if (change) onChange = change;
  if (error) onError = error;
}

function emit() { onChange(); }

function fail(err) {
  console.error(err);
  onError(err.code === 'permission-denied'
    ? 'You do not have permission for this action.'
    : `Could not save: ${err.message || err}`);
}
const run = (promise) => { promise.catch(fail); };

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stopListeners() {
  listeners.forEach((u) => u());
  listeners = [];
  state.customers = [];
  state.entries = [];
  state.users = [];
  state.settings = defaultSettings();
  loaded.settings = loaded.customers = loaded.entries = false;
}

function trackPending(meta) {
  pendingWrites = meta.hasPendingWrites;
}

let retryTimer = null;
function startListeners() {
  // A listener stops for good after an error; restart them all a little later.
  const onErr = (err) => {
    console.error(err);
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (session.profile?.active) { stopListeners(); startListeners(); emit(); }
    }, 5000);
  };
  listeners.push(fb.onSnapshot(ref('settings', 'main'), { includeMetadataChanges: true }, (snap) => {
    state.settings = { ...defaultSettings(), ...(snap.data() || {}) };
    loaded.settings = true;
    trackPending(snap.metadata);
    emit();
  }, onErr));
  listeners.push(fb.onSnapshot(fb.collection(fs, 'customers'), { includeMetadataChanges: true }, (snap) => {
    state.customers = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    loaded.customers = true;
    trackPending(snap.metadata);
    emit();
  }, onErr));
  listeners.push(fb.onSnapshot(fb.collection(fs, 'entries'), { includeMetadataChanges: true }, (snap) => {
    state.entries = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    loaded.entries = true;
    trackPending(snap.metadata);
    emit();
  }, onErr));
  if (session.isOwner) {
    listeners.push(fb.onSnapshot(fb.collection(fs, 'users'), (snap) => {
      state.users = snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
      emit();
    }, onErr));
  }
}

// ---------- sign in / setup ----------

// status: 'signedOut' | 'noAccess' | 'ready'
export function watchAuth(cb) {
  let profileUnsub = null;
  fb.onAuthStateChanged(auth, (user) => {
    profileUnsub?.();
    profileUnsub = null;
    stopListeners();
    session.user = user;
    session.profile = null;
    if (!user) { cb('signedOut'); return; }
    profileUnsub = fb.onSnapshot(ref('users', user.uid), { includeMetadataChanges: true }, (snap) => {
      // Right after first-time setup the profile exists only locally until the
      // server confirms it; data access is refused until then, so wait.
      if (snap.metadata.hasPendingWrites) return;
      const profile = snap.exists() ? snap.data() : null;
      const wasActive = session.profile?.active === true;
      const roleChanged = session.profile?.role !== profile?.role;
      session.profile = profile;
      if (!profile || profile.active !== true) {
        stopListeners();
        cb('noAccess');
        return;
      }
      if (!wasActive || roleChanged || !listeners.length) {
        stopListeners();
        startListeners();
      }
      cb('ready');
    }, (err) => { console.error(err); cb('noAccess'); });
  });
}

// true / false, or null when it cannot be checked (offline).
export async function isSetupDone() {
  try {
    const snap = await fb.getDoc(ref('meta', 'setup'));
    return snap.exists();
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function signIn(username, password) {
  await fb.signInWithEmailAndPassword(auth, loginEmail(username), password);
}

export function signOutUser() { return fb.signOut(auth); }

export async function createOwner({ pumpName, name, username, password }) {
  const cred = await fb.createUserWithEmailAndPassword(auth, loginEmail(username), password);
  const id = cred.user.uid;
  const batch = fb.writeBatch(fs);
  batch.set(ref('meta', 'setup'), { ownerUid: id, createdAt: Date.now() });
  batch.set(ref('users', id), { username: username.toLowerCase(), name, role: 'owner', active: true, createdAt: Date.now() });
  batch.set(ref('settings', 'main'), { ...defaultSettings(), pumpName });
  await batch.commit();
}

export async function changeMyPassword(current, next) {
  const user = auth.currentUser;
  const cred = fb.EmailAuthProvider.credential(user.email, current);
  await fb.reauthenticateWithCredential(user, cred);
  await fb.updatePassword(user, next);
}

// Creating an account signs that account in, so do it on a second Firebase
// instance to keep the owner signed in here.
export async function createStaff({ name, username, password }) {
  const tmp = fb.initializeApp(firebaseConfig, `staff-${Date.now()}`);
  try {
    const tmpAuth = fb.getAuth(tmp);
    await fb.setPersistence(tmpAuth, fb.inMemoryPersistence);
    if (useEmulator) fb.connectAuthEmulator(tmpAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const cred = await fb.createUserWithEmailAndPassword(tmpAuth, loginEmail(username), password);
    await fb.setDoc(ref('users', cred.user.uid), {
      username: username.toLowerCase(), name, role: 'staff', active: true, createdAt: Date.now(), createdBy: session.username,
    });
    await fb.signOut(tmpAuth);
  } finally {
    await fb.deleteApp(tmp);
  }
}

export function setUserActive(userId, active) {
  run(fb.updateDoc(ref('users', userId), { active }));
}

// ---------- data API used by the screens ----------

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = fb.writeBatch(fs);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

function normalizeBackup(data) {
  // Older backups stored the interest rate as % per month.
  const yearly = (o) => {
    if (o && o.ratePerYear === undefined && o.ratePerMonth !== undefined) {
      const { ratePerMonth, ...rest } = o;
      return { ...rest, ratePerYear: ratePerMonth === '' || ratePerMonth == null ? '' : Math.round(Number(ratePerMonth) * 1200) / 100 };
    }
    return o;
  };
  if (!Array.isArray(data.customers) || !Array.isArray(data.entries)) throw new Error('This is not a valid backup file');
  return {
    settings: { ...defaultSettings(), ...yearly(data.settings || {}) },
    customers: data.customers.map(yearly),
    entries: data.entries.map((e) => ({ ...e, amount: Number(e.amount) })),
  };
}

function writeAllOps({ settings, customers, entries }, { withSettings }) {
  const ops = [];
  if (withSettings) ops.push((b) => b.set(ref('settings', 'main'), settings));
  for (const { id, ...c } of customers) ops.push((b) => b.set(ref('customers', id || uid()), c));
  for (const { id, ...e } of entries) {
    if (e.amount > 0) ops.push((b) => b.set(ref('entries', id || uid()), e));
  }
  return ops;
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
    run(fb.setDoc(ref('settings', 'main'), patch, { merge: true }));
    emit();
  },

  upsertCustomer(c) {
    const { id: existing, ...data } = c;
    const id = existing || uid();
    const record = existing ? data : { ...data, createdAt: Date.now(), createdBy: session.username };
    const i = state.customers.findIndex((x) => x.id === id);
    if (i >= 0) state.customers[i] = { ...state.customers[i], ...record };
    else state.customers.push({ ...record, id });
    run(fb.setDoc(ref('customers', id), record, { merge: true }));
    return id;
  },

  deleteCustomer(id) {
    const entryIds = state.entries.filter((e) => e.customerId === id).map((e) => e.id);
    state.customers = state.customers.filter((c) => c.id !== id);
    state.entries = state.entries.filter((e) => e.customerId !== id);
    run(commitInChunks([...entryIds.map((eid) => (b) => b.delete(ref('entries', eid))), (b) => b.delete(ref('customers', id))]));
  },

  addEntry(e) {
    const id = uid();
    const record = { ...e, createdAt: Date.now(), by: session.username };
    state.entries.push({ ...record, id });
    run(fb.setDoc(ref('entries', id), record));
  },

  updateEntry(e) {
    const { id, ...data } = e;
    const i = state.entries.findIndex((x) => x.id === id);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...data };
    run(fb.setDoc(ref('entries', id), { ...data, editedBy: session.username, editedAt: Date.now() }, { merge: true }));
  },

  deleteEntry(id) {
    state.entries = state.entries.filter((e) => e.id !== id);
    run(fb.deleteDoc(ref('entries', id)));
  },

  exportJson() {
    const { settings, customers, entries } = state;
    return JSON.stringify({ app: 'petro-pump-crm', version: 2, exportedAt: new Date().toISOString(), settings, customers, entries }, null, 2);
  },

  // Replace everything with the backup's contents.
  async importJson(text) {
    const data = normalizeBackup(JSON.parse(text));
    const deletes = [
      ...state.entries.map((e) => (b) => b.delete(ref('entries', e.id))),
      ...state.customers.map((c) => (b) => b.delete(ref('customers', c.id))),
    ];
    await commitInChunks([...deletes, ...writeAllOps(data, { withSettings: true })]);
  },

  async reset() {
    await commitInChunks([
      ...state.entries.map((e) => (b) => b.delete(ref('entries', e.id))),
      ...state.customers.map((c) => (b) => b.delete(ref('customers', c.id))),
      (b) => b.set(ref('settings', 'main'), { ...defaultSettings(), pumpName: state.settings.pumpName }),
    ]);
  },

  async addMany(customers, entries) {
    await commitInChunks(writeAllOps({ customers, entries }, { withSettings: false }));
  },

  // Data saved by the earlier browser-only version, if any.
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
    await commitInChunks(writeAllOps(data, { withSettings: false }));
    try { localStorage.setItem(`${OLD_LOCAL_KEY}.uploaded`, localStorage.getItem(OLD_LOCAL_KEY)); localStorage.removeItem(OLD_LOCAL_KEY); } catch { /* ignore */ }
    return data.entries.length;
  },
};
