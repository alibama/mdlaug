# Installing mDLAUG Repair

Chrome intentionally restricts installing extensions from outside the Web Store,
so there is no double-click installer for an unlisted build. Here are the real
options, simplest first for your situation.

## A. Load unpacked (recommended for you and testers)

1. Clone or download this repo.
2. Chrome/Edge → `chrome://extensions` → turn on **Developer mode** (top right).
3. **Load unpacked** → select the `extension/` folder.
4. Reload the extension here after pulling changes.

`extension/scripts/check-install.sh` confirms the folder is complete.

## B. Share a single file

```bash
npm run pack        # -> dist/mdlaug-repair-extension-v<version>.zip
```

Hand someone the zip; they unzip it and do **Load unpacked** on the unzipped
folder (steps 2–3 above). This is the simplest "one file" hand-off without a store.

## C. Pack a .crx (enterprise / Edge only)

```bash
# Chrome will create extension.crx + a private key (.pem) next to the folder:
google-chrome --pack-extension="$PWD/extension"
# (or chrome://extensions -> "Pack extension")
```

Keep the generated `.pem` safe — reusing it keeps the extension ID stable.
**Caveat:** modern Chrome will not let a normal user install a `.crx` by
double-click or drag-drop. A `.crx` is only genuinely installable via enterprise
policy (`ExtensionInstallForcelist` + a self-hosted `update.xml`) or on some
Chromium/Edge configurations. For a handful of trusted machines, option A/B is
less hassle.

## D. True one-click for anyone: the Web Store

Publishing to the **Chrome Web Store** (a listing can be *unlisted*, not public)
or **Edge Add-ons** is the only way to get a click-to-add install for arbitrary
users. It needs a one-time developer account and a review. Worth it once the tool
is past the initial trusted-tester phase.
