import {
  FILE_MAX_BYTES, FILE_CHUNK, FILES_PER_TICKET, STATUSES, REPAIR_STATUSES, REPAIR_PATH, STATUS_LABELS, LOGIN_MAX_FAILS, json, fail, HttpError, nowIso, maxUsers, str, validUsername,
  hashPassword, verifyPassword, dummyVerify, createSession, clearCookie, ensureSchema, userCount, clientIp,
} from "../../lib/server.js";
import { emailConfig, sendMail, notifyAssigned } from "../../lib/email.js";
// Дата по фактура: ГГГГ-ММ-ДД или празно
const dateOnly = v => { const s = String(v ?? "").trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s)) ? s : ""; };
const bgDate = s => s ? s.split("-").reverse().join(".") : "";
const validEmail = e => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const sid = v => (v === null || v === undefined ? "" : String(v));

export async function onRequest(context) {
  const { request, env, data } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\//, "");
  const method = request.method;
  try {
    if (method === "POST") {
      // Защита от заявки от чужди сайтове: изискваме наш заглавен ред и JSON
      if (request.headers.get("X-Tiketi") !== "1") fail("Невалидна заявка.", 403);
    }
    // Файловете се качват като суров поток, не като JSON
    if (method === "POST" && path === "files/upload") return await uploadFile({ request, env, me: data.user });
    const fm = method === "GET" && path.match(/^files\/(\d+)$/);
    if (fm) return await downloadFile(env, parseInt(fm[1], 10));
    const body = method === "POST" ? await request.json().catch(() => ({})) : {};
    const route = ROUTES[`${method} ${path}`];
    if (!route) fail("Непознато действие.", 404);
    // Имейлите се пращат след отговора, за да не бавят работата
    const later = p => context.waitUntil(p);
    return await route({ request, env, me: data.user, body, later, origin: new URL(request.url).origin });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Грешка на сървъра: " + (e.message || e) }, 500);
  }
}

