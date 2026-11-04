import {
  STATUSES, LOGIN_MAX_FAILS, json, fail, HttpError, nowIso, maxUsers, str, validUsername,
  hashPassword, verifyPassword, dummyVerify, createSession, clearCookie, ensureSchema, userCount, clientIp,
} from "../../lib/server.js";

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
    const body = method === "POST" ? await request.json().catch(() => ({})) : {};
    const route = ROUTES[`${method} ${path}`];
    if (!route) fail("Непознато действие.", 404);
    return await route({ request, env, me: data.user, body });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Грешка на сървъра: " + (e.message || e) }, 500);
  }
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
  "GET state": async ({ env, me }) => {
    const [users, companies, tickets, logs, depts, cats] = await env.DB.batch([
      env.DB.prepare("SELECT id, username, full_name, role, active, department_id FROM users ORDER BY id"),
      env.DB.prepare("SELECT * FROM companies ORDER BY name COLLATE NOCASE"),
      env.DB.prepare("SELECT * FROM tickets"),
      env.DB.prepare("SELECT ticket_id, user_id, at, type, data FROM ticket_log ORDER BY at, id"),
      env.DB.prepare("SELECT id, name FROM departments ORDER BY name COLLATE NOCASE"),
      env.DB.prepare("SELECT department_id, name FROM categories ORDER BY sort, id"),
    ]);
    const tmap = new Map();
    for (const t of tickets.results) tmap.set(t.id, {
      id: sid(t.id), no: t.id, title: t.title, description: t.description, company: sid(t.company_id), site: t.site,
      department: sid(t.department_id), category: t.category, priority: t.priority, status: t.status, reporter: sid(t.reporter_id), assignee: sid(t.assignee_id),
      createdAt: t.created_at, updatedAt: t.updated_at, log: [],
    });
    for (const l of logs.results) {
      const t = tmap.get(l.ticket_id); if (!t) continue;
      let d = {}; try { d = JSON.parse(l.data); } catch {}
      t.log.push({ at: l.at, by: sid(l.user_id), type: l.type, ...d });
    }
    return json({
      me: { id: sid(me.id), name: me.name, username: me.username, isAdmin: me.isAdmin },
      users: users.results.map(u => ({ id: sid(u.id), username: u.username, name: u.full_name, role: u.role, active: !!u.active, department: sid(u.department_id) })),
      departments: depts.results.map(d => ({ id: sid(d.id), name: d.name, categories: cats.results.filter(c => c.department_id === d.id).map(c => c.name) })),
      companies: companies.results.map(c => ({ ...c, id: sid(c.id) })),
      tickets: [...tmap.values()],
      maxUsers: maxUsers(env),
    });
  },

  /* ---------- tickets ---------- */
  "POST tickets/save": async ({ env, me, body }) => {
    const f = {
      title: str(body.title, 140), description: str(body.description, 10000), site: str(body.site, 160),
      priority: [1, 2, 3, 4].includes(Number(body.priority)) ? Number(body.priority) : 2,
      status: STATUSES.includes(body.status) ? body.status : "new",
    };
    if (!f.title || !f.description) fail("Попълнете заглавие и описание на проблема.");
    const now = nowIso();
    const id = parseInt(body.id, 10) || 0;
    const comp = await companyId(env, body.company);
    const dept = await deptId(env, body.department);
    f.category = await validCategory(env, dept, body.category);

    if (!id) {
      const asg = await activeUserId(env, body.assignee);
      const r = await env.DB.prepare("INSERT INTO tickets (title, description, company_id, site, department_id, category, priority, status, reporter_id, assignee_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(f.title, f.description, comp, f.site, dept, f.category, f.priority, f.status, me.id, asg, now, now).run();
      const tid = r.meta.last_row_id;
      const stm = [await log(env, tid, me.id, "create", {}, now)];
      if (asg && asg !== me.id) stm.push(await log(env, tid, me.id, "transfer", { from: "", to: sid(asg), reason: str(body.reason, 1000) }, now));
      else if (asg) stm.push(await log(env, tid, me.id, "take", {}, now));
      await env.DB.batch(stm);
      return json({ ok: true, id: sid(tid) });
    }

    const old = await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first();
    if (!old) fail("Тикетът не съществува.", 404);
    const stm = [];
    if (old.status !== f.status) stm.push(await log(env, id, me.id, "status", { from: old.status, to: f.status }, now));
    if (old.priority !== f.priority) stm.push(await log(env, id, me.id, "prio", { from: old.priority, to: f.priority }, now));
    const fields = [];
    for (const [k, l] of [["title", "Заглавие"], ["description", "Описание"], ["site", "Обект"], ["category", "Категория"]])
      if ((old[k] || "") !== (f[k] || "")) fields.push({ f: k, l, from: old[k] || "", to: f[k] || "" });
    if ((old.department_id || null) !== dept)
      fields.push({ f: "department", l: "Отдел", from: await deptName(env, old.department_id), to: await deptName(env, dept) });
    if ((old.company_id || null) !== comp)
      fields.push({ f: "company", l: "Компания", from: await companyName(env, old.company_id), to: await companyName(env, comp) });
    if (fields.length) stm.push(await log(env, id, me.id, "edit", { fields }, now));
    if (!stm.length) return json({ ok: true, id: sid(id), unchanged: true });
    stm.push(env.DB.prepare("UPDATE tickets SET title=?, description=?, company_id=?, site=?, department_id=?, category=?, priority=?, status=?, updated_at=? WHERE id=?")
      .bind(f.title, f.description, comp, f.site, dept, f.category, f.priority, f.status, now, id));
    await env.DB.batch(stm);
    return json({ ok: true, id: sid(id) });
  },

  // Прехвърляне / насочване към служител (или поемане от мен)
  "POST tickets/transfer": async ({ env, me, body }) => {
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
    return json({ ok: true });
  },

  "POST tickets/note": async ({ env, me, body }) => {
    const id = parseInt(body.id, 10) || 0, text = str(body.text, 5000);
    if (!text) fail("Напишете бележката първо.");
    const now = nowIso();
    const r = await env.DB.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").bind(now, id).run();
    if (!r.meta.changes) fail("Тикетът не съществува.", 404);
    await (await log(env, id, me.id, "note", { text }, now)).run();
    return json({ ok: true });
  },

  "POST tickets/delete": async ({ env, me, body }) => {
    const id = parseInt(body.id, 10) || 0;
    const t = await env.DB.prepare("SELECT reporter_id FROM tickets WHERE id = ?").bind(id).first();
    if (!t) fail("Тикетът не съществува.", 404);
    if (!me.isAdmin && t.reporter_id !== me.id) fail("Само подалият тикета или администратор може да го изтрие.", 403);
    await env.DB.batch([env.DB.prepare("DELETE FROM ticket_log WHERE ticket_id = ?").bind(id), env.DB.prepare("DELETE FROM tickets WHERE id = ?").bind(id)]);
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
      return json({ ok: true, id: sid(id) });
    }
    const r = await env.DB.prepare(`INSERT INTO companies (${keys.join(", ")}, created_at, updated_at) VALUES (${keys.map(() => "?").join(", ")}, ?, ?)`).bind(...keys.map(k => c[k]), now, now).run();
    return json({ ok: true, id: sid(r.meta.last_row_id) });
  },

  "POST companies/delete": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0;
    const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE company_id = ?").bind(id).first()).n;
    if (n) fail(`Компанията има ${n} тикета и не може да се изтрие.`);
    await env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(id).run();
    return json({ ok: true });
  },

  /* ---------- departments ---------- */
  "POST departments/save": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0, name = str(body.name, 80);
    if (!name) fail("Въведете име на отдела.");
    const cats = [...new Set((Array.isArray(body.categories) ? body.categories : []).map(c => str(c, 80)).filter(Boolean))].slice(0, 50);
    if (await env.DB.prepare("SELECT id FROM departments WHERE name = ? COLLATE NOCASE AND id <> ?").bind(name, id).first()) fail("Вече има отдел с това име.");
    let did = id;
    if (id) {
      const r = await env.DB.prepare("UPDATE departments SET name = ? WHERE id = ?").bind(name, id).run();
      if (!r.meta.changes) fail("Отделът не съществува.", 404);
    } else {
      did = (await env.DB.prepare("INSERT INTO departments (name, created_at) VALUES (?, ?)").bind(name, nowIso()).run()).meta.last_row_id;
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM categories WHERE department_id = ?").bind(did),
      ...cats.map((c, i) => env.DB.prepare("INSERT INTO categories (department_id, name, sort) VALUES (?, ?, ?)").bind(did, c, i)),
    ]);
    return json({ ok: true, id: sid(did) });
  },

  "POST departments/delete": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0;
    const t = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE department_id = ?").bind(id).first()).n;
    const u = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE department_id = ?").bind(id).first()).n;
    if (t || u) fail(`Отделът има ${t} тикета и ${u} служители. Първо ги преместете в друг отдел.`);
    await env.DB.batch([env.DB.prepare("DELETE FROM categories WHERE department_id = ?").bind(id), env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(id)]);
    return json({ ok: true });
  },

  /* ---------- users ---------- */
  "POST users/save": async ({ env, me, body }) => {
    needAdmin(me);
    const id = parseInt(body.id, 10) || 0;
    const username = str(body.username, 50), name = str(body.name, 100);
    const role = body.role === "admin" ? "admin" : "user", active = body.active ? 1 : 0, pass = String(body.password || "");
    const dept = await deptId(env, body.department);
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
      const stm = [env.DB.prepare("UPDATE users SET username=?, full_name=?, role=?, active=?, department_id=? WHERE id=?").bind(username, name, role, active, dept, id)];
      if (pass) stm.push(env.DB.prepare("UPDATE users SET pass=? WHERE id=?").bind(await hashPassword(pass), id));
      if (pass || !active) stm.push(env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id)); // изхвърля го от всички устройства
      await env.DB.batch(stm);
    } else {
      await env.DB.prepare("INSERT INTO users (username, full_name, pass, role, active, created_at, department_id) VALUES (?,?,?,?,?,?,?)")
        .bind(username, name, await hashPassword(pass), role, active, nowIso(), dept).run();
    }
    return json({ ok: true });
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
    const S = { new: "Нов", work: "В работа", wait: "Чака клиент", done: "Решен", closed: "Затворен" };
    const P = { 4: "Спешен", 3: "Висок", 2: "Среден", 1: "Нисък" };
    const loc = iso => iso ? new Date(iso).toLocaleString("bg-BG", { timeZone: "Europe/Sofia", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const L = {};
    for (const l of logs.results) {
      let d = {}; try { d = JSON.parse(l.data); } catch {}
      const txt = {
        create: "Създаде тикета", take: "Пое тикета", unassign: d.toDept ? `Насочи към отдел ${d.toDept}${d.reason ? " – " + d.reason : ""}` : "Върна тикета в общите на отдела",
        transfer: `Прехвърли на ${U[d.to] || "?"}${d.toDept ? " (отдел " + d.toDept + ")" : ""}${d.reason ? " – " + d.reason : ""}`,
        status: `Статус: ${S[d.from] || ""} → ${S[d.to] || ""}`, prio: `Приоритет: ${P[d.from] || ""} → ${P[d.to] || ""}`,
        edit: "Редактира: " + (d.fields || []).map(x => x.l).join(", "), note: "Бележка: " + (d.text || ""),
      }[l.type] || "";
      (L[l.ticket_id] ||= []).push(`${loc(l.at)} ${U[l.user_id] || "?"}: ${txt}`);
    }
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["№", "Заглавие", "Описание", "Компания", "Обект", "Отдел", "Категория", "Приоритет", "Статус", "Подал", "Отговорник", "Създаден", "Обновен", "История"].map(q).join(";")];
    for (const t of tickets.results) rows.push([
      "ТК-" + String(t.id).padStart(4, "0"), t.title, t.description, C[t.company_id] || "", t.site, D[t.department_id] || "", t.category, P[t.priority], S[t.status],
      U[t.reporter_id] || "", t.assignee_id ? U[t.assignee_id] || "" : "Неразпределен", loc(t.created_at), loc(t.updated_at), (L[t.id] || []).join("\n"),
    ].map(q).join(";"));
    const day = new Date().toISOString().slice(0, 10);
    return new Response("﻿" + rows.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tiketi-${day}.csv"`, "Cache-Control": "no-store" } });
  },
};
