# mDLAUG BDD data store

A structured, behaviour-driven dataset of the accessibility-remediation knowledge
behind this project: every mDLAUG help-seeking situation (plus the engine's forms
and multimedia rules) expressed as a **User Story** with **Given/When/Then**
acceptance criteria, and every additional guideline from the evaluation forum
classified by **how it can be satisfied** — algorithmically, as a hybrid, or
manually.

## Model

It follows the BDD requirements ontology (User Story → Narrative + Scenarios; a
Scenario is a set of Given/When/Then **Steps**; Steps describe **Behaviors** on
**Interaction Elements** over **Data**). Mapped here:

- **User Story** — one per situation; the role is a screen-reader / low-vision user.
- **Scenario** — a remediation acceptance criterion (Given a broken pattern / When
  the page is remediated / Then the accessible outcome holds).
- **Interaction Elements** — the DOM element types involved (Link, Image, Dialog…).
- **Behaviors / Data** — the DOM changes the engine makes, or the content a human
  or service must supply.

## Files

- **`mdlaug-bdd.json`** — the source of truth (machine-readable). 26 situations,
  each with a user story, core scenarios, engine rule ids, WCAG SC, and the
  classified additional guidelines.
- **`features/*.feature`** — the same content as Gherkin, one feature per
  situation, tagged `@algorithmic` / `@hybrid` / `@manual` and
  `@implemented` / `@proposed` / `@service` / `@app-layer`. Ready to drive a test
  runner or an executable-process model later.
- **`remediation-matrix.md`** — the algorithmic-vs-manual table with summary counts.
- **`build.js`** — regenerates the features + matrix from the JSON and
  **validates the dataset against the engine** (`remediator.rules()`): every
  situation the engine implements is covered, referenced rule ids exist, and
  conformance levels match. Run: `node bdd/build.js` (or `npm run bdd`).

## Algorithmic vs. manual — the short answer

Of the 63 additional guidelines: **15 are algorithmic** (the extension can satisfy
them by rewriting the DOM), **26 are hybrid** (the structure is automatable but the
*content* — a description, transcript, label, or data table — needs a human or a
model), and **22 are manual** (authored content, backend/app data, design policy,
or cross-assistive-technology testing). See `remediation-matrix.md` for the full
breakdown and the per-guideline rationale.

The `proposed` items are, in effect, the roadmap: guidelines that are algorithmic
but not yet built as engine rules (e.g. announce expand/collapse state, highlight
query terms in snippets, "page N of M" live announcements, expand-all/collapse-all,
optional focus-to-results). The `service` items become automatic once a
description/transcription/summary endpoint is configured.

## Consistency

`build.js` fails if the dataset drifts from the implementation, so this store and
the engine stay in lockstep. Regenerate after changing a rule.
