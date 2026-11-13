import { sessionUser, userCount, json, migrateOnce, dbErrorText } from "../lib/server.js";

// Страници и адреси, достъпни без вход
const PUBLIC = [/^\/login(\.html)?$/, /^\/setup(\.html)?$/, /^\/assets\//, /^\/api\/(login|setup|setup-status)$/, /^\/favicon\.ico$/];

export async function onRequest(context) {
  try { return await handle(context); }
  catch (e) {
    // Грешка в базата (напр. изчерпан дневен лимит) – ясно съобщение вместо празна страница или „Първоначална настройка“
    const path = new URL(context.request.url).pathname, msg = dbErrorText(e);
    if (path.startsWith("/api/")) return json({ error: msg }, 503);
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сервизни тикети</title>
<div style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:24px;border:1px solid #d5dce3;border-radius:12px">
<h1 style="font-size:20px;margin:0 0 10px">Системата временно не е достъпна</h1><p>${msg.replace(/[<>&]/g, "")}</p>
<p style="color:#5b6b7a;font-size:14px">Опитайте отново по-късно – страницата не трябва да се попълва наново.</p></div>`,
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "600" } });
  }
}

async function handle(context) {
  const { request, env, next, data } = context;
  const path = new URL(request.url).pathname;

  if (!env.DB) {
    return new Response("Липсва връзка с базата D1. В Cloudflare: Settings → Bindings → Add → D1 database, с име на променливата DB. После направете нов deploy.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  await migrateOnce(env);
  if (PUBLIC.some(r => r.test(path))) return withSecurityHeaders(await next());

  const user = await sessionUser(request, env);
  if (!user) {
    if (path.startsWith("/api/")) return json({ error: "Сесията изтече. Влезте отново." }, 401);
    const to = (await userCount(env)) === 0 ? "/setup" : "/login";
    return Response.redirect(new URL(to, request.url).toString(), 302);
  }
  data.user = user;
  return withSecurityHeaders(await next());
}

function withSecurityHeaders(res) {
  const r = new Response(res.body, res);
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "same-origin");
  return r;
}
