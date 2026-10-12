// Petrol Pump CRM API on Cloudflare Workers + D1.
//
// Static files in public/ are served by the assets binding; this Worker only
// handles /api/*. Sign-in uses username + password (PBKDF2) and an HttpOnly
// session cookie. The owner (created once on the setup screen) manages staff.
// Staff can add customers, sales and payments; only the owner can edit or
// delete entries, delete customers, change settings, restore or erase data.

const SESSION_DAYS = 60;
const PBKDF2_ITERATIONS = 20000; // kept modest for the Workers free-plan CPU limit; logins are rate limited
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const ENTRY_TYPES = ['udhar', 'jama', 'byaaj_jama', 'byaaj_maaf'];
const MAX_RECORD_BYTES = 8 * 1024;
const MAX_OPS = 50;

const DEFAULT_SETTINGS = {
  pumpName: 'My Petrol Pump',
  address: '',
  phone: '',
  interestMethod: 'khata',
  ratePerYear: 24,
  graceDays: 30,
  lastRates: { Petrol: 0, Diesel: 0, CNG: 0 },
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
      console.error(err);
      return json({ error: 'Server error. Please try again.', code: 'server' }, 500);
    }
  },
};

// ---------- helpers ----------

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256(text) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function hashPassword(password, saltB64, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations }, key, 256);
  return b64(bits);
}

function sameString(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function newPasswordFields(password) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { pass_salt: salt, pass_iter: PBKDF2_ITERATIONS, pass_hash: await hashPassword(password, salt, PBKDF2_ITERATIONS) };
}

async function passwordMatches(user, password) {
  return sameString(await hashPassword(password, user.pass_salt, user.pass_iter), user.pass_hash);
}

