/*
 * mDLAUG Turso relay — a Cloudflare Worker that fronts your Turso (libSQL)
 * database so the extension never holds the database token.
 *
 * The extension points its storage URL at this Worker and calls the same
 * /v2/pipeline endpoint it would call on Turso directly. The Worker injects the
 * real Turso token (kept as a Worker secret) and forwards the request.
 *
 * Secrets / vars (wrangler secret put NAME):
 *   TURSO_URL     required  https URL of the Turso database (e.g. https://db-org.turso.io)
 *   TURSO_TOKEN   required  Turso database auth token
 *   AUTH_KEY      optional  shared key the extension must send as a Bearer token
 *   ALLOW_ORIGIN  optional  CORS origin allowlist (default "*")
 *   APPEND_ONLY   optional  "1" to reject DROP/DELETE/UPDATE/ALTER statements
 */
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.endsWith("/v2/pipeline")) {
      return new Response("mDLAUG Turso relay. POST your libSQL pipeline to /v2/pipeline.", { status: 200, headers: cors });
    }
    if (!env.TURSO_URL || !env.TURSO_TOKEN) {
      return json({ error: "relay not configured: set TURSO_URL and TURSO_TOKEN" }, 500, cors);
    }
    if (env.AUTH_KEY) {
      const sent = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (sent !== env.AUTH_KEY) return json({ error: "unauthorized" }, 401, cors);
    }

    const body = await request.text();
    if (env.APPEND_ONLY === "1" && /\b(drop|delete|update|alter|truncate)\b/i.test(body)) {
      return json({ error: "append-only relay: destructive statements are rejected" }, 403, cors);
    }

    const upstream = env.TURSO_URL.replace(/\/+$/, "") + "/v2/pipeline";
    let res;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.TURSO_TOKEN },
        body
      });
    } catch (e) {
      return json({ error: "upstream fetch failed: " + e.message }, 502, cors);
    }
    const text = await res.text();
    return new Response(text, { status: res.status, headers: Object.assign({}, cors, { "Content-Type": "application/json" }) });
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({}, cors, { "Content-Type": "application/json" }) });
}
