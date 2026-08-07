/*
 * mDLAUG central deployment config.
 *
 * Leave centralUrl empty and every install defaults to a private local
 * in-browser database (zero setup). Set centralUrl to your Cloudflare relay
 * URL (see relay/) and every install DEFAULTS to writing to your shared Turso
 * database — "central by default" — while individual users can still override
 * the backend in Options → Assessment storage.
 *
 * centralToken is the optional AUTH_KEY you set on the relay; the extension
 * sends it as a bearer token so only your relay accepts the writes.
 */
window.MDLAUG_CONFIG = {
  centralUrl: "https://mdlaug-relay.adp6j.workers.dev",     // e.g. "https://mdlaug-relay.YOURNAME.workers.dev"
  centralToken: "testingauth"    // e.g. a shared key matching the relay's AUTH_KEY (optional)
};