function cookieValue(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `crm_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'bad-request', 'Invalid request');
  }
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function checkUsername(username) {
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'bad-username', 'Username can use small letters, numbers, dot and dash (3 to 30 characters).');
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw new HttpError(400, 'weak-password', 'Password must be at least 6 characters.');
  }
}
function checkId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'bad-id', 'Invalid record id');
}
function checkSize(obj) {
  if (JSON.stringify(obj).length > MAX_RECORD_BYTES) throw new HttpError(400, 'too-large', 'Record is too large');
}
function cleanRecord(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'bad-record', 'Invalid record');
  const { id, ...rest } = data;
  checkSize(rest);
  return rest;
}
function checkEntry(e) {
  if (!ENTRY_TYPES.includes(e.type)) throw new HttpError(400, 'bad-entry', 'Invalid entry type');
  if (typeof e.customerId !== 'string' || !ID_RE.test(e.customerId)) throw new HttpError(400, 'bad-entry', 'Invalid customer');
  if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new HttpError(400, 'bad-entry', 'Invalid date');
  if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount <= 0 || e.amount > 1e10) throw new HttpError(400, 'bad-entry', 'Invalid amount');
}
function checkCustomer(c) {
  if (typeof c.name !== 'string' || !c.name.trim()) throw new HttpError(400, 'bad-customer', 'Customer name is required');
}

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active, createdAt: u.created_at });

// ---------- sessions ----------

async function startSession(request, env, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), userId, now, now + SESSION_DAYS * 864e5),
  ]);
  return sessionCookie(request, token, SESSION_DAYS * 86400);
}

async function sessionUser(request, env) {
  const token = cookieValue(request, 'crm_session');
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

async function requireUser(request, env) {
  const user = await sessionUser(request, env);
  if (!user) throw new HttpError(401, 'signed-out', 'Please sign in again.');
  if (!user.active) throw new HttpError(403, 'disabled', 'This login is disabled.');
  return user;
}

async function requireOwner(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== 'owner') throw new HttpError(403, 'forbidden', 'Only the owner can do this.');
  return user;
}

async function tooManyFailures(env, username) {
  const since = Date.now() - FAILURE_WINDOW_MS;
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE username = ? AND at > ?').bind(username, since).first();
  return row.n >= MAX_FAILURES;
}

async function recordFailure(env, username) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(now - FAILURE_WINDOW_MS),
    env.DB.prepare('INSERT INTO login_failures (username, at) VALUES (?, ?)').bind(username, now),
  ]);
}

// Password re-check before erasing or restoring data.
async function confirmPassword(env, user, password) {
  if (await tooManyFailures(env, user.username)) throw new HttpError(429, 'too-many-requests', 'Too many attempts. Please wait 15 minutes.');
  if (typeof password !== 'string' || !(await passwordMatches(user, password))) {
    await recordFailure(env, user.username);
    throw new HttpError(403, 'wrong-password', 'Wrong password. Nothing was changed.');
  }
}

// ---------- data helpers ----------

const parseRow = (r) => ({ ...JSON.parse(r.data), id: r.id, ...(r.deleted ? { deleted: true } : {}) });

async function readSettings(env) {
  const row = await env.DB.prepare('SELECT data FROM settings WHERE id = 1').first();
  return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.data) : {}) };
}

// Insert many records with a few statements (one JSON array per chunk).
// ("WHERE true" is required by SQLite before ON CONFLICT in INSERT … SELECT.)
function bulkUpsert(env, table, records, now) {
  const stmts = [];
  let chunk = [];
  let size = 0;
  const flush = () => {
    if (!chunk.length) return;
    const payload = JSON.stringify(chunk);
    if (table === 'customers') {
      stmts.push(env.DB.prepare(`INSERT INTO customers (id, data, updated_at, deleted)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.data'), ?, 0 FROM json_each(?) WHERE true
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = 0`).bind(now, payload));
    } else {
      stmts.push(env.DB.prepare(`INSERT INTO entries (id, customer_id, data, updated_at, deleted)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.customerId'), json_extract(value, '$.data'), ?, 0 FROM json_each(?) WHERE true
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, customer_id = excluded.customer_id, updated_at = excluded.updated_at, deleted = 0`).bind(now, payload));
    }
    chunk = [];
    size = 0;
  };
  for (const r of records) {
    const item = table === 'customers'
      ? { id: r.id, data: JSON.stringify(r.data) }
      : { id: r.id, customerId: r.data.customerId, data: JSON.stringify(r.data) };
    const len = JSON.stringify(item).length;
    if (size + len > 400_000) flush();
    chunk.push(item);
    size += len;
  }
  flush();
  return stmts;
}

function readBackup(data) {
  if (!data || !Array.isArray(data.customers) || !Array.isArray(data.entries)) throw new HttpError(400, 'bad-backup', 'This is not a valid backup file');
  const customers = [];
  const entries = [];
  for (const c of data.customers) {
    if (!c || !ID_RE.test(String(c.id || ''))) continue;
    const rec = cleanRecord(c);
    if (typeof rec.name !== 'string' || !rec.name.trim()) continue;
    customers.push({ id: String(c.id), data: rec });
  }
  for (const e of data.entries) {
    if (!e || !ID_RE.test(String(e.id || ''))) continue;
    const rec = cleanRecord({ ...e, amount: Number(e.amount) });
    try { checkEntry(rec); } catch { continue; }
    entries.push({ id: String(e.id), data: rec });
  }
  return { customers, entries };
}

// ---------- routes ----------

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // Requests that change data must come from the app itself (blocks cross-site form posts).
  if (method !== 'GET' && request.headers.get('X-CRM') !== '1') throw new HttpError(403, 'bad-origin', 'Request blocked');

  if (method === 'GET' && path === '/api/status') {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").first();
    const settings = row.n ? await readSettings(env) : null;
    return json({ setupDone: row.n > 0, pumpName: settings?.pumpName || '' });
  }

  if (method === 'POST' && path === '/api/setup') {
    const body = await readBody(request);
    const pumpName = str(body.pumpName, 100);
    const name = str(body.name, 80);
    const username = str(body.username, 30).toLowerCase();
    if (!pumpName || !name) throw new HttpError(400, 'bad-request', 'Pump name and owner name are required.');
    checkUsername(username);
    checkPassword(body.password);
    const id = crypto.randomUUID();
    const now = Date.now();
    const pw = await newPasswordFields(body.password);
    const res = await env.DB.prepare(`INSERT INTO users (id, username, name, role, active, pass_hash, pass_salt, pass_iter, created_at)
      SELECT ?, ?, ?, 'owner', 1, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`)
      .bind(id, username, name, pw.pass_hash, pw.pass_salt, pw.pass_iter, now).run();
    if (!res.meta.changes) throw new HttpError(409, 'setup-done', 'Setup is already done. Please sign in.');
    await env.DB.prepare('INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (1, ?, ?)')
      .bind(JSON.stringify({ ...DEFAULT_SETTINGS, pumpName }), now).run();
    const cookie = await startSession(request, env, id);
    return json({ user: publicUser({ id, username, name, role: 'owner', active: 1, created_at: now }) }, 200, { 'Set-Cookie': cookie });
  }

  if (method === 'POST' && path === '/api/login') {
    const body = await readBody(request);
    const username = str(body.username, 30).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) throw new HttpError(400, 'wrong-password', 'Wrong username or password.');
    if (await tooManyFailures(env, username)) throw new HttpError(429, 'too-many-requests', 'Too many attempts. Please wait 15 minutes.');
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    const ok = user ? await passwordMatches(user, password) : (await hashPassword(password, 'AAAAAAAAAAAAAAAAAAAAAA==', PBKDF2_ITERATIONS), false);
    if (!ok) {
      await recordFailure(env, username);
      throw new HttpError(401, 'wrong-password', 'Wrong username or password.');
    }
    if (!user.active) throw new HttpError(403, 'disabled', 'This login is disabled. Please ask the owner.');
    await env.DB.prepare('DELETE FROM login_failures WHERE username = ?').bind(username).run();
    const cookie = await startSession(request, env, user.id);
    return json({ user: publicUser(user) }, 200, { 'Set-Cookie': cookie });
  }

  if (method === 'POST' && path === '/api/logout') {
    const token = cookieValue(request, 'crm_session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }

  if (method === 'GET' && path === '/api/me') {
    const user = await requireUser(request, env);
    return json({ user: publicUser(user) });
  }

  if (method === 'GET' && path === '/api/sync') {
    const user = await requireUser(request, env);
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const now = Date.now();
    const deletedFilter = since ? '' : ' AND deleted = 0';
    const [settings, customers, entries, users] = await env.DB.batch([
      env.DB.prepare('SELECT data FROM settings WHERE id = 1'),
      env.DB.prepare(`SELECT id, data, deleted FROM customers WHERE updated_at >= ?${deletedFilter}`).bind(since),
      env.DB.prepare(`SELECT id, data, deleted FROM entries WHERE updated_at >= ?${deletedFilter}`).bind(since),
      env.DB.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY created_at'),
    ]);
    return json({
      now,
      me: publicUser(user),
      settings: { ...DEFAULT_SETTINGS, ...(settings.results[0] ? JSON.parse(settings.results[0].data) : {}) },
      customers: customers.results.map(parseRow),
      entries: entries.results.map(parseRow),
      users: user.role === 'owner' ? users.results.map(publicUser) : [],
    });
  }

  if (method === 'POST' && path === '/api/ops') {
    const user = await requireUser(request, env);
    const owner = user.role === 'owner';
    const body = await readBody(request);
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS) : [];
    const now = Date.now();
    const results = [];
    const stmts = [];
    for (const op of ops) {
      try {
        switch (op.op) {
          case 'upsertCustomer': {
            checkId(op.id);
            const data = cleanRecord(op.data);
            checkCustomer(data);
            stmts.push(env.DB.prepare(`INSERT INTO customers (id, data, updated_at, deleted) VALUES (?, ?, ?, 0)
              ON CONFLICT(id) DO UPDATE SET data = json_patch(customers.data, excluded.data), updated_at = excluded.updated_at
              WHERE customers.deleted = 0`).bind(op.id, JSON.stringify(data), now));
            break;
          }
          case 'addEntry': {
            checkId(op.id);
            const data = { ...cleanRecord(op.data), by: user.username };
            checkEntry(data);
            stmts.push(env.DB.prepare(`INSERT INTO entries (id, customer_id, data, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
              ON CONFLICT(id) DO NOTHING`).bind(op.id, data.customerId, JSON.stringify(data), now));
            break;
          }
          case 'updateEntry': {
            if (!owner) throw new HttpError(403, 'forbidden', 'Only the owner can edit entries.');
            checkId(op.id);
            const data = { ...cleanRecord(op.data), editedBy: user.username, editedAt: now };
            checkEntry(data);
            stmts.push(env.DB.prepare('UPDATE entries SET data = json_patch(data, ?), customer_id = ?, updated_at = ? WHERE id = ? AND deleted = 0')
              .bind(JSON.stringify(data), data.customerId, now, op.id));
            break;
          }
          case 'deleteEntry': {
            if (!owner) throw new HttpError(403, 'forbidden', 'Only the owner can delete entries.');
            checkId(op.id);
            stmts.push(env.DB.prepare('UPDATE entries SET deleted = 1, updated_at = ? WHERE id = ?').bind(now, op.id));
            break;
          }
          case 'updateSettings': {
            const patch = cleanRecord(op.patch);
            const keys = Object.keys(patch);
            if (!owner && keys.some((k) => k !== 'lastRates')) throw new HttpError(403, 'forbidden', 'Only the owner can change settings.');
            stmts.push(env.DB.prepare(`INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
              ON CONFLICT(id) DO UPDATE SET data = json_patch(settings.data, excluded.data), updated_at = excluded.updated_at`)
              .bind(JSON.stringify(patch), now));
            break;
          }
          default:
            throw new HttpError(400, 'bad-op', 'Unknown change');
        }
        results.push({ ok: true });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        results.push({ ok: false, code: err.code, error: err.message });
      }
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ results, now });
  }

  if (method === 'POST' && path === '/api/customers/delete') {
    const user = await requireOwner(request, env);
    const body = await readBody(request);
    checkId(body.id);
    await confirmPassword(env, user, body.password);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('UPDATE entries SET deleted = 1, updated_at = ? WHERE customer_id = ? AND deleted = 0').bind(now, body.id),
      env.DB.prepare('UPDATE customers SET deleted = 1, updated_at = ? WHERE id = ?').bind(now, body.id),
    ]);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/verify-password') {
    const user = await requireUser(request, env);
    const body = await readBody(request);
    await confirmPassword(env, user, body.password);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/password') {
    const user = await requireUser(request, env);
    const body = await readBody(request);
    await confirmPassword(env, user, body.current);
    checkPassword(body.next);
    const pw = await newPasswordFields(body.next);
    const token = cookieValue(request, 'crm_session');
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ? WHERE id = ?').bind(pw.pass_hash, pw.pass_salt, pw.pass_iter, user.id),
      // Sign out the user's other devices.
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, await sha256(token)),
    ]);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/users') {
    const owner = await requireOwner(request, env);
    const body = await readBody(request);
    const name = str(body.name, 80);
    const username = str(body.username, 30).toLowerCase();
    if (!name) throw new HttpError(400, 'bad-request', 'Name is required.');
    checkUsername(username);
    checkPassword(body.password);
    const pw = await newPasswordFields(body.password);
    const res = await env.DB.prepare(`INSERT INTO users (id, username, name, role, active, pass_hash, pass_salt, pass_iter, created_at, created_by)
      VALUES (?, ?, ?, 'staff', 1, ?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING`)
      .bind(crypto.randomUUID(), username, name, pw.pass_hash, pw.pass_salt, pw.pass_iter, Date.now(), owner.username).run();
    if (!res.meta.changes) throw new HttpError(409, 'username-taken', `The username "${username}" is already taken.`);
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/users/active') {
    const owner = await requireOwner(request, env);
    const body = await readBody(request);
    if (typeof body.id !== 'string' || body.id === owner.id) throw new HttpError(400, 'bad-request', 'Invalid user');
    const active = body.active ? 1 : 0;
    const stmts = [env.DB.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'staff'").bind(active, body.id)];
    if (!active) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(body.id));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  if (method === 'POST' && (path === '/api/reset' || path === '/api/restore' || path === '/api/import')) {
    const user = await requireOwner(request, env);
    const body = await readBody(request);
    if (path !== '/api/import') await confirmPassword(env, user, body.password);
    const now = Date.now();
    const stmts = [];
    if (path !== '/api/import') {
      stmts.push(env.DB.prepare('UPDATE entries SET deleted = 1, updated_at = ? WHERE deleted = 0').bind(now));
      stmts.push(env.DB.prepare('UPDATE customers SET deleted = 1, updated_at = ? WHERE deleted = 0').bind(now));
    }
    if (path === '/api/reset') {
      const current = await readSettings(env);
      stmts.push(env.DB.prepare('UPDATE settings SET data = ?, updated_at = ? WHERE id = 1')
        .bind(JSON.stringify({ ...DEFAULT_SETTINGS, pumpName: current.pumpName }), now));
    } else {
      const { customers, entries } = readBackup(body.data);
      if (path === '/api/restore' && body.data.settings && typeof body.data.settings === 'object') {
        stmts.push(env.DB.prepare('INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (1, ?, ?)')
          .bind(JSON.stringify({ ...DEFAULT_SETTINGS, ...cleanRecord(body.data.settings) }), now));
      }
      stmts.push(...bulkUpsert(env, 'customers', customers, now), ...bulkUpsert(env, 'entries', entries, now));
      await env.DB.batch(stmts);
      return json({ ok: true, customers: customers.length, entries: entries.length });
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  throw new HttpError(404, 'not-found', 'Not found');
}
