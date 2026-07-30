# mDLAUG Turso relay (Cloudflare Worker)

Fronts your Turso database so the browser never holds the database token, and so
every install can write to one **central** database by default. The extension
calls this Worker at `/v2/pipeline` exactly as it would call Turso; the Worker
adds the real token (a Worker secret) and forwards the request.

> **You are not hosting anything.** A Cloudflare Worker is serverless — Cloudflare
> runs it, there's nothing to keep online or patch. And you don't need Wrangler or
> any local tooling: the whole thing can be done in the Cloudflare dashboard by
> copy-pasting one file. You also don't need a domain or DNS — every Worker gets a
> free `*.workers.dev` URL automatically. (DNS only comes up if you later want a
> custom hostname; see the end.)

## One-time setup

**1. Create the Turso database and a token** (on Turso, nothing to host)

Use the Turso dashboard (turso.tech) or the CLI:

```bash
turso db create mdlaug
turso db show mdlaug --url        # -> https://mdlaug-<org>.turso.io   (TURSO_URL)
turso db tokens create mdlaug     # -> a long token                    (TURSO_TOKEN)
```

You do **not** need to create tables — the extension runs `CREATE TABLE IF NOT
EXISTS` on first write, so the schema is created automatically.

**2. Deploy the Worker — Cloudflare dashboard, no CLI**

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**.
   Give it a name (e.g. `mdlaug-relay`) and click **Deploy** (it ships a
   "Hello World" first — that's fine).
2. Click **Edit code**, delete the starter, paste the entire contents of
   [`worker.js`](worker.js), then **Deploy**.
3. Go to the Worker's **Settings → Variables and Secrets → Add**, and add these as
   type **Secret** (values stay hidden after saving), clicking **Deploy** when done:
   - `TURSO_URL` — the `https://…turso.io` URL from step 1
   - `TURSO_TOKEN` — the token from step 1
   - `AUTH_KEY` — *(recommended)* any long random string; only requests carrying
     it will be accepted
   - `APPEND_ONLY` — *(optional)* set to `1` to reject DROP/DELETE/UPDATE
4. Your endpoint is the Worker's URL: `https://mdlaug-relay.<your-subdomain>.workers.dev`.

That's the entire "product" — one serverless function holding one secret. No
`wrangler.toml`, no deploy pipeline, nothing running on your machines.

<details><summary>Alternative: deploy with the Wrangler CLI</summary>

```bash
cd relay && npm install && npx wrangler login
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_TOKEN
npx wrangler secret put AUTH_KEY      # optional
npx wrangler deploy
```
</details>

**3. Point the extension at the relay (central by default)**

Edit `extension/config.js`:

```js
window.MDLAUG_CONFIG = {
  centralUrl: "https://mdlaug-relay.<your-subdomain>.workers.dev",
  centralToken: "<the AUTH_KEY you set, or empty>"
};
```

Reload the unpacked extension. Now every install **defaults** to saving audits to
your central database — no per-user token, no setup. Individual users can still
switch to a private local database in Options → Assessment storage.

**DNS / custom domain (optional, skip for MVP).** The `*.workers.dev` URL works
with no DNS. If you later want it on your own domain, add that domain to Cloudflare
(this is the "Cloudflare for DNS" part), then on the Worker go to
**Settings → Domains & Routes → Add → Custom domain**. Update `centralUrl` and add
the domain to `host_permissions` in `extension/manifest.json`.

## Test it

```bash
curl -X POST https://mdlaug-relay.<you>.workers.dev/v2/pipeline \
  -H "Authorization: Bearer <AUTH_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"select 1"}},{"type":"close"}]}'
```

A JSON pipeline result means the relay and database are wired up.

## Notes

- The relay is stateless; scale and cost are Cloudflare's free tier for typical use.
- For per-user identity (who assessed what), add OIDC/JWT verification in the
  Worker and map the verified subject to the `assessor` field before forwarding.
- Screenshots are stored inline (base64). At scale, move them to R2 and store a
  URL instead — an additive schema change (see docs/ARCHITECTURE.md).
