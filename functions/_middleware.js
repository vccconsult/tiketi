import { sessionUser, userCount, json } from "../lib/server.js";

// Страници и адреси, достъпни без вход
const PUBLIC = [/^\/login(\.html)?$/, /^\/setup(\.html)?$/, /^\/assets\//, /^\/api\/(login|setup|setup-status)$/, /^\/favicon\.ico$/];

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const path = new URL(request.url).pathname;

  if (!env.DB) {
    return new Response("Липсва връзка с базата D1. В Cloudflare: Settings → Bindings → Add → D1 database, с име на променливата DB. После направете нов deploy.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

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
