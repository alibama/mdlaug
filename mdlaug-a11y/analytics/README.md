# mDLAUG analytics (Streamlit)

A small, read-only dashboard over the mDLAUG audit database: compliance by
situation, a conformance-level rollup, a trend over time, and the weakest
situations — filterable by library.

## Run

```bash
cd analytics
pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # then edit it
streamlit run app.py
```

Or configure via environment instead of secrets:

```bash
export TURSO_URL="https://mdlaug-<org>.turso.io"
export TURSO_AUTH_TOKEN="..."
streamlit run app.py
```

## Connecting

It reads over Turso's HTTP pipeline API (the same endpoint the extension writes
to), so either target works with the same two settings:

- **Turso directly** — `TURSO_URL` = your database URL, `TURSO_AUTH_TOKEN` = a
  token. Use a **read-only** token for a dashboard:
  `turso db tokens create mdlaug --read-only`.
- **Through the relay** — `TURSO_URL` = your Worker URL, `TURSO_AUTH_TOKEN` =
  the relay's `AUTH_KEY`. (If the relay sets `APPEND_ONLY`, note it only blocks
  writes; the dashboard's SELECTs pass through fine.)

`libsql://` URLs are accepted and converted to `https://` automatically.

## What it shows

- Headline metrics: audits, libraries, latest audit date.
- Compliance by situation (avg 1–7), coloured by A/AA/AAA level.
- Weighted average per conformance level.
- Overall-score trend across a library's audits over time.
- The lowest-scoring situations, as a table.

Charts are driven by the confirmed human 1–7 scores. Data is cached for two
minutes; reload to refresh.

## Tests

```bash
pip install pytest
pytest -q
```

Tests cover URL/type handling, pipeline decoding (mocked — no network), and the
aggregation transforms.
