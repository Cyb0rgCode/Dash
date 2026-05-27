# Hypercube

A personal productivity dashboard. Tasks, habits, goals, and time tracking — all in one place.

**Stack:** Flask · SQLite · Vanilla JS · Chart.js · Gunicorn

---

## Features

| View | What it does |
| --- | --- |
| **Dashboard** | Daily greeting, focus task, stat cards, 7-day charts |
| **Matrix** | Eisenhower 2×2 grid (urgent × important) with drag-drop ordering |
| **Tasks** | Create, filter, batch-edit, time-log tasks grouped by category & chapter |
| **Habits & Goals** | Daily habit streaks and goal progress bars |

- Multi-user with username-only auth
- Task delegation between users
- Undo / redo
- Dark & light mode
- Liquid glass UI
- Mobile responsive

---

## Running locally

```bash
pip install -r requirements.txt
python run.py        # Flask dev server with live-reload on :5000
```

---

## Deploying (Render)

**Build command:** `pip install -r requirements.txt`  
**Start command:** `gunicorn -c gunicorn.conf.py app:app`

**Environment variables:**

| Key | Value |
| --- | --- |
| `SECRET_KEY` | random string — `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `DATA_DIR` | `/tmp` |
| `TELEGRAM_TOKEN` | *(optional)* Telegram bot token for automated backups |
| `TELEGRAM_CHAT_ID` | *(optional)* Your Telegram chat ID |
| `BACKUP_HOUR` | *(optional)* UTC hour for daily backup, default `8` |

---

## Backup

- **Export / Import** buttons on the login page — downloads or restores the full `.db` file
- **Telegram bot** — sends a backup at a scheduled hour daily; send `/backup` for an instant copy

---

## Project structure

```
app.py            Flask routes & API
database.py       SQLite schema & migrations
gunicorn.conf.py  Production server config
templates/        HTML (single-page)
static/css/       Styles
static/js/        Client-side logic
run.py            Dev server (livereload)
```
