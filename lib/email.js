// Имейл известия. Изпращането става през външна услуга – Brevo или Resend – с API ключ,
// записан като таен ключ (Secret) в Cloudflare. Без ключ системата работи нормално, просто не праща имейли.
//
// Настройки (Settings → Variables and Secrets):
//   EMAIL_PROVIDER = brevo | resend
//   EMAIL_API_KEY  = ключът от услугата (тип Secret)
//   EMAIL_FROM     = Сервизни тикети <tiketi@vashata-firma.bg>   (адресът трябва да е потвърден в услугата)
//   (EMAIL_ENDPOINT – само за тестове, не се задава)

import { STATUS_LABELS } from "./server.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PRIO = { 4: "Спешен", 3: "Висок", 2: "Среден", 1: "Нисък" };

export function emailConfig(env) {
  const provider = String(env.EMAIL_PROVIDER || "").toLowerCase().trim();
  const ok = ["brevo", "resend"].includes(provider) && !!env.EMAIL_API_KEY && !!env.EMAIL_FROM;
  return { ok, provider, from: env.EMAIL_FROM || "" };
}

function parseFrom(from) {
  const m = String(from).match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return m ? { name: m[1].replace(/^"|"$/g, "") || "Сервизни тикети", email: m[2] } : { name: "Сервизни тикети", email: String(from).trim() };
}

export async function sendMail(env, { to, subject, html, text }) {
  const cfg = emailConfig(env);
  if (!cfg.ok) throw new Error("Имейл известията не са настроени.");
  let res;
  if (cfg.provider === "resend") {
    res = await fetch(env.EMAIL_ENDPOINT || "https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to.email], subject, html, text }),
    });
  } else {
    const f = parseFrom(env.EMAIL_FROM);
    res = await fetch(env.EMAIL_ENDPOINT || "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.EMAIL_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ sender: f, to: [{ email: to.email, name: to.name || to.email }], subject, htmlContent: html, textContent: text }),
    });
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`${cfg.provider} отговори ${res.status}: ${body}`);
  }
}

async function remember(env, key, value) {
  try { await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(key, value).run(); } catch {}
}

// Известие до служител, на когото е възложен / прехвърлен тикет
export async function notifyAssigned(env, origin, { ticketId, toUserId, byName, reason, transferred }) {
  try {
    if (!emailConfig(env).ok) return;
    const u = await env.DB.prepare("SELECT full_name, email, notify, active FROM users WHERE id = ?").bind(toUserId).first();
    if (!u || !u.active || !u.notify || !u.email) return;
    const t = await env.DB.prepare(`SELECT t.*, c.name AS company_name, c.phone AS company_phone, d.name AS dept_name
      FROM tickets t LEFT JOIN companies c ON c.id = t.company_id LEFT JOIN departments d ON d.id = t.department_id WHERE t.id = ?`).bind(ticketId).first();
    if (!t) return;
    const no = "ТК-" + String(t.id).padStart(4, "0");
    const repair = t.kind === "repair";
    const link = `${origin}/#t-${t.id}`;
    const client = t.company_name || t.client_name || "";
    const rows = (repair
      ? [["Клиент", client], ["Продукт", t.product], ["Сериен №", t.serial], ["За замяна", t.replaced ? "Да" : "Не"], ["Повреда", t.description]]
      : [["Компания", client], ["Обект", t.site], ["Категория", t.category], ["Описание", t.description]])
      .concat([["Отдел", t.dept_name], ["Статус", STATUS_LABELS[t.status] || t.status], ["Приоритет", PRIO[t.priority]]])
      .filter(r => r[1]);
    const subject = `${transferred ? "Прехвърлен към вас" : "Нов " + (repair ? "ремонт" : "тикет") + " за вас"}: ${no} ${t.title}`.slice(0, 180);
    const intro = `${byName} ${transferred ? "прехвърли към вас" : "ви възложи"} ${repair ? "ремонт" : "тикет"} <b>${no}</b>.`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#16212c;max-width:600px">
  <p>Здравейте, ${esc(u.full_name)},</p>
  <p>${intro}</p>
  ${reason ? `<p style="background:#eef2f6;border-radius:6px;padding:10px 12px"><i>„${esc(reason)}“</i></p>` : ""}
  <h2 style="font-size:18px;margin:18px 0 8px">${esc(t.title)}</h2>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    ${rows.map(([k, v]) => `<tr><td style="color:#5b6b7a;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}
  </table>
  <p style="margin:22px 0"><a href="${esc(link)}" style="background:#0d5c7a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Отвори ${no}</a></p>
  <p style="font-size:12px;color:#5b6b7a">Получавате това писмо, защото тикетът е възложен на вас в „Сервизни тикети“. Известията се изключват от бутона с вашето име горе вдясно в системата.</p>
</div>`;
    const text = `Здравейте, ${u.full_name},\n\n${byName} ${transferred ? "прехвърли към вас" : "ви възложи"} ${repair ? "ремонт" : "тикет"} ${no}.\n`
      + (reason ? `„${reason}“\n` : "") + `\n${t.title}\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nОтвори: ${link}\n`;
    await sendMail(env, { to: { email: u.email, name: u.full_name }, subject, html, text });
    await remember(env, "email_last_ok", new Date().toISOString());
  } catch (e) {
    console.error("email", e);
    await remember(env, "email_last_error", `${new Date().toISOString()} ${e.message || e}`);
  }
}
