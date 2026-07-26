# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## What this is

**Hypercube** — a single-user-per-account personal productivity dashboard: tasks,
an Eisenhower matrix, habits, goals, and time tracking. Flask + SQLite on the
back end, a single HTML page driven by one vanilla-JS file on the front end.

There is **no build step, no test suite, no linter, and no package.json**. What
you see in the repo is what runs in production.

## Stack & layout

```
app.py             Flask app: every route + API endpoint (~1500 lines)
database.py        SQLite connection, schema, idempotent migrations
predictor.py       Holt double-exponential forecasting for the 7-day time forecast
gunicorn.conf.py   Production WSGI config (Render); starts background jobs
run.py             Dev server with livereload on :5000
templates/index.html   The entire single-page UI (~615 lines)
static/js/app.js       All client logic (~3300 lines)
static/css/style.css   All styles (~3400 lines)
static/manifest.json   PWA manifest
static/img/            icon.png (dark) + icon-inverted.png (light)
```

Dependencies (`requirements.txt`): flask, gunicorn, livereload, requests,
APScheduler, openai. Chart.js is loaded from a CDN in `index.html`; Google Fonts
too. Everything else is hand-rolled.

## Running it

```bash
pip install -r requirements.txt
python run.py            # dev, livereload watches templates/ + static/, :5000
gunicorn -c gunicorn.conf.py app:app    # production
```

The DB (`productivity.db`) lives in `$DATA_DIR` (default `.`) and is gitignored.
`init_db()` runs at import time in `app.py`, so simply importing the app creates
and migrates the schema.

### Environment variables

| Var | Purpose |
| --- | --- |
| `SECRET_KEY` | Flask session key. If unset, a key is generated and persisted to `$DATA_DIR/.secret_key` (mode 0600, gitignored). |
| `DATA_DIR` | Directory for the DB and secret key. `/tmp` on Render. |
| `PORT` | Bind port for gunicorn (Render injects it; default 10000). |
| `NVIDIA_API_KEY` | Enables the AI voice-triage endpoint. Without it `/api/ai/triage` returns 503. |
| `TELEGRAM_TOKEN` / `TELEGRAM_CHAT_ID` | Enable scheduled + on-demand DB backups over Telegram. |
| `BACKUP_HOUR` | UTC hour for the daily backup job (default `8`). |
| `RENDER_EXTERNAL_URL` | Used to self-register the Telegram webhook at startup. |

Every integration degrades silently when its env var is missing — never make one
of them mandatory for the app to boot.

## Architecture notes that matter

### Auth is username-only

No passwords. `POST /api/auth/login` with a username sets `session["user_id"]`;
usernames match `^[a-zA-Z0-9_]{2,32}$`, are compared `COLLATE NOCASE`, and the
session cookie is HttpOnly / SameSite=Lax / 30-day lifetime. This is deliberate
for a personal-scale app — don't "fix" it into a password system unless asked.

### Ownership: every query is scoped by `user_id`

`@require_user` (in `app.py`) rejects unauthenticated requests with 401 and
**injects `uid` as the first positional argument** of the view:

```python
@app.route("/api/tasks", methods=["GET"])
@require_user
def get_tasks(uid):
    ...
```

Decorator order matters: `@app.route` first, then `@require_user`. Every SELECT/
UPDATE/DELETE on tasks, habits, goals, time_logs and timers **must** carry
`AND user_id = ?`. For child tables (`task_logs`, `habit_completions`) the check
goes through a join or a subquery on the parent. Missing this is a cross-account
data leak — treat it as the single most important invariant in the codebase.

The backup/restore and `/api/auth/users` endpoints are intentionally unauthenticated
(recovery paths reachable from the login screen).

### Schema & migrations (`database.py`)

- `init_db()` is idempotent and runs on every boot and after every DB import.
- New tables: add to the `executescript` block with `CREATE TABLE IF NOT EXISTS`.
- **New columns: add an entry to the `column_migrations` dict**, never edit an
  existing `CREATE TABLE`. Each `ALTER TABLE ADD COLUMN` is wrapped in a
  try/except on `sqlite3.OperationalError` so re-runs are no-ops. Existing
  production databases only get new columns this way.
- Structural changes that SQLite can't `ALTER` (see the `matrix_timers` primary-key
  migration) are done by inspecting `PRAGMA table_info` and rebuilding.
- `DEFAULT_OWNER = "sofien"` is created on first boot and any pre-multi-user
  rows with `user_id IS NULL` are backfilled to them.
- Connections use `PRAGMA journal_mode=WAL` and `sqlite3.Row`. Open with
  `get_db()`, and **always `conn.close()` on every return path**, including error
  branches — the existing code closes before each `return jsonify(...), 4xx`.

### Tables

`users`, `tasks`, `task_logs`, `time_logs`, `habits`, `habit_completions`,
`goals`, `matrix_timers`, `delegations`.

Tasks carry `urgent` / `important` (the Eisenhower axes), `category`, `chapter`,
`task_type`, `estimated_minutes`, `archived`/`archived_at`, plus
`delegation_id` (set on a received copy) and `delegated_out` (set on the task you
delegated away).

### Delegation

`POST /api/tasks/<id>/delegate` **copies** the task into the recipient's account
and links both rows to a `delegations` row (`status`: pending → accepted /
declined / done). Inbox/outbox, accept, decline, unaccept and revoke endpoints
follow. `_task_delegation_info()` attaches `delegation_in` / `delegation_out`
dicts to serialized tasks — call it anywhere a task is returned to the client.

### Matrix timers are server-side

