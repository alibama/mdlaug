/*
 * mDLAUG central deployment config.
 *
 * centralUrl / centralToken point at the project's shared assessment database
 * (a Cloudflare relay in front of Turso; see relay/). Leave centralUrl empty to
 * offer no central database at all.
 *
 * centralOptIn decides what a fresh install does:
 *   true  (store builds) – every install starts on a private, local in-browser
 *         database. Options -> Assessment storage shows a one-click "Share with
 *         the mDLAUG project database" button; nothing is sent until the user
 *         chooses it.
 *   false (self-hosted team deployments) – installs default to writing to the
 *         central database ("central by default"); users can still switch back.
 *
 * centralToken is the optional AUTH_KEY set on the relay; the extension sends
 * it as a bearer token. It ships inside the extension, so treat it as a light
 * spam filter, not a secret.
 */
window.MDLAUG_CONFIG = {
  centralUrl: "https://mdlaug-relay.adp6j.workers.dev",
  centralToken: "testingauth",
  centralOptIn: true
};
