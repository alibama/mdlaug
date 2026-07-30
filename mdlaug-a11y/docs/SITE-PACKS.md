# Writing a site pack

A **site pack** adds platform- or site-specific accessibility fixes on top of the
generic mDLAUG rules. Packs run *after* the core rules and flow through the same
report / highlight / undo machinery, so a pack fix is auditable and reversible
just like a core fix.

There are two kinds:

- **Declarative** — pure JSON: a selector plus the attributes to set. Safe (no
  code execution), portable, and shareable. This is what most site fixes need,
  and what you can add at runtime from the options page (**Site packs → Add a
  pack**). Declarative packs are *attribute-only*, which is why undo can always
  restore them.
- **Imperative** — a JavaScript `fix(ctx, opts)` function for logic a selector
  can't express. Only for bundled/PR packs (JSON can't carry a function). It
  receives a `ctx` of the same undo-tracked helpers the core uses.

## Shape

```json
{
  "id": "mylib",
  "title": "My Library",
  "match": {
    "hosts": ["mylib.edu"],
    "generator": "Drupal",
    "selectors": [".pager", "#facets"]
  },
  "rules": [
    {
      "code": "NAV2",
      "level": "AA",
      "describe": "Pager is a labelled nav landmark",
      "select": ".pager",
      "when": { "notRole": "navigation" },
      "set": { "role": "navigation", "aria-label": "Pagination" }
    }
  ]
}
```

### match (when the pack applies)

- `hosts` — array of substrings or regex (regex only in JS packs). A **hard
  filter**: if present, the current host must match or the pack is skipped.
- `generator` — regex (string in JSON) tested against `<meta name="generator">`.
- `selectors` — array; the pack matches if **any** selector is present on the page.
- `test` — (JS packs only) `function(document){ return bool }`.

If any of `generator` / `selectors` / `test` is provided, the pack applies when
**any** of them matches. A pack with only `hosts` applies on those hosts.

### rules

Each rule is one situation fix. Use a real mDLAUG **code** (e.g. `ACC1`, `NAV2`,
`FIL1`) and its **level** so the fix shows up correctly in the report and the
assessment. Fields:

- `select` — CSS selector for the elements to fix.
- `when` (optional guard) — `missingName` (only if the element has no accessible
  name), `hasName` (only if it does), `notRole` (skip if it already has that role).
- `set` — attributes to set (recorded for undo).
- `remove` — attributes to remove (recorded for undo).

Rules are **idempotent** (re-running won't double-apply) and **reversible**
(undo restores the originals).

## Guidelines for good packs

- Prefer `when` guards (`missingName`, `notRole`) so a rule only acts when
  something is actually broken — this avoids fighting a site that's already
  correct.
- Never remove or rewrite visible content; packs are for semantics (roles,
  names, states, landmarks), not for changing what the page says.
- Don't fabricate descriptions. If an image needs alt text, that's the compute
  layer's job (with a human/AI in the loop), not a pack.
- Keep selectors specific to the platform to avoid collateral matches.

## Contributing a bundled pack

1. Add `extension/packs/<id>.js` that calls `window.mDLAUG.remediator.registerPack({...})`
   (see the existing packs for the pattern).
2. Add the file to `content_scripts.js` in `extension/manifest.json`, right after
   the other packs.
3. Add a test in `tests/packs.test.js` that loads your pack against a mock of the
   platform's markup and asserts the resulting roles/names (and that undo restores).
4. `npm test`, then open a PR describing the platform and the mDLAUG situations covered.

Bundled starter packs today: Blacklight/Samvera, DSpace 7, Islandora/Drupal,
Omeka S, and IIIF viewers. They use conservative, well-known selectors and are
meant to be tuned against live installs — improvements very welcome.

**Priority targets.** The most valuable platforms to cover are large, widely used
public digital libraries — for example the Digital Public Library of America
(dp.la), HathiTrust (hathitrust.org), and the Library of Congress (loc.gov). These
are big, custom front-ends: build a pack by loading the site, running an audit, and
reading the real DOM rather than guessing selectors.