/* ---------- files ---------- */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
async function uploadFile({ request, env, me }) {
  const u = new URL(request.url);
  const tid = parseInt(u.searchParams.get("ticket"), 10) || 0;
  const name = (u.searchParams.get("name") || "файл").replace(/[\\/\r\n"]/g, "_").slice(0, 160);
  const type = (request.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim().slice(0, 100);
  const t = await env.DB.prepare("SELECT id FROM tickets WHERE id = ?").bind(tid).first();
  if (!t) fail("Тикетът не съществува.", 404);
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE ticket_id = ?").bind(tid).first()).n;
  if (n >= FILES_PER_TICKET) fail(`Към един тикет може да има най-много ${FILES_PER_TICKET} файла.`);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > FILE_MAX_BYTES) fail("Файлът е по-голям от 10 MB.", 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) fail("Файлът е празен.");
  if (buf.length > FILE_MAX_BYTES) fail("Файлът е по-голям от 10 MB.", 413);
  const now = nowIso();
  const r = await env.DB.prepare("INSERT INTO files (ticket_id, name, type, size, user_id, at) VALUES (?, ?, ?, ?, ?, ?)").bind(tid, name, type, buf.length, me.id, now).run();
  const fid = r.meta.last_row_id;
  const stm = [];
  for (let i = 0, k = 0; i < buf.length; i += FILE_CHUNK, k++)
    stm.push(env.DB.prepare("INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)").bind(fid, k, buf.slice(i, i + FILE_CHUNK)));
  try { for (let i = 0; i < stm.length; i += 5) await env.DB.batch(stm.slice(i, i + 5)); }
  catch (e) { await env.DB.batch([env.DB.prepare("DELETE FROM file_chunks WHERE file_id = ?").bind(fid), env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fid)]); throw e; }
  await env.DB.batch([
    await log(env, tid, me.id, "file", { name, size: buf.length, fid: sid(fid) }, now),
    env.DB.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").bind(now, tid),
  ]);
  return json({ ok: true, id: sid(fid) });
}
async function downloadFile(env, fid) {
  const f = await env.DB.prepare("SELECT name, type, size FROM files WHERE id = ?").bind(fid).first();
  if (!f) return new Response("Файлът не съществува.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const parts = (await env.DB.prepare("SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx").bind(fid).all()).results;
  const out = new Uint8Array(f.size); let o = 0;
  for (const p of parts) { const b = new Uint8Array(p.data); out.set(b, o); o += b.length; }
  const inline = INLINE_TYPES.has(f.type);
  return new Response(out, { headers: {
    // Само снимки и PDF се отварят в браузъра; всичко друго се сваля (защита от вреден HTML/SVG)
    "Content-Type": inline ? f.type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
  } });
}

// Известие за служител в системата (звънчето). Не известяваме човека за собствените му действия.
function notifyStmt(env, userId, ticketId, type, byId, data, at) {
  return env.DB.prepare("INSERT INTO notifications (user_id, ticket_id, type, by_id, data, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, ticketId, type, byId, JSON.stringify(data || {}), at);
}

/* ---------- зареждане и синхронизация ---------- */
// „Курсор“: докъде е стигнал браузърът – последен запис в историята, изтрит тикет, известие и версия на настройките
const cursorStmt = (env, me) => env.DB.prepare(`SELECT (SELECT MAX(id) FROM ticket_log) AS log, (SELECT MAX(id) FROM tombstones) AS tomb,
  (SELECT MAX(id) FROM notifications WHERE user_id = ?) AS notif, (SELECT v FROM meta WHERE k = 'cfg_rev') AS cfg`).bind(me.id);
const cursorOf = r => ({ log: r.log || 0, tomb: r.tomb || 0, notif: r.notif || 0, cfg: String(r.cfg || "0") });
// Отбелязва промяна в потребители, компании или отдели – за да ги презаредят другите
const bumpCfg = env => env.DB.prepare("INSERT INTO meta (k, v) VALUES ('cfg_rev', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(Date.now()));
function mapTickets(rows, logs, files) {
  const tmap = new Map();
  for (const t of rows) tmap.set(t.id, {
    id: sid(t.id), no: t.id, title: t.title, description: t.description, company: sid(t.company_id), site: t.site,
    department: sid(t.department_id), category: t.category, priority: t.priority,
    kind: t.kind || "ticket", clientName: t.client_name || "", product: t.product || "", serial: t.serial || "",
    replaced: t.replaced === null || t.replaced === undefined ? "" : (t.replaced ? "yes" : "no"), newSerial: t.new_serial || "", invoiceDate: t.invoice_date || "", sentDate: t.sent_date || "",
    issued: !!t.issued, issueDoc: t.issue_doc || "", status: t.status, reporter: sid(t.reporter_id), assignee: sid(t.assignee_id),
    createdAt: t.created_at, updatedAt: t.updated_at, log: [], files: [],
  });
  for (const f of files) { const t = tmap.get(f.ticket_id); if (t) t.files.push({ id: sid(f.id), name: f.name, type: f.type, size: f.size, by: sid(f.user_id), at: f.at }); }
  for (const l of logs) {
    const t = tmap.get(l.ticket_id); if (!t) continue;
    let d = {}; try { d = JSON.parse(l.data); } catch {}
    t.log.push({ at: l.at, by: sid(l.user_id), type: l.type, ...d });
  }
  return [...tmap.values()];
}
const mapNotif = n => { let d = {}; try { d = JSON.parse(n.data); } catch {}
  return { id: sid(n.id), ticket: sid(n.ticket_id), type: n.type, by: sid(n.by_id), at: n.at, read: !!n.read, ...d }; };
function cfgPayload(env, me, users, companies, depts, cats) {
  return {
    me: { id: sid(me.id), name: me.name, username: me.username, isAdmin: me.isAdmin },
    email: emailConfig(env).ok,
    users: users.results.map(u => ({ id: sid(u.id), username: u.username, name: u.full_name, role: u.role, active: !!u.active, department: sid(u.department_id),
      // имейлът на колегите се вижда само от администратора
      ...(me.isAdmin || u.id === me.id ? { email: u.email || "", notify: !!u.notify } : {}) })),
    departments: depts.results.map(d => ({ id: sid(d.id), name: d.name, form: d.form === "repair" ? "repair" : "standard", categories: cats.results.filter(c => c.department_id === d.id).map(c => c.name) })),
    companies: companies.results.map(c => ({ ...c, id: sid(c.id) })),
    maxUsers: maxUsers(env),
  };
}

const needAdmin = me => { if (!me.isAdmin) fail("Само администратор може да прави това.", 403); };

async function log(env, ticketId, userId, type, dataObj, at) {
  return env.DB.prepare("INSERT INTO ticket_log (ticket_id, user_id, at, type, data) VALUES (?, ?, ?, ?, ?)")
    .bind(ticketId, userId, at, type, JSON.stringify(dataObj || {}));
}
async function activeUserId(env, id) {
  if (!id) return null;
  const r = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND active = 1").bind(parseInt(id, 10) || 0).first();
  if (!r) fail("Избраният служител не е активен потребител.");
  return r.id;
}
async function companyId(env, id) {
  if (!id) return null;
  const r = await env.DB.prepare("SELECT id FROM companies WHERE id = ?").bind(parseInt(id, 10) || 0).first();
  if (!r) fail("Избраната компания не съществува.");
  return r.id;
}
async function deptId(env, id) {
  if (!id) return null;
  const r = await env.DB.prepare("SELECT id FROM departments WHERE id = ?").bind(parseInt(id, 10) || 0).first();
  if (!r) fail("Избраният отдел не съществува.");
  return r.id;
}
async function deptName(env, id) {
  if (!id) return "";
  const r = await env.DB.prepare("SELECT name FROM departments WHERE id = ?").bind(id).first();
  return r ? r.name : "";
}
async function userDept(env, uid) {
  if (!uid) return null;
  const r = await env.DB.prepare("SELECT department_id FROM users WHERE id = ?").bind(uid).first();
  return r ? r.department_id : null;
}
async function validCategory(env, dept, cat) {
  cat = str(cat, 80);
  if (!dept) return cat || "Друго";
  const rows = (await env.DB.prepare("SELECT name FROM categories WHERE department_id = ?").bind(dept).all()).results.map(r => r.name);
  if (!rows.length) return cat || "Друго";
  return rows.includes(cat) ? cat : fail("Изберете категория от списъка на отдела.");
}
async function companyName(env, id) {
  if (!id) return "";
  const r = await env.DB.prepare("SELECT name FROM companies WHERE id = ?").bind(id).first();
  return r ? r.name : "";
}

const ROUTES = {
  /* ---------- setup & login ---------- */
  "GET setup-status": async ({ env }) => json({ needed: (await userCount(env)) === 0, codeRequired: true, codeConfigured: !!env.SETUP_CODE }),

  "POST setup": async ({ env, body, request }) => {
    if (!env.SETUP_CODE) fail("Първо задайте променливата SETUP_CODE в Cloudflare (Settings → Variables and Secrets) и направете нов deploy.");
    await ensureSchema(env);
    if ((await userCount(env)) > 0) fail("Системата вече е настроена.", 409);
    if (str(body.code, 200) !== env.SETUP_CODE) fail("Грешен код за настройка.", 403);
    const username = str(body.username, 50), name = str(body.name, 100), pass = String(body.password || "");
    if (!validUsername(username)) fail("Потребителското име трябва да е 3–50 знака: латински букви, цифри, точка, тире или долна черта.");
    if (!name) fail("Въведете вашето име.");
    if (pass.length < 8) fail("Паролата трябва да е поне 8 знака.");
    const r = await env.DB.prepare("INSERT INTO users (username, full_name, pass, role, active, created_at) VALUES (?, ?, ?, 'admin', 1, ?)")
      .bind(username, name, await hashPassword(pass), nowIso()).run();
    return json({ ok: true }, 200, { "Set-Cookie": await createSession(env, r.meta.last_row_id) });
  },

  "POST login": async ({ env, body, request }) => {
    const username = str(body.username, 50), pass = String(body.password || "");
    const ip = clientIp(request), now = Date.now(), since = now - 15 * 60 * 1000;
    await env.DB.prepare("DELETE FROM login_attempts WHERE at < ?").bind(now - 24 * 3600 * 1000).run();
    const fails = (await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE (username = ? OR ip = ?) AND at > ?").bind(username.toLowerCase(), ip, since).first()).n;
    if (fails >= LOGIN_MAX_FAILS) fail("Твърде много грешни опити. Изчакайте 15 минути и опитайте отново.", 429);
    if (!username || !pass) fail("Въведете потребителско име и парола.");
    const u = await env.DB.prepare("SELECT id, pass, active FROM users WHERE username = ?").bind(username).first();
    const ok = u ? (await verifyPassword(pass, u.pass)) && u.active : await dummyVerify(pass);
    if (!ok) {
      await env.DB.prepare("INSERT INTO login_attempts (username, ip, at) VALUES (?, ?, ?)").bind(username.toLowerCase(), ip, now).run();
      fail("Грешно потребителско име или парола.", 401);
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username.toLowerCase()).run();
    await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
    return json({ ok: true }, 200, { "Set-Cookie": await createSession(env, u.id) });
  },

  "POST logout": async ({ env, me }) => {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(me.tokenHash).run();
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  },

  /* ---------- read everything the page needs ---------- */
  // Пълно зареждане – само при отваряне на страницата
  "GET state": async ({ env, me }) => {
    const [users, companies, tickets, logs, depts, cats, files, notifs, cur] = await env.DB.batch([
      env.DB.prepare("SELECT id, username, full_name, role, active, department_id, email, notify FROM users ORDER BY id"),
      env.DB.prepare("SELECT * FROM companies ORDER BY name COLLATE NOCASE"),
      env.DB.prepare("SELECT * FROM tickets"),
      env.DB.prepare("SELECT ticket_id, user_id, at, type, data FROM ticket_log ORDER BY at, id"),
      env.DB.prepare("SELECT id, name, form FROM departments ORDER BY name COLLATE NOCASE"),
      env.DB.prepare("SELECT department_id, name FROM categories ORDER BY sort, id"),
      env.DB.prepare("SELECT id, ticket_id, name, type, size, user_id, at FROM files ORDER BY at, id"),
      env.DB.prepare("SELECT id, ticket_id, type, by_id, data, at, read FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50").bind(me.id),
      cursorStmt(env, me),
    ]);
    return json({
      ...cfgPayload(env, me, users, companies, depts, cats),
      tickets: mapTickets(tickets.results, logs.results, files.results),
      notifications: notifs.results.map(mapNotif),
      cursor: cursorOf(cur.results[0]),
    });
  },

  // Бърза проверка за промени (на всеки 15 сек). Чете само новите редове, не цялата база.
  "GET sync": async ({ env, me, request }) => {
    const q = new URL(request.url).searchParams, n = k => parseInt(q.get(k), 10) || 0;
    const [cur, changed, gone, notifs] = await env.DB.batch([
      cursorStmt(env, me),
      // по първичния ключ – чете само новите записи (DISTINCT би обходил цялата таблица)
      env.DB.prepare("SELECT ticket_id FROM ticket_log WHERE id > ? ORDER BY id LIMIT 1001").bind(n("log")),
      env.DB.prepare("SELECT ref_id FROM tombstones WHERE id > ? AND kind = 'ticket'").bind(n("tomb")),
      env.DB.prepare("SELECT id, ticket_id, type, by_id, data, at, read FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT 50").bind(me.id, n("notif")),
    ]);
    const c = cursorOf(cur.results[0]);
    const ids = [...new Set(changed.results.map(r => r.ticket_id))];
    if (changed.results.length > 1000 || ids.length > 300) return json({ full: true });          // много промени наведнъж (напр. импорт) – пълно зареждане
    const out = { cursor: c, deleted: gone.results.map(r => sid(r.ref_id)), notifications: notifs.results.map(mapNotif), tickets: [] };
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      const [t, l, f] = await env.DB.batch([
        env.DB.prepare(`SELECT * FROM tickets WHERE id IN (${ph})`).bind(...ids),
        env.DB.prepare(`SELECT ticket_id, user_id, at, type, data FROM ticket_log WHERE ticket_id IN (${ph}) ORDER BY at, id`).bind(...ids),
        env.DB.prepare(`SELECT id, ticket_id, name, type, size, user_id, at FROM files WHERE ticket_id IN (${ph}) ORDER BY at, id`).bind(...ids),
      ]);
      out.tickets = mapTickets(t.results, l.results, f.results);
    }
    if (String(q.get("cfg") || "") !== c.cfg) {
      const [users, companies, depts, cats] = await env.DB.batch([
        env.DB.prepare("SELECT id, username, full_name, role, active, department_id, email, notify FROM users ORDER BY id"),
        env.DB.prepare("SELECT * FROM companies ORDER BY name COLLATE NOCASE"),
        env.DB.prepare("SELECT id, name, form FROM departments ORDER BY name COLLATE NOCASE"),
        env.DB.prepare("SELECT department_id, name FROM categories ORDER BY sort, id"),
      ]);
      Object.assign(out, cfgPayload(env, me, users, companies, depts, cats));
    }
    return json(out);
  },

  /* ---------- tickets ---------- */
  "POST tickets/save": async ({ env, me, body, later, origin }) => {
    const now = nowIso();
    const id = parseInt(body.id, 10) || 0;
    let comp = await companyId(env, body.company);
    const dept = await deptId(env, body.department);
    const old = id ? await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first() : null;
    if (id && !old) fail("Тикетът не съществува.", 404);
    // Видът се определя при създаване от бланката на отдела и после не се сменя
    let kind = old ? (old.kind || "ticket") : "ticket";
    if (!old && dept) kind = (await env.DB.prepare("SELECT form FROM departments WHERE id = ?").bind(dept).first())?.form === "repair" ? "repair" : "ticket";
    const f = {
      priority: [1, 2, 3, 4].includes(Number(body.priority)) ? Number(body.priority) : 2,
      client_name: "", product: "", serial: "", replaced: null, new_serial: "", site: "", issued: 0, issue_doc: "",
    };
    if (kind === "repair" && old && !me.isAdmin) {
      // Данните от приемането са заключени – само администратор може да ги поправи
      comp = old.company_id || null;
      Object.assign(body, { clientName: old.client_name, product: old.product, serial: old.serial, description: old.description, invoiceDate: old.invoice_date,
        replaced: old.replaced ? "yes" : "no" });
    }
    if (kind === "repair") {
      Object.assign(f, {
        client_name: comp ? "" : str(body.clientName, 160), product: str(body.product, 120), serial: str(body.serial, 80),
        description: str(body.description, 10000), new_serial: str(body.newSerial, 80), category: "Ремонт",
        status: REPAIR_STATUSES.includes(body.status) ? body.status : "s1300",
      });
      if (!comp && !f.client_name) fail("Изберете компания или напишете името на клиента.");
      if (!f.product || !f.serial) fail("Попълнете продукт и сериен номер.");
      if (!f.description) fail("Опишете повредата.");
      if (!["yes", "no"].includes(body.replaced)) fail("Изберете дали е за замяна: Да или Не.");
      f.replaced = body.replaced === "yes" ? 1 : 0;
      // Само операциите от процедурата за избрания вид; новият ремонт винаги започва с 1300
      const path = REPAIR_PATH[f.replaced ? "yes" : "no"];
      if (!old) f.status = "s0";
      else if (!path.includes(f.status) && f.status !== old.status)
        fail(f.replaced ? "При замяна операциите са Регистриран → 1300 → 3301 → 3400 → 1401." : "Без замяна операциите са Регистриран → 1300 → 3400 → 1400 → 3300.");
      // Документ № към складовата операция (при смяна на статуса); за 3301 е задължителен
      f.status_doc = old ? str(body.statusDoc, 60) : "";
      f.issued = old ? (old.issued || 0) : 0; f.issue_doc = old ? (old.issue_doc || "") : "";
      if (!old || !body.newSerial) f.new_serial = old ? (old.new_serial || "") : "";
      if (f.status === "s3301" && (!old || old.status !== "s3301")) {
        if (!f.status_doc) fail("Напишете номера на документа за изписване на новото/заместващото у-во (операция 3301).");
        f.issued = 1; f.issue_doc = f.status_doc; f.new_serial = str(body.newSerial, 80);
      }
      f.title = `${f.product} · SN ${f.serial}`.slice(0, 140);
    } else {
      Object.assign(f, {
        title: str(body.title, 140), description: str(body.description, 10000), site: str(body.site, 160),
        status: STATUSES.includes(body.status) ? body.status : "new",
      });
      if (!f.title || !f.description) fail("Попълнете заглавие и описание на проблема.");
      f.category = await validCategory(env, dept, body.category);
    }

    if (!id) {
      const asg = await activeUserId(env, body.assignee);
      const r = await env.DB.prepare("INSERT INTO tickets (title, description, company_id, site, department_id, category, priority, status, reporter_id, assignee_id, created_at, updated_at, kind, client_name, product, serial, replaced, new_serial, issued, issue_doc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(f.title, f.description, comp, f.site, dept, f.category, f.priority, f.status, me.id, asg, now, now, kind, f.client_name, f.product, f.serial, f.replaced, f.new_serial, f.issued, f.issue_doc).run();
      const tid = r.meta.last_row_id;
      const stm = [await log(env, tid, me.id, "create", kind === "repair" ? { status: f.status, doc: f.status_doc || "" } : {}, now)];
      if (kind === "repair" && dateOnly(body.invoiceDate)) stm.push(env.DB.prepare("UPDATE tickets SET invoice_date = ? WHERE id = ?").bind(dateOnly(body.invoiceDate), tid));
      if (asg && asg !== me.id) stm.push(await log(env, tid, me.id, "transfer", { from: "", to: sid(asg), reason: str(body.reason, 1000) }, now));
      else if (asg) stm.push(await log(env, tid, me.id, "take", {}, now));
      await env.DB.batch(stm);
      if (asg && asg !== me.id) await notifyStmt(env, asg, tid, "assigned", me.id, {}, now).run();
      if (asg && asg !== me.id) later(notifyAssigned(env, origin, { ticketId: tid, toUserId: asg, byName: me.name, reason: str(body.reason, 1000) }));
      return json({ ok: true, id: sid(tid) });
    }

    const stm = [];
    // Изпращане към Риека: датата на изпращане (по подразбиране днес); може да се поправя, докато чака връщане
    let sent = old.sent_date || "";
    if (kind === "repair" && f.status === "s3400" && old.status !== "s3400") sent = dateOnly(body.sentDate) || now.slice(0, 10);
    else if (kind === "repair" && f.status === "s3400" && dateOnly(body.sentDate) && dateOnly(body.sentDate) !== sent) {
      stm.push(await log(env, id, me.id, "edit", { fields: [{ f: "sent_date", l: "Дата на изпращане към Риека", from: bgDate(sent), to: bgDate(dateOnly(body.sentDate)) }] }, now));
      sent = dateOnly(body.sentDate);
    }
    if (sent !== (old.sent_date || "")) stm.push(env.DB.prepare("UPDATE tickets SET sent_date = ? WHERE id = ?").bind(sent, id));
    if (old.status !== f.status) stm.push(await log(env, id, me.id, "status", { from: old.status, to: f.status, ...(f.status_doc ? { doc: f.status_doc } : {}), ...(f.status === "s3301" && f.new_serial ? { sn: f.new_serial } : {}), ...(f.status === "s3400" && old.status !== "s3400" ? { sent } : {}) }, now));
    if (old.priority !== f.priority) stm.push(await log(env, id, me.id, "prio", { from: old.priority, to: f.priority }, now));
    const fields = [];
    const FIELDS = kind === "repair"
      ? [["product", "Продукт"], ["serial", "Сериен номер"], ["description", "Описание"], ["client_name", "Клиент"], ["new_serial", "Нов сериен номер"], ["issue_doc", "Документ №"]]
      : [["title", "Заглавие"], ["description", "Описание"], ["site", "Обект"], ["category", "Категория"]];
    for (const [k, l] of FIELDS)
      if ((old[k] || "") !== (f[k] || "")) fields.push({ f: k, l, from: old[k] || "", to: f[k] || "" });
    if (kind === "repair" && (old.replaced ?? null) !== f.replaced) {
      const yn = v => v === null || v === undefined ? "—" : (v ? "Да" : "Не");
      fields.push({ f: "replaced", l: "За замяна", from: yn(old.replaced), to: yn(f.replaced) });
    }
    const inv = kind === "repair" ? dateOnly(body.invoiceDate) : (old.invoice_date || "");
    if (kind === "repair" && (old.invoice_date || "") !== inv) {
      fields.push({ f: "invoice_date", l: "Дата по фактура", from: bgDate(old.invoice_date), to: bgDate(inv) });
      stm.push(env.DB.prepare("UPDATE tickets SET invoice_date = ? WHERE id = ?").bind(inv, id));
    }
    if (kind === "repair" && !!old.issued !== !!f.issued)
      fields.push({ f: "issued", l: "Изписано ново/заместващо към клиента", from: old.issued ? "Да" : "Не", to: f.issued ? `Да${f.issue_doc ? ", документ № " + f.issue_doc : ""}` : "Не" });
    if ((old.department_id || null) !== dept)
      fields.push({ f: "department", l: "Отдел", from: await deptName(env, old.department_id), to: await deptName(env, dept) });
    if ((old.company_id || null) !== comp)
      fields.push({ f: "company", l: "Компания", from: await companyName(env, old.company_id), to: await companyName(env, comp) });
    // При операция 3301 документът и новият SN вече са в записа за статуса – не ги дублираме
    if (kind === "repair" && f.status === "s3301" && old.status !== "s3301")
      for (let i = fields.length - 1; i >= 0; i--) if (["issue_doc", "new_serial", "issued"].includes(fields[i].f)) fields.splice(i, 1);
    if (fields.length) stm.push(await log(env, id, me.id, "edit", { fields }, now));
    if (!stm.length) return json({ ok: true, id: sid(id), unchanged: true });
    stm.push(env.DB.prepare("UPDATE tickets SET title=?, description=?, company_id=?, site=?, department_id=?, category=?, priority=?, status=?, client_name=?, product=?, serial=?, replaced=?, new_serial=?, issued=?, issue_doc=?, updated_at=? WHERE id=?")
      .bind(f.title, f.description, comp, f.site, dept, f.category, f.priority, f.status, f.client_name, f.product, f.serial, f.replaced, f.new_serial, f.issued, f.issue_doc, now, id));
    await env.DB.batch(stm);
    return json({ ok: true, id: sid(id) });
  },

  // Прехвърляне / насочване към служител (или поемане от мен)
  "POST tickets/transfer": async ({ env, me, body, later, origin }) => {
    const id = parseInt(body.id, 10) || 0;
    const old = await env.DB.prepare("SELECT assignee_id, department_id FROM tickets WHERE id = ?").bind(id).first();
    if (!old) fail("Тикетът не съществува.", 404);
    // to: "u:<id>" – служител, "d:<id>" – отдел без конкретен човек, "" – общите на същия отдел
    const raw = String(body.to || "");
    let to = null, dept = old.department_id || null;
    if (raw.startsWith("u:")) { to = await activeUserId(env, raw.slice(2)); dept = (await userDept(env, to)) || dept; }
    else if (raw.startsWith("d:")) dept = await deptId(env, raw.slice(2));
    else if (raw) fail("Изберете към кого да се прехвърли.");
    if ((old.assignee_id || null) === to && (old.department_id || null) === dept) fail("Тикетът вече е там.");
    const now = nowIso(), reason = str(body.reason, 1000);
    const type = to === me.id ? "take" : (to ? "transfer" : "unassign");
    const d = { from: sid(old.assignee_id), to: sid(to), reason };
    if ((old.department_id || null) !== dept) { d.fromDept = await deptName(env, old.department_id); d.toDept = await deptName(env, dept); }
    // Ако новият отдел няма категорията на тикета, тя остава – вижда се в историята и може да се смени ръчно
    const stm = [
      await log(env, id, me.id, type, d, now),
      env.DB.prepare("UPDATE tickets SET assignee_id = ?, department_id = ?, updated_at = ? WHERE id = ?").bind(to, dept, now, id),
    ];
    await env.DB.batch(stm);
    if (to && to !== me.id) await notifyStmt(env, to, id, old.assignee_id ? "transferred" : "assigned", me.id, reason ? { reason } : {}, now).run();
    if (to && to !== me.id) later(notifyAssigned(env, origin, { ticketId: id, toUserId: to, byName: me.name, reason, transferred: !!old.assignee_id }));
    return json({ ok: true });
  },

  "POST tickets/note": async ({ env, me, body }) => {
    const id = parseInt(body.id, 10) || 0, text = str(body.text, 5000);
    if (!text) fail("Напишете бележката първо.");
    const now = nowIso();
    const r = await env.DB.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").bind(now, id).run();
    if (!r.meta.changes) fail("Тикетът не съществува.", 404);
    const t = await env.DB.prepare("SELECT assignee_id FROM tickets WHERE id = ?").bind(id).first();
    const stm = [await log(env, id, me.id, "note", { text }, now)];
    // Отговорникът научава за бележка от колега
    if (t.assignee_id && t.assignee_id !== me.id) stm.push(notifyStmt(env, t.assignee_id, id, "note", me.id, { text: text.slice(0, 140) }, now));
    await env.DB.batch(stm);
    return json({ ok: true });
  },

  "POST tickets/delete": async ({ env, me, body }) => {
    const id = parseInt(body.id, 10) || 0;
    const t = await env.DB.prepare("SELECT reporter_id FROM tickets WHERE id = ?").bind(id).first();
    if (!t) fail("Тикетът не съществува.", 404);
    if (!me.isAdmin && t.reporter_id !== me.id) fail("Само подалият тикета или администратор може да го изтрие.", 403);
    await env.DB.batch([env.DB.prepare("DELETE FROM ticket_log WHERE ticket_id = ?").bind(id),
      env.DB.prepare("DELETE FROM file_chunks WHERE file_id IN (SELECT id FROM files WHERE ticket_id = ?)").bind(id),
      env.DB.prepare("DELETE FROM files WHERE ticket_id = ?").bind(id), env.DB.prepare("DELETE FROM notifications WHERE ticket_id = ?").bind(id),
      env.DB.prepare("DELETE FROM tickets WHERE id = ?").bind(id),
      env.DB.prepare("INSERT INTO tombstones (kind, ref_id, at) VALUES ('ticket', ?, ?)").bind(id, nowIso())]);
    return json({ ok: true });
  },

  "POST files/delete": async ({ env, me, body }) => {
    const fid = parseInt(body.id, 10) || 0;
    const f = await env.DB.prepare("SELECT ticket_id, name, user_id FROM files WHERE id = ?").bind(fid).first();
    if (!f) fail("Файлът не съществува.", 404);
    if (!me.isAdmin && f.user_id !== me.id) fail("Само качилият файла или администратор може да го изтрие.", 403);
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM file_chunks WHERE file_id = ?").bind(fid), env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fid),
      await log(env, f.ticket_id, me.id, "filedel", { name: f.name }, now),
      env.DB.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").bind(now, f.ticket_id),
    ]);
    return json({ ok: true });
  },

  /* ---------- companies ---------- */
  "POST companies/save": async ({ env, body }) => {
    const c = {};
    for (const [k, max] of [["name", 160], ["eik", 20], ["vat", 20], ["address", 250], ["city", 80], ["contact_person", 120], ["phone", 60], ["email", 120], ["sites", 4000], ["contract", 200], ["notes", 5000]]) c[k] = str(body[k], max);
    if (!c.name) fail("Въведете името на компанията.");
    if (c.eik && !/^\d{9}(\d{4})?$/.test(c.eik)) fail("ЕИК трябва да е 9 или 13 цифри.");
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) fail("Имейлът не изглежда правилен.");
    const id = parseInt(body.id, 10) || 0, now = nowIso();
    const dup = await env.DB.prepare("SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND id <> ?").bind(c.name, id).first();
    if (dup) fail("Вече има компания с това име.");
    const keys = Object.keys(c);
    if (id) {
      const r = await env.DB.prepare(`UPDATE companies SET ${keys.map(k => k + "=?").join(", ")}, updated_at=? WHERE id=?`).bind(...keys.map(k => c[k]), now, id).run();
      if (!r.meta.changes) fail("Компанията не съществува.", 404);
      await bumpCfg(env).run();
    return json({ ok: true, id: sid(id) });
    }
    const r = await env.DB.prepare(`INSERT INTO companies (${keys.join(", ")}, created_at, updated_at) VALUES (${keys.map(() => "?").join(", ")}, ?, ?)`).bind(...keys.map(k => c[k]), now, now).run();
    await bumpCfg(env).run();
    return json({ ok: true, id: sid(r.meta.last_row_id) });
  },

  "POST companies/delete": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0;
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE company_id = ?").bind(id).first()).n;
    if (n) fail(`Компанията има ${n} тикета и не може да се изтрие.`);
    await env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(id).run();
    await bumpCfg(env).run();
    return json({ ok: true });
  },

  /* ---------- departments ---------- */
  "POST departments/save": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0, name = str(body.name, 80);
    const form = body.form === "repair" ? "repair" : "standard";
    if (!name) fail("Въведете име на отдела.");
    const cats = [...new Set((Array.isArray(body.categories) ? body.categories : []).map(c => str(c, 80)).filter(Boolean))].slice(0, 50);
    if (await env.DB.prepare("SELECT id FROM departments WHERE name = ? COLLATE NOCASE AND id <> ?").bind(name, id).first()) fail("Вече има отдел с това име.");
    let did = id;
    if (id) {
      const r = await env.DB.prepare("UPDATE departments SET name = ?, form = ? WHERE id = ?").bind(name, form, id).run();
      if (!r.meta.changes) fail("Отделът не съществува.", 404);
    } else {
      did = (await env.DB.prepare("INSERT INTO departments (name, created_at, form) VALUES (?, ?, ?)").bind(name, nowIso(), form).run()).meta.last_row_id;
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM categories WHERE department_id = ?").bind(did),
      ...cats.map((c, i) => env.DB.prepare("INSERT INTO categories (department_id, name, sort) VALUES (?, ?, ?)").bind(did, c, i)),
    ]);
    await bumpCfg(env).run();
    return json({ ok: true, id: sid(did) });
  },

  "POST departments/delete": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0;
    const t = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE department_id = ?").bind(id).first()).n;
    const u = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE department_id = ?").bind(id).first()).n;
    if (t || u) fail(`Отделът има ${t} тикета и ${u} служители. Първо ги преместете в друг отдел.`);
    await env.DB.batch([env.DB.prepare("DELETE FROM categories WHERE department_id = ?").bind(id), env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(id)]);
    await bumpCfg(env).run();
    return json({ ok: true });
  },

  /* ---------- users ---------- */
  "POST users/save": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0;
    const username = str(body.username, 50), name = str(body.name, 100);
    const role = body.role === "admin" ? "admin" : "user", active = body.active ? 1 : 0, pass = String(body.password || "");
    const dept = await deptId(env, body.department);
    const email = str(body.email, 160);
    if (!validEmail(email)) fail("Имейлът не изглежда правилен.");
    if (!validUsername(username)) fail("Потребителското име трябва да е 3–50 знака: латински букви, цифри, точка, тире или долна черта.");
    if (!name) fail("Въведете име.");
    if ((!id || pass) && pass.length < 8) fail("Паролата трябва да е поне 8 знака.");
    if (id === me.id && (!active || role !== "admin")) fail("Не можете да деактивирате или да махнете администраторските права на себе си.");
    if (await env.DB.prepare("SELECT id FROM users WHERE username = ? AND id <> ?").bind(username, id).first()) fail("Това потребителско име вече е заето.");
    if (active) {
      const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND id <> ?").bind(id).first()).n;
      if (n >= maxUsers(env)) fail(`Вече има ${maxUsers(env)} активни потребители. Деактивирайте някого, за да освободите място.`);
    }
    if (id) {
      const stm = [env.DB.prepare("UPDATE users SET username=?, full_name=?, role=?, active=?, department_id=?, email=? WHERE id=?").bind(username, name, role, active, dept, email, id)];
      if (pass) stm.push(env.DB.prepare("UPDATE users SET pass=? WHERE id=?").bind(await hashPassword(pass), id));
      if (pass || !active) stm.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id)); // изхвърля го от всички устройства
      await env.DB.batch(stm);
    } else {
      await env.DB.prepare("INSERT INTO users (username, full_name, pass, role, active, created_at, department_id, email) VALUES (?,?,?,?,?,?,?,?)")
        .bind(username, name, await hashPassword(pass), role, active, nowIso(), dept, email).run();
    }
    await bumpCfg(env).run();
    return json({ ok: true });
  },

  // Импорт на стари ремонти от таблица (Excel/CSV). Страницата чете файла и праща редовете на порции по 10.
  "POST import/repairs": async ({ env, me, body }) => {
    needAdmin(me);
    const dept = await deptId(env, body.department);
    if (!dept) fail("Изберете отдел за ремонтите.");
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 10) : [];
    const comps = (await env.DB.prepare("SELECT id, name FROM companies").all()).results;
    const compBy = new Map(comps.map(c => [c.name.trim().toLowerCase(), c.id]));
    const toIso = v => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z"); };
    // ключ за повторно качване: SN + дата, а без SN – продукт + клиент + дата
    const keyOf = (serial, product, client, at) => (serial ? `sn|${serial}` : `p|${product}|${client}`).toLowerCase() + "|" + at.slice(0, 10);
    const serials = rows.map(r => str(r.serial, 80)).filter(Boolean);
    const products = rows.filter(r => !str(r.serial, 80)).map(r => str(r.product, 120)).filter(Boolean);
    const existing = [];
    if (serials.length) existing.push(...(await env.DB.prepare(`SELECT serial, product, client_name, company_id, created_at FROM tickets WHERE kind = 'repair' AND serial IN (${serials.map(() => "?").join(",")})`).bind(...serials).all()).results);
    if (products.length) existing.push(...(await env.DB.prepare(`SELECT serial, product, client_name, company_id, created_at FROM tickets WHERE kind = 'repair' AND serial = '' AND product IN (${products.map(() => "?").join(",")})`).bind(...products).all()).results);
    const compName = new Map(comps.map(c => [c.id, c.name]));
    const seen = new Set(existing.map(e => keyOf(e.serial, e.product, e.company_id ? compName.get(e.company_id) || "" : e.client_name, e.created_at)));
    const res = { created: 0, skipped: 0, errors: [] };
    const YES_ONLY = ["s3301", "s1401"], NO_ONLY = ["s1400", "s3300"];
    for (const [i, r] of rows.entries()) {
      const line = r.line || i + 1;
      const product = str(r.product, 120), serial = str(r.serial, 80), client = str(r.client, 160);
      if (!product) { res.errors.push(`Ред ${line}: липсва продукт.`); continue; }
      const at = toIso(r.date) || nowIso();
      const companyId = client ? (compBy.get(client.toLowerCase()) || null) : null;
      const key = keyOf(serial, product, companyId ? compName.get(companyId) : client, at);
      if (seen.has(key)) { res.skipped++; continue; }
      seen.add(key);
      // Операциите: или списък от извършени (колони 1300/3400/… от старата таблица), или един статус
      const ops = Array.isArray(r.ops) ? r.ops.filter(o => REPAIR_STATUSES.includes(o.k) && o.k !== "s0") : null;
      let replaced = r.replaced === "yes" ? 1 : 0;
      if (ops) { if (ops.some(o => YES_ONLY.includes(o.k))) replaced = 1; else if (ops.some(o => NO_ONLY.includes(o.k))) replaced = 0; }
      let status;
      if (ops) {
        const path = REPAIR_PATH[replaced ? "yes" : "no"];
        status = "s0";
        for (const k of path) if (ops.some(o => o.k === k)) status = k;   // последната извършена по реда на процедурата
      } else {
        status = REPAIR_STATUSES.includes(r.status) ? r.status : "s1300";
        if (YES_ONLY.includes(status)) replaced = 1;
        if (NO_ONLY.includes(status)) replaced = 0;
      }
      const path = REPAIR_PATH[replaced ? "yes" : "no"];
      const doc = str(r.doc, 60), newSerial = replaced ? str(r.newSerial, 80) : "";
      const issued = replaced && (ops ? ops.some(o => o.k === "s3301") : path.indexOf(status) >= path.indexOf("s3301")) ? 1 : 0;
      const fault = str(r.fault, 10000) || "(няма описание в старата таблица)";
      const ins = await env.DB.prepare(`INSERT INTO tickets (title, description, company_id, site, department_id, category, priority, status, reporter_id, assignee_id,
          created_at, updated_at, kind, client_name, product, serial, replaced, new_serial, issued, issue_doc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(`${product}${serial ? " · SN " + serial : " · без SN"}`.slice(0, 140), fault, companyId, "", dept, "Ремонт", 2, status, me.id, null, at, at, "repair",
          companyId ? "" : (client || "(без клиент)"), product, serial, replaced, newSerial, issued, issued && status === "s3301" ? doc : "").run();
      const tid = ins.meta.last_row_id;
      const stm = [await log(env, tid, me.id, "create", { status: "s0", imported: true }, at)];
      stm.push(await log(env, tid, me.id, "import", { status, doc, line, file: str(body.file, 120) }, at));
      if (dateOnly(r.invoiceDate)) stm.push(env.DB.prepare("UPDATE tickets SET invoice_date = ? WHERE id = ?").bind(dateOnly(r.invoiceDate), tid));
      if (ops) {
        // история на операциите с датите от таблицата, по реда на процедурата
        let prev = "s0", last = at;
        for (const k of path) {
          const o = ops.find(x => x.k === k); if (!o) continue;
          const when = toIso(o.at); last = when && when > last ? when : last;
          stm.push(await log(env, tid, me.id, "status", { from: prev, to: k, imported: true }, last));
          if (k === "s3400") stm.push(env.DB.prepare("UPDATE tickets SET sent_date = ? WHERE id = ?").bind(last.slice(0, 10), tid));
          prev = k;
        }
        if (last !== at) stm.push(env.DB.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").bind(last, tid));
      }
      const note = str(r.note, 5000);
      if (note) stm.push(await log(env, tid, me.id, "note", { text: note }, at));
      await env.DB.batch(stm);
      res.created++;
    }
    return json(res);
  },

  "POST notifications/read": async ({ env, me, body }) => {
    if (body.all) await env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").bind(me.id).run();
    else {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(x => parseInt(x, 10)).filter(Boolean).slice(0, 100);
      if (ids.length) await env.DB.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(me.id, ...ids).run();
    }
    // старите прочетени известия се чистят след 60 дни
    await env.DB.prepare("DELETE FROM notifications WHERE read = 1 AND at < ?").bind(new Date(Date.now() - 60 * 864e5).toISOString()).run();
    return json({ ok: true });
  },

  "POST me/profile": async ({ env, me, body }) => {
    const email = str(body.email, 160);
    if (!validEmail(email)) fail("Имейлът не изглежда правилен.");
    await env.DB.prepare("UPDATE users SET email = ?, notify = ? WHERE id = ?").bind(email, body.notify ? 1 : 0, me.id).run();
    await bumpCfg(env).run();
    return json({ ok: true });
  },

  "GET email-status": async ({ env, me }) => {
    needAdmin(me);
    const c = emailConfig(env);
    const m = k => env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first().then(r => r ? r.v : "");
    return json({ configured: c.ok, provider: c.provider, from: c.from, lastOk: await m("email_last_ok"), lastError: await m("email_last_error") });
  },

  "POST email-test": async ({ env, me }) => {
    needAdmin(me);
    const u = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(me.id).first();
    if (!u.email) fail("Първо запишете своя имейл (бутона с вашето име горе вдясно).");
    try {
      await sendMail(env, { to: { email: u.email, name: me.name }, subject: "Пробен имейл от Сервизни тикети",
        html: `<p>Здравейте, ${me.name.replace(/[<>&]/g, "")}!</p><p>Имейл известията работят.</p>`, text: `Здравейте, ${me.name}!\n\nИмейл известията работят.` });
    } catch (e) { fail("Имейлът не беше изпратен: " + e.message); }
    return json({ ok: true, to: u.email });
  },

  "POST me/password": async ({ env, me, body }) => {
    const u = await env.DB.prepare("SELECT pass FROM users WHERE id = ?").bind(me.id).first();
    if (!(await verifyPassword(String(body.old || ""), u.pass))) fail("Текущата парола е грешна.");
    const n = String(body.new || "");
    if (n.length < 8) fail("Новата парола трябва да е поне 8 знака.");
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass = ? WHERE id = ?").bind(await hashPassword(n), me.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(me.id, me.tokenHash),
    ]);
    return json({ ok: true });
  },

  /* ---------- export ---------- */
  "GET export": async ({ env }) => {
    const [users, comps, tickets, logs, depts] = await env.DB.batch([
      env.DB.prepare("SELECT id, full_name FROM users"), env.DB.prepare("SELECT id, name FROM companies"),
      env.DB.prepare("SELECT * FROM tickets ORDER BY id"), env.DB.prepare("SELECT ticket_id, user_id, at, type, data FROM ticket_log ORDER BY at, id"),
      env.DB.prepare("SELECT id, name FROM departments"),
    ]);
    const D = Object.fromEntries(depts.results.map(d => [d.id, d.name]));
    const U = Object.fromEntries(users.results.map(u => [u.id, u.full_name]));
    const C = Object.fromEntries(comps.results.map(c => [c.id, c.name]));
    const S = STATUS_LABELS;
    const P = { 4: "Спешен", 3: "Висок", 2: "Среден", 1: "Нисък" };
    const loc = iso => iso ? new Date(iso).toLocaleString("bg-BG", { timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const L = {};
    for (const l of logs.results) {
      let d = {}; try { d = JSON.parse(l.data); } catch {}
      const txt = {
        create: "Създаде тикета", take: "Пое тикета", unassign: d.toDept ? `Насочи към отдел ${d.toDept}${d.reason ? " – " + d.reason : ""}` : "Върна тикета в общите на отдела",
        transfer: `Прехвърли на ${U[d.to] || "?"}${d.toDept ? " (отдел " + d.toDept + ")" : ""}${d.reason ? " – " + d.reason : ""}`,
        status: `Статус: ${S[d.from] || ""} → ${S[d.to] || ""}${d.doc ? ", документ № " + d.doc : ""}`, prio: `Приоритет: ${P[d.from] || ""} → ${P[d.to] || ""}`,
        edit: "Редактира: " + (d.fields || []).map(x => x.l).join(", "), note: "Бележка: " + (d.text || ""),
        file: "Прикачи файл: " + (d.name || ""), filedel: "Изтри файл: " + (d.name || ""),
        import: `Импортиран от стара таблица${d.file ? " " + d.file : ""}, статус ${S[d.status] || ""}${d.doc ? ", документ № " + d.doc : ""}`,
      }[l.type] || "";
      (L[l.ticket_id] ||= []).push(`${loc(l.at)} ${U[l.user_id] || "?"}: ${txt}`);
    }
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["№", "Вид", "Заглавие", "Описание", "Компания / клиент", "Обект", "Продукт", "Сериен №", "Дата по фактура", "Изпратено към Риека", "За замяна", "Нов сериен №", "Изписано ново (3301)", "Документ № 3301", "Отдел", "Категория", "Приоритет", "Статус", "Подал", "Отговорник", "Създаден", "Обновен", "История"].map(q).join(";")];
    for (const t of tickets.results) rows.push([
      "ТК-" + String(t.id).padStart(4, "0"), t.kind === "repair" ? "Ремонт" : "Тикет", t.title, t.description, C[t.company_id] || t.client_name || "", t.site,
      t.product || "", t.serial || "", bgDate(t.invoice_date), bgDate(t.sent_date), t.kind === "repair" ? (t.replaced ? "Да" : "Не") : "", t.new_serial || "", t.kind === "repair" && t.replaced ? (t.issued ? "Да" : "Не") : "", t.issue_doc || "", D[t.department_id] || "", t.category, P[t.priority], S[t.status],
      U[t.reporter_id] || "", t.assignee_id ? U[t.assignee_id] || "" : "Неразпределен", loc(t.created_at), loc(t.updated_at), (L[t.id] || []).join("\n"),
    ].map(q).join(";"));
    const day = new Date().toISOString().slice(0, 10);
    return new Response("﻿" + rows.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tiketi-${day}.csv"`, "Cache-Control": "no-store" } });
  },
};
