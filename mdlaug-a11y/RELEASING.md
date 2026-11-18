# Releasing mDLAUG Repair

Releases are cut from a git tag. One push does everything: tests, the store-policy
lint, the zip, a GitHub Release, the stable download link, and submission to the
Chrome Web Store and Edge Add-ons.

## Ship a new version (every time)

1. Bump the version in **both** `extension/manifest.json` and `package.json`
   (e.g. `0.10.0` → `0.10.1`; use x.y.z, digits only). Run `npm install` so
   `package-lock.json` follows.
2. Add a `## [0.10.1] - YYYY-MM-DD` section to `CHANGELOG.md`. It becomes the release notes.
3. Merge to `main`, then tag that commit and push the tag:

   ```bash
   git tag ext-v0.10.1 && git push origin ext-v0.10.1
   ```

4. Watch **Actions → Release extension**. Its summary says whether each store
   submission was attempted. Google and Microsoft review every update (usually
   1–3 days). Approved versions publish automatically and installed copies update
   themselves.

The workflow refuses to run if the tag doesn't match the manifest version.
To test the build without releasing, open **Actions → Release extension → Run workflow**;
the zip is attached to the run as an artifact.

**Cadence.** Every store update goes through review, so batch changes into weekly or
fortnightly releases rather than tagging every commit. Use patch versions
(0.10.1, 0.10.2…) for fixes and minor versions (0.11.0) for new features.

## One-time setup

### 1. Chrome Web Store (≈30 minutes, plus review)

1. Sign in at <https://chrome.google.com/webstore/devconsole> with a **project or
   institutional Google account** (not a personal one, so the listing outlives any
   one person). Pay the one-time US$5 registration fee and verify the email.
2. **New item** → upload the zip from the latest release
   (<https://github.com/alibama/mdlaug/releases/download/extension-latest/mdlaug-repair-extension.zip>).
3. Fill in the listing from [`store/LISTING.md`](store/LISTING.md): description,
   category, the permission justifications and the privacy answers (all written out there).
   Privacy policy URL: <https://alibama.github.io/mdlaug/privacy/>.
4. Add at least one screenshot (1280×800 or 640×400) and the 128×128 icon
   (`extension/icons/icon128.png`). A 440×280 promo tile is optional but helps.
5. **Submit for review.** The first review can take one to three weeks because the
   extension runs on every site.
6. For automated updates, add these **repository secrets** (Settings → Secrets and
   variables → Actions):

   | Secret | Where it comes from |
   |---|---|
   | `CWS_EXTENSION_ID` | The 32-letter ID shown on the item in the developer console |
   | `CWS_PUBLISHER_ID` | Developer console → Account → Publisher ID |
   | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` | A Google Cloud OAuth client (Desktop app) with the Chrome Web Store API enabled |
   | `CWS_REFRESH_TOKEN` | Generated once for that client |

   The step-by-step for the OAuth client and refresh token is in the
   [chrome-webstore-upload keys guide](https://github.com/fregante/chrome-webstore-upload-keys).

### 2. Edge Add-ons (≈20 minutes, free)

1. Register at <https://partner.microsoft.com/dashboard/microsoftedge/> (free).
2. **Create new extension** → upload the same zip → reuse the same listing text and privacy URL.
3. After the first submission, open **Publish API**, create credentials and add the secrets
   `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID` and `EDGE_API_KEY`.

### 3. After both listings are approved

Put the store links on the [project site](../docs/index.html) (`#extension` section;
the comment there marks the spot) and in the top-level README's install steps.
Store installs auto-update, so from then on step 3 above is the whole release.

## Store-policy guardrails (checked in CI)

`scripts/store-lint.sh` fails the build if:

- extension code references a script CDN (stores forbid remotely hosted code; pdf.js
  and mammoth are bundled in `extension/vendor/`)
- the manifest asks for dev hosts (`localhost`) or permissions the code doesn't use
- `config.js` makes the shared project database the default (it must stay opt-in)

Adding a permission is the main thing that slows a review. If you add one, update the
justification in `store/LISTING.md` and the privacy page (`docs/privacy/index.html`).
