// Общ сървърен код за Cloudflare Pages Functions.
export const CATEGORIES = ["Алармена система","Видеонаблюдение","Контрол на достъпа","Пожароизвестяване","Домофонна система","Мрежа / комуникация","Друго"];
export const STATUSES = ["new","work","wait","done","closed"];
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;   // 8 часа без активност
export const LOGIN_MAX_FAILS = 5;                    // за 15 минути
const COOKIE = "tk_sess";
const PBKDF2_ITER = 100000;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, full_name TEXT NOT NULL, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (username TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_user ON login_attempts(username, at)`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_ip ON login_attempts(ip, at)`,
  `CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, eik TEXT NOT NULL DEFAULT '', vat TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', contact_person TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', sites TEXT NOT NULL DEFAULT '', contract TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, company_id INTEGER REFERENCES companies(id), site TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL DEFAULT 'new', reporter_id INTEGER NOT NULL REFERENCES users(id), assignee_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_company ON tickets(company_id)`,
  `CREATE TABLE IF NOT EXISTS ticket_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS idx_log_ticket ON ticket_log(ticket_id)`,
  `CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_cat_dept ON categories(department_id)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];
// Колони, добавени след първата версия (за вече инсталирани системи)
const COLUMNS = [["users", "department_id", "INTEGER"], ["tickets", "department_id", "INTEGER"]];

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
export const maxUsers = env => Math.max(1, parseInt(env.MAX_USERS || "7", 10) || 7);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
export class HttpError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
export const fail = (msg, status = 400) => { throw new HttpError(msg, status); };

/* ---------- crypto ---------- */
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}
export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2") return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), parseInt(iter, 10)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
// Фиктивен хеш, за да отнема еднакво време и при несъществуващ потребител
let dummyHash = null;
export async function dummyVerify(password) { dummyHash ||= await hashPassword("dummy-" + Math.random()); await verifyPassword(password, dummyHash); return false; }

/* ---------- sessions ---------- */
function getCookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  for (const part of c.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}
export async function createSession(env, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_IDLE_MS, nowIso()).run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 3600}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function sessionUser(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const th = await sha256(token);
  let row;
  try {
    row = await env.DB.prepare("SELECT s.expires_at, u.id, u.username, u.full_name, u.role, u.active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").bind(th).first();
  } catch { return null; }
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now || !row.active) { await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(th).run(); return null; }
  // Плъзгащо изтичане: подновяваме най-много веднъж на 5 минути
  if (row.expires_at - now < SESSION_IDLE_MS - 5 * 60 * 1000) {
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(now + SESSION_IDLE_MS, th).run();
  }
  return { id: row.id, username: row.username, name: row.full_name, isAdmin: row.role === "admin", tokenHash: th };
}

export async function ensureSchema(env) {
  await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
  for (const [t, c, type] of COLUMNS) {
    const cols = (await env.DB.prepare(`PRAGMA table_info(${t})`).all()).results.map(r => r.name);
    if (!cols.includes(c)) await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`).run();
  }
  // Еднократно: отдел „Сервиз“ с досегашните категории; старите тикети отиват в него
  if (!(await env.DB.prepare("SELECT v FROM meta WHERE k = 'departments_seeded'").first())) {
    const now = nowIso();
    let d = await env.DB.prepare("SELECT id FROM departments ORDER BY id LIMIT 1").first();
    if (!d) {
      const r = await env.DB.prepare("INSERT INTO departments (name, created_at) VALUES ('Сервиз', ?)").bind(now).run();
      d = { id: r.meta.last_row_id };
      await env.DB.batch(CATEGORIES.map((c, i) => env.DB.prepare("INSERT INTO categories (department_id, name, sort) VALUES (?, ?, ?)").bind(d.id, c, i)));
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE tickets SET department_id = ? WHERE department_id IS NULL").bind(d.id),
      env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('departments_seeded', ?)").bind(now),
    ]);
  }
}
// Изпълнява се веднъж на стартиране на сървъра
let migrated = null;
export function migrateOnce(env) {
  migrated ||= ensureSchema(env).catch(e => { migrated = null; throw e; });
  return migrated;
}
export async function userCount(env) {
  try { return (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n; } catch { return 0; }
}
export const clientIp = request => request.headers.get("CF-Connecting-IP") || "local";
export const str = (v, max) => String(v ?? "").trim().slice(0, max);
export const validUsername = u => /^[A-Za-z0-9._-]{3,50}$/.test(u);
