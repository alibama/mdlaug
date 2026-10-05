# Crowdsourced review & remediation

Crawls are reviewed by invited people in a separate web app (`crowd_app.py`):
Google sign-in, then an allowlist you control. Reviewers judge flagged findings
(two independent reviews each, consensus tracked) and propose the fixes automation
can't write — alt text, control names, labels — which others vote on. Accepted
fixes flow into each library's **improved site pack** for the extension.

```
local crawl ──publish──▶ Turso (crowd_* tables) ◀── crowd app (Google login + allowlist)
     ▲                                                     │ reviews · fix proposals · votes
     └────────────────────── pull ◀───────────────────────┘
```

The crowd tables sit alongside the extension's assessment tables in the same Turso
database; nothing existing is modified. Both the crawler and the crowd app run
server-side and hold their Turso token in their own secrets — the Cloudflare relay
remains for the browser extension only.

## 1. Turso

Use the existing `mdlaug` database and a **write** token:

```bash
turso db tokens create mdlaug
```

Set on the machine that crawls (PowerShell: `$env:TURSO_URL="…"`):

```
TURSO_URL=https://mdlaug-<org>.turso.io       (libsql:// also works)
TURSO_TOKEN=<token>
```

```bash
python -m mdlaug_crawl crowd init
python -m mdlaug_crawl crowd user add you@virginia.edu --role admin --name "Your Name"
```

**Size:** screenshots are compressed to WebP (≤1000 px wide) — roughly 50–150 KB per
page, so a full crawl of ~140 sites is on the order of 100–200 MB. Check your Turso
plan's storage limit before publishing everything; publish one run of a few sites
first.

## 2. Adding reviewers

Reviewers sign in with a Google account, so add the address they'll use:

```bash
python -m mdlaug_crawl crowd user add reviewer@example.edu
python -m mdlaug_crawl crowd user list
python -m mdlaug_crawl crowd user remove reviewer@example.edu      # deactivates
```

Admins can also add/deactivate users in the app's **Admin** tab. Anyone who signs in
without being on the list sees "Not yet authorized" and nothing else.

## 3. Google sign-in

1. [Google Cloud Console](https://console.cloud.google.com/) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: user type *External*, app name, support
   email. Leaving it in *Testing* is fine and adds a second gate: only Google accounts
   listed as test users can sign in (up to 100). Add your reviewers there too.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorized redirect URIs:
   * `https://<your-crowd-app-host>/oauth2callback`
   * `http://localhost:8501/oauth2callback` (local testing)
4. Copy the client ID and secret into `.streamlit/secrets.toml` (template:
   `.streamlit/secrets.toml.example`) along with `TURSO_URL`, `TURSO_TOKEN`, and a long
   random `cookie_secret`.

This uses Streamlit's built-in login (`st.login`), so it needs `streamlit[auth]` ≥ 1.42.

## 4. Running the crowd app

Locally: `pip install -r requirements-crowd.txt` then `streamlit run crowd_app.py`.

To share it, it needs an HTTPS address (Google requires HTTPS redirects except for
localhost). Two simple options:

* **Streamlit Community Cloud** (free): push the repo to GitHub, create an app with main
  file `crawler/crowd_app.py`, and paste the contents of your `secrets.toml` into the
  app's *Secrets* settings. Set the redirect URI to `https://<app>.streamlit.app/oauth2callback`.
* **A server you run:** `streamlit run crowd_app.py --server.port 8502` behind your web
  server's HTTPS reverse proxy (WebSocket support required).

## 5. The loop

1. Crawl locally as usual.
2. Publish: `python -m mdlaug_crawl crowd publish --run <N>` (or **Run crawl → Publish**
   in the local app). Re-publishing a run is safe — it replaces that run's rows.
3. Reviewers work the **Review queue** and **Propose fixes** tabs.
4. Pull agreed decisions back: `python -m mdlaug_crawl crowd pull` (or the button). Only
   findings where reviewers *agree* are imported, as reviews by `crowd (n)`, so local
   analytics and Excel exports reflect them. `--include-single` also imports
   single-review findings.
5. Download each library's **improved site pack** from the crowd app's Sites tab.

## Rules of the game

* **Consensus:** each flagged finding gets 2 reviews (`TARGET_REVIEWS`). Agreed = a
  majority decision, and for score overrides the scores within 1 point. Otherwise it's
  *disputed* and listed for admins.
* **Fixes:** a proposal counts as its author's +1. Net +2 accepts it (net −2 rejects);
  admins can accept/reject directly. Accepting one supersedes other proposals for the
  same element.
* **Audit:** every review, proposal, vote, decision, user change, and publish is logged
  in `crowd_audit` (Admin tab).

## Security notes

* Every page load checks the signed-in email against `crowd_users`; deactivating a user
  locks them out on their next interaction.
* Tokens live only in server-side secrets; nothing is exposed to reviewers' browsers.
* `MDLAUG_CROWD_DEV_USER` bypasses sign-in for local testing and shows a warning banner.
  **Never set it on a deployed server.**
* Reviewer emails are stored with their contributions; other reviewers see only the
  part before the @.