`matrix_timers` is keyed `(user_id, task_id)` so multiple timers run in parallel.
Elapsed time = `accumulated_sec + (now - started_at)` unless paused. The client
restores running timers on load via `GET /api/timer`, so a refresh or a device
switch never loses a timer. Keep the elapsed-time math in `_timer_elapsed()`.

### Habits are counters, not booleans

`POST /api/habits/<id>/toggle` increments today's `check_count` (and adds one
proportional unit of `duration_minutes`); `/uncheck` decrements and deletes the
row at zero. Streaks are computed in `_calc_streak()` by walking back day by day.

### AI voice triage

`POST /api/ai/triage` takes `{message}` and returns created tasks. It uses the
`openai` client pointed at NVIDIA NIM (`https://integrate.api.nvidia.com/v1`,
model `meta/llama-3.1-8b-instruct` — chosen for low latency on structured JSON
extraction, no reasoning chain). `_ai_examples()` builds a deduped few-shot from
the user's recent tasks so the model reuses their own category/chapter names;
`_parse_task_json()` tolerates code fences and stray prose. The prompt is
explicitly multilingual and keeps titles in the user's language.

If you touch the prompt, keep it small: prompt size is the dominant latency cost
and several past commits exist purely to shrink it.

### Background jobs run in the gunicorn master only

`gunicorn.conf.py` sets `preload_app = True` and calls `_start_scheduler()` +
`_tg_register_webhook()` from `on_starting`, which runs once in the master before
forking. Threads don't survive fork, so the APScheduler backup job lives only
there — exactly one scheduler, not one per worker. Don't move these calls to
module import in `app.py`.

### Forecasting (`predictor.py`)

`forecast(historical: list[float], horizon=7) -> list[float]`, fed 60 days of
daily totals. Three paths: all-zero → zeros; <5 logged days → flat recent mean;
otherwise Holt's linear smoothing, plus multiplicative weekly seasonality once
there are ≥28 days and ≥20 logged days. Pure functions, no I/O — the one module
here that is trivially unit-testable.

## Front end conventions

`static/js/app.js` is one file, organized by `// ── Section ──` banner comments
(Theme, Loader, Utilities, Tab nav, Dashboard, Tasks, Habits, Goals, Matrix,
Delegation, Undo/Redo, Drag-and-drop, Toasts, Auth, Init). Follow the existing
banners when adding code — put new logic in the section it belongs to rather than
appending at the bottom.

- `$` / `$$` are `querySelector` / `querySelectorAll`-to-array helpers.
- **All server calls go through `api(path, method, body)`**, which JSON-encodes
  the body and, on a 401 outside `/api/auth/*`, shows the auth overlay and throws.
  Don't call `fetch` directly for API routes.
- Self-contained features are wrapped in IIFEs (`(function wireAIAgent(){…})()`).
- User feedback is `toast(msg, "success" | "error")`.
- Any string interpolated into HTML goes through `escHtml()`.
- Mutating actions should register an undo via
  `_pushUndo(label, undoFn, redoFn)` (stack limit 50; a new action clears redo).
  Ctrl+Z / Ctrl+Y and mobile edge-swipes are already wired.
- `localStorage` keys in use: `theme`, `ambient`, `sidebar-collapsed`,
  `matrix-order`, `voiceLang`, `autoArchiveDays`. Matrix drag ordering is
  client-only — it is **not** persisted server-side.
- Charts are Chart.js instances held in module-level variables (`dailyChart`,
  `priorityChart`); destroy before re-rendering. Colors come from
  `themeChartColors()`, which reads CSS custom properties so charts follow the
  theme.

### Styling

`static/css/style.css` is one file using **Catppuccin Latte (light) / Mocha
(dark)**. Every color is a CSS custom property on `:root`, with dark overrides
under `[data-theme="dark"]` — the attribute is set on `<html>` by an inline
script in `index.html` *before first paint* so there's no flash. Never hard-code
a hex value in a rule; add or reuse a variable.

The look is "liquid glass": `--glass-*` primitives (blur, saturation, rim,
highlight, 4-layer shadow) composed into surfaces. Ambient mode (`body.ambient-on`)
adds slowly drifting blurred blobs behind the UI. Motion uses `--spring` /
`--ease-out-quint`, and everything is disabled under
`@media (prefers-reduced-motion: reduce)` — keep that honored.

Breakpoints: 900px, 720px (main mobile), 500px, 380px, plus a
`(display-mode: standalone)` block for the iOS PWA and a 720–980px safety net.

## Working in this repo

- **No tests exist.** Verify changes by running `python run.py` and exercising
  the flow in a browser. `predictor.py` is the exception — pure functions you can
  check from a REPL. Don't claim a change is tested when it isn't.
- Keep the file structure flat. Resist splitting `app.py` or `app.js` into
  modules unless explicitly asked; the single-file layout is intentional and the
  front end has no bundler to resolve imports.
- Match the surrounding style: 4-space Python, snake_case, `_leading_underscore`
  for private helpers, `// ── … ──` and `/* ── … ── */` section banners, aligned
  assignments where neighbors are aligned, and short comments that explain *why*.
- Commit messages in this repo are single-line, imperative, and describe the
  user-visible effect ("Add ambient mode — cinematic drifting glow behind the UI").
- Update `README.md` when you add an env var, an endpoint group, or a feature a
  user would notice.

### Checklist for a new API endpoint

1. `@app.route(...)` then `@require_user`, view signature takes `uid` first.
2. Every query filtered by `user_id` (directly or through a join).
3. `conn.close()` on every return path.
4. Return `jsonify(...)` with an explicit status code on errors.
5. New column? Add it to `column_migrations` in `database.py`.
6. Call it from `app.js` through `api()`, and add `_pushUndo` if it mutates data.
