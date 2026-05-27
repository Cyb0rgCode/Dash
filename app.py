import io
import os
import re
import secrets
import sqlite3
import tempfile
import time
from datetime import date, timedelta
from functools import wraps

from flask import Flask, jsonify, request, render_template, session, Response, send_file

from database import get_db, init_db, get_user_by_username, create_user


def _load_secret_key():
    """Resolve Flask's session-signing key.

    Order: SECRET_KEY env var → on-disk `.secret_key` next to the DB →
    generate a fresh 384-bit key and persist it. The on-disk file is
    git-ignored, so each install gets its own key without any setup.
    """
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    path = os.path.join(os.environ.get("DATA_DIR", "."), ".secret_key")
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = f.read().strip()
        if value:
            return value
    except FileNotFoundError:
        pass
    value = secrets.token_urlsafe(48)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(value)
        try:
            os.chmod(path, 0o600)  # best effort; ignored on platforms without POSIX perms
        except OSError:
            pass
    except OSError:
        # Read-only filesystem? Fall back to an in-process key — sessions
        # won't survive a restart, but the app still boots.
        pass
    return value


app = Flask(__name__)
app.secret_key = _load_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

init_db()


# ── Telegram backup ───────────────────────────────────────────────────────────

def _tg_snapshot() -> tuple[io.BytesIO, str]:
    """Create an in-memory SQLite snapshot and return (buf, filename)."""
    from database import DB as _DB
    buf = io.BytesIO()
    fd, tmp = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        src = sqlite3.connect(_DB)
        bak = sqlite3.connect(tmp)
        src.backup(bak)
        bak.close()
        src.close()
        with open(tmp, "rb") as f:
            buf.write(f.read())
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    buf.seek(0)
    return buf, f"hypercube_{date.today()}.db"


def _tg_send_message(text: str):
    token   = os.environ.get("TELEGRAM_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        return
    try:
        import requests as _r
        _r.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=10,
        )
    except Exception as exc:
        app.logger.warning("Telegram message failed: %s", exc)


def _tg_send_backup(caption: str = "📦 Backup"):
    """Send the DB snapshot to the configured Telegram chat."""
    token   = os.environ.get("TELEGRAM_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        app.logger.warning("Telegram backup skipped — TOKEN or CHAT_ID not set")
        return
    try:
        buf, filename = _tg_snapshot()
        import requests as _r
        resp = _r.post(
            f"https://api.telegram.org/bot{token}/sendDocument",
            data={"chat_id": chat_id, "caption": caption},
            files={"document": (filename, buf, "application/octet-stream")},
            timeout=60,
        )
        if not resp.ok:
            app.logger.error("Telegram sendDocument failed: %s", resp.text)
    except Exception as exc:
        app.logger.error("Telegram backup error: %s", exc)


def _tg_register_webhook():
    """Tell Telegram where to POST incoming messages (runs on startup)."""
    token      = os.environ.get("TELEGRAM_TOKEN", "")
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    if not token or not render_url:
        return
    webhook_url = f"{render_url}/api/telegram/webhook"
    try:
        import requests as _r
        _r.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json={"url": webhook_url},
            timeout=10,
        )
        app.logger.info("Telegram webhook registered: %s", webhook_url)
    except Exception as exc:
        app.logger.warning("Telegram webhook registration failed: %s", exc)


def _start_scheduler():
    """Start the APScheduler background thread (call once per process)."""
    token = os.environ.get("TELEGRAM_TOKEN", "")
    if not token:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        sched = BackgroundScheduler(daemon=True)
        hour  = int(os.environ.get("BACKUP_HOUR", "8"))
        sched.add_job(
            lambda: _tg_send_backup("📦 Daily automatic backup"),
            CronTrigger(hour=hour, minute=0),
            id="daily_backup",
            replace_existing=True,
        )
        sched.start()
        app.logger.info("Backup scheduler started — daily at %02d:00 UTC", hour)
    except Exception as exc:
        app.logger.warning("Scheduler failed to start: %s", exc)


# ── Telegram webhook endpoint ─────────────────────────────────────────────────

@app.route("/api/telegram/webhook", methods=["POST"])
def telegram_webhook():
    """Receives updates from Telegram. Responds to /backup command."""
    payload = request.get_json(force=True, silent=True) or {}
    msg     = payload.get("message") or payload.get("edited_message") or {}
    chat    = msg.get("chat") or {}
    text    = (msg.get("text") or "").strip()

    # Only accept messages from the configured chat
    allowed = os.environ.get("TELEGRAM_CHAT_ID", "")
    if str(chat.get("id", "")) != allowed:
        return jsonify({"ok": True})

    cmd = text.split()[0].lower() if text else ""
    if cmd in ("/backup", "/export"):
        import threading
        _tg_send_message("⏳ Generating backup…")
        threading.Thread(
            target=_tg_send_backup,
            args=("📦 Manual backup",),
            daemon=True,
        ).start()

    return jsonify({"ok": True})


# ── Auth helpers ──────────────────────────────────────────────────────────────

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{2,32}$")


def current_user_id():
    return session.get("user_id")


def require_user(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        uid = current_user_id()
        if uid is None:
            return jsonify({"error": "unauthorized"}), 401
        return view(uid, *args, **kwargs)
    return wrapped


def _normalize_username(raw):
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    return name if USERNAME_RE.match(name) else None


# ── Auth routes ───────────────────────────────────────────────────────────────

@app.route("/api/auth/me")
def auth_me():
    uid = current_user_id()
    if uid is None:
        return jsonify({"user": None})
    conn = get_db()
    row = conn.execute(
        "SELECT id, username, created_at FROM users WHERE id = ?", (uid,)
    ).fetchone()
    conn.close()
    if not row:
        session.pop("user_id", None)
        return jsonify({"user": None})
    return jsonify({"user": dict(row)})


@app.route("/api/auth/signup", methods=["POST"])
def auth_signup():
    username = _normalize_username((request.json or {}).get("username", ""))
    if not username:
        return jsonify({"error": "username must be 2–32 characters, letters/numbers/underscore only"}), 400
    if get_user_by_username(username):
        return jsonify({"error": "username already taken"}), 409
    try:
        user = create_user(username)
    except sqlite3.IntegrityError:
        return jsonify({"error": "username already taken"}), 409
    session.permanent = True
    session["user_id"] = user["id"]
    return jsonify({"user": user}), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    username = _normalize_username((request.json or {}).get("username", ""))
    if not username:
        return jsonify({"error": "username must be 2–32 characters, letters/numbers/underscore only"}), 400
    user = get_user_by_username(username)
    if not user:
        return jsonify({"error": "no account with that username"}), 404
    session.permanent = True
    session["user_id"] = user["id"]
    return jsonify({"user": user})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.route("/api/auth/reset", methods=["POST"])
def auth_reset():
    username = _normalize_username((request.json or {}).get("username", ""))
    if not username:
        return jsonify({"error": "username required"}), 400
    conn = get_db()
    user = conn.execute(
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE", (username,)
    ).fetchone()
    if not user:
        conn.close()
        return jsonify({"error": "user not found"}), 404
    uid = user["id"]
    conn.execute("DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE user_id = ?)", (uid,))
    conn.execute("DELETE FROM tasks WHERE user_id = ?", (uid,))
    conn.execute(
        "DELETE FROM habit_completions WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)", (uid,)
    )
    conn.execute("DELETE FROM habits WHERE user_id = ?", (uid,))
    conn.execute("DELETE FROM goals WHERE user_id = ?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/auth/users", methods=["GET"])
def auth_users():
    conn = get_db()
    rows = conn.execute(
        "SELECT username, created_at FROM users ORDER BY created_at ASC"
    ).fetchall()
    conn.close()
    return jsonify([{"username": r["username"], "created_at": r["created_at"]} for r in rows])


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    """Lightweight liveness probe for UptimeRobot / Render health checks."""
    try:
        conn = get_db()
        conn.execute("SELECT 1").fetchone()
        conn.close()
        return jsonify({"status": "ok"}), 200
    except Exception as exc:
        return jsonify({"status": "error", "detail": str(exc)}), 500


# ── Backup / restore ──────────────────────────────────────────────────────────

@app.route("/api/backup/export-db")
def backup_export_db():
    """Download the entire SQLite database as a .db file.
    Uses SQLite's online backup API so the snapshot is always consistent.
    No session required — usable from the login page before signing in."""
    from database import DB
    if not os.path.exists(DB):
        return jsonify({"error": "database not found"}), 404

    # SQLite online backup → in-memory bytes (safe even with concurrent writes)
    buf = io.BytesIO()
    fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    try:
        src = sqlite3.connect(DB)
        bak = sqlite3.connect(tmp_path)
        src.backup(bak)
        bak.close()
        src.close()
        with open(tmp_path, "rb") as f:
            buf.write(f.read())
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    buf.seek(0)
    filename = f"hypercube_{date.today()}.db"
    return send_file(
        buf,
        as_attachment=True,
        download_name=filename,
        mimetype="application/octet-stream",
    )


@app.route("/api/backup/import-db", methods=["POST"])
def backup_import_db():
    """Replace the database with an uploaded .db file.
    No session required — this is the recovery path after a Render redeploy wipes data."""
    from database import DB, init_db as _init_db

    uploaded = request.files.get("db")
    if not uploaded:
        return jsonify({"error": "no file provided (field name: db)"}), 400

    # Validate SQLite magic header before touching anything
    header = uploaded.read(16)
    uploaded.seek(0)
    if not header.startswith(b"SQLite format 3"):
        return jsonify({"error": "not a valid SQLite database file"}), 400

    # Write to a temp path first, then atomically swap into place
    tmp_path = DB + ".import_tmp"
    try:
        uploaded.save(tmp_path)
        os.replace(tmp_path, DB)  # atomic on POSIX; best-effort on Windows
    except Exception as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return jsonify({"error": str(exc)}), 500

    # Run schema migrations so any new columns are added to the restored DB
    try:
        _init_db()
    except Exception:
        pass

    return jsonify({"ok": True})


# ── Index ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Tasks ─────────────────────────────────────────────────────────────────────

def _task_delegation_info(conn, task):
    """Attach delegation_out / delegation_in dicts to a task dict (mutates in place)."""
    if task.get("delegated_out"):
        row = conn.execute(
            """SELECT d.id, d.status, u.username AS to_username
                 FROM delegations d JOIN users u ON d.to_user_id = u.id
                WHERE d.id = ?""",
            (task["delegated_out"],),
        ).fetchone()
        task["delegation_out"] = dict(row) if row else None
    else:
        task["delegation_out"] = None

    if task.get("delegation_id"):
        row = conn.execute(
            """SELECT d.id, d.status, u.username AS from_username
                 FROM delegations d JOIN users u ON d.from_user_id = u.id
                WHERE d.id = ?""",
            (task["delegation_id"],),
        ).fetchone()
        task["delegation_in"] = dict(row) if row else None
    else:
        task["delegation_in"] = None


@app.route("/api/tasks", methods=["GET"])
@require_user
def get_tasks(uid):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, priority DESC, created_at DESC",
        (uid,),
    ).fetchall()
    tasks = []
    for row in rows:
        task = dict(row)
        task["time_logged"] = conn.execute(
            "SELECT COALESCE(SUM(duration_minutes), 0) FROM task_logs WHERE task_id = ?",
            (task["id"],),
        ).fetchone()[0]
        _task_delegation_info(conn, task)
        tasks.append(task)
    conn.close()
    return jsonify(tasks)


@app.route("/api/tasks/<int:task_id>/log", methods=["POST"])
@require_user
def log_task_time(uid, task_id):
    minutes = int(request.json.get("minutes", 0))
    if minutes <= 0:
        return jsonify({"error": "minutes must be positive"}), 400
    conn = get_db()
    task_row = conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid)
    ).fetchone()
    if not task_row:
        conn.close()
        return jsonify({"error": "task not found"}), 404
    conn.execute(
        "INSERT INTO task_logs (task_id, duration_minutes) VALUES (?, ?)",
        (task_id, minutes),
    )
    conn.commit()
    task = dict(task_row)
    task["time_logged"] = conn.execute(
        "SELECT COALESCE(SUM(duration_minutes), 0) FROM task_logs WHERE task_id = ?",
        (task_id,),
    ).fetchone()[0]
    conn.close()
    return jsonify(task)


@app.route("/api/tasks/<int:task_id>/log", methods=["DELETE"])
@require_user
def reset_task_log(uid, task_id):
    conn = get_db()
    task_row = conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid)
    ).fetchone()
    if not task_row:
        conn.close()
        return jsonify({"error": "task not found"}), 404
    conn.execute("DELETE FROM task_logs WHERE task_id = ?", (task_id,))
    conn.commit()
    task = dict(task_row)
    task["time_logged"] = 0
    conn.close()
    return jsonify(task)


# ── Task delegation ───────────────────────────────────────────────────────────

@app.route("/api/tasks/<int:task_id>/delegate", methods=["POST"])
@require_user
def delegate_task(uid, task_id):
    data     = request.json or {}
    username = (data.get("username") or "").strip()
    note     = (data.get("note")     or "").strip()
    if not username:
        return jsonify({"error": "username required"}), 400

    conn = get_db()

    task = conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid)
    ).fetchone()
    if not task:
        conn.close()
        return jsonify({"error": "task not found"}), 404

    target = conn.execute(
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE", (username,)
    ).fetchone()
    if not target:
        conn.close()
        return jsonify({"error": f"user '{username}' not found"}), 404

    to_uid = target["id"]
    if to_uid == uid:
        conn.close()
        return jsonify({"error": "cannot delegate to yourself"}), 400

    # Create a copy of the task in the recipient's account
    cur = conn.execute(
        """INSERT INTO tasks
             (title, priority, deadline, urgent, important,
              category, estimated_minutes, task_type, chapter, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (task["title"], task["priority"], task["deadline"],
         task["urgent"], task["important"], task["category"],
         task["estimated_minutes"], task["task_type"], task["chapter"],
         to_uid),
    )
    copy_id = cur.lastrowid

    # Create delegation record
    dcur = conn.execute(
        """INSERT INTO delegations
             (original_task_id, copy_task_id, from_user_id, to_user_id, status, note)
           VALUES (?, ?, ?, ?, 'pending', ?)""",
        (task_id, copy_id, uid, to_uid, note or None),
    )
    deleg_id = dcur.lastrowid

    # Link copy and original to the delegation
    conn.execute("UPDATE tasks SET delegation_id = ? WHERE id = ?",  (deleg_id, copy_id))
    conn.execute("UPDATE tasks SET delegated_out = ? WHERE id = ?",  (deleg_id, task_id))
    conn.commit()

    row  = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    out  = dict(row)
    out["time_logged"] = conn.execute(
        "SELECT COALESCE(SUM(duration_minutes), 0) FROM task_logs WHERE task_id = ?",
        (task_id,),
    ).fetchone()[0]
    _task_delegation_info(conn, out)
    conn.close()
    return jsonify(out)


@app.route("/api/delegations/inbox", methods=["GET"])
@require_user
def delegation_inbox(uid):
    conn = get_db()
    rows = conn.execute(
        """SELECT d.id, d.status, d.note, d.created_at,
                  u.username AS from_username,
                  t.title    AS task_title,
                  d.copy_task_id
             FROM delegations d
             JOIN users u ON d.from_user_id = u.id
             JOIN tasks t ON d.original_task_id = t.id
            WHERE d.to_user_id = ? AND d.status = 'pending'
            ORDER BY d.created_at DESC""",
        (uid,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/delegations/outbox", methods=["GET"])
@require_user
def delegation_outbox(uid):
    conn = get_db()
    rows = conn.execute(
        """SELECT d.id, d.status, d.note, d.created_at,
                  u.username AS to_username,
                  t.title    AS task_title
             FROM delegations d
             JOIN users u ON d.to_user_id = u.id
             JOIN tasks t ON d.original_task_id = t.id
            WHERE d.from_user_id = ?
            ORDER BY d.created_at DESC""",
        (uid,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/delegations/<int:deleg_id>/accept", methods=["POST"])
@require_user
def accept_delegation(uid, deleg_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM delegations WHERE id = ? AND to_user_id = ?", (deleg_id, uid)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "delegation not found"}), 404
    conn.execute("UPDATE delegations SET status = 'accepted' WHERE id = ?", (deleg_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/delegations/<int:deleg_id>/decline", methods=["POST"])
@require_user
def decline_delegation(uid, deleg_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM delegations WHERE id = ? AND to_user_id = ?", (deleg_id, uid)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "delegation not found"}), 404
    # Delete the copy task and clear links
    if row["copy_task_id"]:
        conn.execute("DELETE FROM task_logs WHERE task_id = ?", (row["copy_task_id"],))
        conn.execute("DELETE FROM tasks WHERE id = ?",          (row["copy_task_id"],))
    conn.execute("UPDATE tasks SET delegated_out = NULL WHERE delegated_out = ?", (deleg_id,))
    conn.execute("UPDATE delegations SET status = 'declined', copy_task_id = NULL WHERE id = ?", (deleg_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/delegations/<int:deleg_id>/unaccept", methods=["POST"])
@require_user
def unaccept_delegation(uid, deleg_id):
    """Recipient reverts an accepted delegation back to pending."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM delegations WHERE id = ? AND to_user_id = ? AND status = 'accepted'",
        (deleg_id, uid),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "delegation not found or not accepted"}), 404
    conn.execute("UPDATE delegations SET status = 'pending' WHERE id = ?", (deleg_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/delegations/<int:deleg_id>/revoke", methods=["POST"])
@require_user
def revoke_delegation(uid, deleg_id):
    """Sender cancels a delegation they sent (any status except done)."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM delegations WHERE id = ? AND from_user_id = ? AND status != 'done'",
        (deleg_id, uid),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "delegation not found or already completed"}), 404
    # Remove copy task from recipient's account
    if row["copy_task_id"]:
        conn.execute("DELETE FROM task_logs WHERE task_id = ?", (row["copy_task_id"],))
        conn.execute("DELETE FROM tasks WHERE id = ?",          (row["copy_task_id"],))
    # Clear delegated_out on original task so it becomes a normal task again
    conn.execute("UPDATE tasks SET delegated_out = NULL WHERE delegated_out = ?", (deleg_id,))
    conn.execute("UPDATE delegations SET status = 'revoked', copy_task_id = NULL WHERE id = ?", (deleg_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Server-side matrix timer ──────────────────────────────────────────────────

def _timer_elapsed(row):
    """Return elapsed seconds for a timer row (running or paused)."""
    if row["paused"]:
        return row["accumulated_sec"]
    return row["accumulated_sec"] + int(time.time() - row["started_at"])


@app.route("/api/timer", methods=["GET"])
@require_user
def get_timer(uid):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM matrix_timers WHERE user_id = ?", (uid,)
    ).fetchall()
    conn.close()
    return jsonify([
        {
            "task_id":         row["task_id"],
            "elapsed_sec":     _timer_elapsed(row),
            "paused":          bool(row["paused"]),
            "started_at":      row["started_at"],
            "accumulated_sec": row["accumulated_sec"],
        }
        for row in rows
    ])


@app.route("/api/timer/start", methods=["POST"])
@require_user
def start_timer(uid):
    task_id = (request.json or {}).get("task_id")
    if not task_id:
        return jsonify({"error": "task_id required"}), 400
    now = time.time()
    conn = get_db()
    conn.execute(
        """INSERT OR REPLACE INTO matrix_timers
               (user_id, task_id, started_at, accumulated_sec, paused)
           VALUES (?, ?, ?, 0, 0)""",
        (uid, task_id, now),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "started_at": now, "accumulated_sec": 0})


@app.route("/api/timer/pause", methods=["POST"])
@require_user
def pause_timer(uid):
    task_id = (request.json or {}).get("task_id")
    if not task_id:
        return jsonify({"error": "task_id required"}), 400
    now = time.time()
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM matrix_timers WHERE user_id = ? AND task_id = ?", (uid, task_id)
    ).fetchone()
    if not row or row["paused"]:
        conn.close()
        return jsonify({"ok": False, "error": "no running timer for this task"}), 400
    new_acc = row["accumulated_sec"] + int(now - row["started_at"])
    conn.execute(
        "UPDATE matrix_timers SET accumulated_sec = ?, paused = 1 WHERE user_id = ? AND task_id = ?",
        (new_acc, uid, task_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "accumulated_sec": new_acc})


@app.route("/api/timer/resume", methods=["POST"])
@require_user
def resume_timer(uid):
    task_id = (request.json or {}).get("task_id")
    if not task_id:
        return jsonify({"error": "task_id required"}), 400
    now = time.time()
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM matrix_timers WHERE user_id = ? AND task_id = ?", (uid, task_id)
    ).fetchone()
    if not row or not row["paused"]:
        conn.close()
        return jsonify({"ok": False, "error": "timer not paused"}), 400
    conn.execute(
        "UPDATE matrix_timers SET paused = 0, started_at = ? WHERE user_id = ? AND task_id = ?",
        (now, uid, task_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "started_at": now})


@app.route("/api/timer", methods=["DELETE"])
@require_user
def delete_timer(uid):
    task_id = (request.json or {}).get("task_id") if request.is_json else None
    conn = get_db()
    if task_id:
        conn.execute(
            "DELETE FROM matrix_timers WHERE user_id = ? AND task_id = ?", (uid, task_id)
        )
    else:
        conn.execute("DELETE FROM matrix_timers WHERE user_id = ?", (uid,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/tasks", methods=["POST"])
@require_user
def create_task(uid):
    data = request.json
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO tasks
             (title, priority, deadline, urgent, important, category,
              estimated_minutes, task_type, chapter, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            data["title"], data.get("priority", "medium"), data.get("deadline"),
            int(bool(data.get("urgent", False))), int(bool(data.get("important", False))),
            data.get("category", ""), int(data.get("estimated_minutes", 0)),
            data.get("task_type", ""), data.get("chapter", ""),
            uid,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
@require_user
def update_task(uid, task_id):
    data = request.json
    conn = get_db()
    owner = conn.execute(
        "SELECT 1 FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid)
    ).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "task not found"}), 404
    if "completed" in data:
        completed_at = str(date.today()) if data["completed"] else None
        conn.execute(
            "UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ?",
            (int(data["completed"]), completed_at, task_id),
        )
        # If this is a received delegation copy being completed, mark delegation done
        if data["completed"]:
            owner = conn.execute(
                "SELECT delegation_id FROM tasks WHERE id = ? AND user_id = ?",
                (task_id, uid),
            ).fetchone()
            if owner and owner["delegation_id"]:
                conn.execute(
                    "UPDATE delegations SET status = 'done' WHERE id = ?",
                    (owner["delegation_id"],),
                )
    if "title" in data:
        conn.execute("UPDATE tasks SET title = ? WHERE id = ?", (data["title"], task_id))
    if "priority" in data:
        conn.execute("UPDATE tasks SET priority = ? WHERE id = ?", (data["priority"], task_id))
    if "urgent" in data:
        conn.execute("UPDATE tasks SET urgent = ? WHERE id = ?", (int(bool(data["urgent"])), task_id))
    if "important" in data:
        conn.execute("UPDATE tasks SET important = ? WHERE id = ?", (int(bool(data["important"])), task_id))
    if "deadline" in data:
        conn.execute("UPDATE tasks SET deadline = ? WHERE id = ?", (data.get("deadline"), task_id))
    if "category" in data:
        conn.execute("UPDATE tasks SET category = ? WHERE id = ?", (data.get("category", ""), task_id))
    if "estimated_minutes" in data:
        conn.execute("UPDATE tasks SET estimated_minutes = ? WHERE id = ?", (int(data.get("estimated_minutes") or 0), task_id))
    if "task_type" in data:
        conn.execute("UPDATE tasks SET task_type = ? WHERE id = ?", (data.get("task_type", ""), task_id))
    if "chapter" in data:
        conn.execute("UPDATE tasks SET chapter = ? WHERE id = ?", (data.get("chapter", ""), task_id))
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@require_user
def delete_task(uid, task_id):
    conn = get_db()
    cur = conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if not deleted:
        return jsonify({"error": "task not found"}), 404
    return "", 204


# ── Habits ────────────────────────────────────────────────────────────────────

@app.route("/api/habits", methods=["GET"])
@require_user
def get_habits(uid):
    today = str(date.today())
    conn = get_db()
    habits = conn.execute(
        "SELECT * FROM habits WHERE active = 1 AND user_id = ? ORDER BY created_at ASC",
        (uid,),
    ).fetchall()
    result = []
    for h in habits:
        h = dict(h)
        comp = conn.execute(
            "SELECT duration_minutes, check_count FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
            (h["id"], today),
        ).fetchone()
        h["done_today"]        = bool(comp) and comp["check_count"] > 0
        h["check_count_today"] = comp["check_count"]      if comp else 0
        h["time_logged_today"] = comp["duration_minutes"] if comp else 0
        h["streak"] = _calc_streak(conn, h["id"])
        result.append(h)
    conn.close()
    return jsonify(result)


def _calc_streak(conn, habit_id):
    rows = conn.execute(
        "SELECT completion_date FROM habit_completions WHERE habit_id = ? ORDER BY completion_date DESC",
        (habit_id,),
    ).fetchall()
    dates = {r["completion_date"] for r in rows}
    streak = 0
    check = date.today()
    while str(check) in dates:
        streak += 1
        check -= timedelta(days=1)
    return streak


@app.route("/api/habits", methods=["POST"])
@require_user
def create_habit(uid):
    data = request.json
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO habits (name, user_id) VALUES (?, ?)",
        (data["name"], uid),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    h = dict(row)
    h["done_today"] = False
    h["streak"] = 0
    return jsonify(h), 201


@app.route("/api/habits/<int:habit_id>/toggle", methods=["POST"])
@require_user
def toggle_habit(uid, habit_id):
    """Increment the check count for today (each tap = +1 check)."""
    today = str(date.today())
    conn = get_db()
    owner = conn.execute(
        "SELECT 1 FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)
    ).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "habit not found"}), 404
    existing = conn.execute(
        "SELECT id, check_count, duration_minutes FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
        (habit_id, today),
    ).fetchone()
    if existing:
        # Add one unit of time per new check (unit = total ÷ current count)
        time_unit = existing["duration_minutes"] // existing["check_count"] if existing["check_count"] > 0 else 0
        conn.execute(
            """UPDATE habit_completions
                  SET check_count      = check_count + 1,
                      duration_minutes = duration_minutes + ?
                WHERE id = ?""",
            (time_unit, existing["id"]),
        )
        check_count = existing["check_count"] + 1
    else:
        conn.execute(
            "INSERT INTO habit_completions (habit_id, completion_date, check_count) VALUES (?, ?, 1)",
            (habit_id, today),
        )
        check_count = 1
    conn.commit()
    streak = _calc_streak(conn, habit_id)
    conn.close()
    return jsonify({"done_today": True, "check_count": check_count, "streak": streak})


@app.route("/api/habits/<int:habit_id>/uncheck", methods=["POST"])
@require_user
def uncheck_habit(uid, habit_id):
    """Decrement the check count; delete the completion row when it hits 0."""
    today = str(date.today())
    conn = get_db()
    owner = conn.execute(
        "SELECT 1 FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)
    ).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "habit not found"}), 404
    existing = conn.execute(
        "SELECT id, check_count FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
        (habit_id, today),
    ).fetchone()
    if not existing or existing["check_count"] <= 0:
        conn.close()
        return jsonify({"done_today": False, "check_count": 0})
    if existing["check_count"] == 1:
        conn.execute("DELETE FROM habit_completions WHERE id = ?", (existing["id"],))
        check_count = 0
    else:
        conn.execute(
            "UPDATE habit_completions SET check_count = check_count - 1 WHERE id = ?",
            (existing["id"],),
        )
        check_count = existing["check_count"] - 1
    conn.commit()
    streak = _calc_streak(conn, habit_id)
    conn.close()
    return jsonify({"done_today": check_count > 0, "check_count": check_count, "streak": streak})


@app.route("/api/habits/<int:habit_id>/reset", methods=["POST"])
@require_user
def reset_habit(uid, habit_id):
    """Completely remove today's completion (ignores check count)."""
    today = str(date.today())
    conn = get_db()
    owner = conn.execute(
        "SELECT 1 FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)
    ).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "habit not found"}), 404
    conn.execute(
        "DELETE FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
        (habit_id, today),
    )
    conn.commit()
    conn.close()
    return jsonify({"done_today": False, "check_count": 0})


@app.route("/api/habits/<int:habit_id>/log", methods=["POST"])
@require_user
def log_habit_time(uid, habit_id):
    minutes = int((request.json or {}).get("minutes", 0))
    if minutes <= 0:
        return jsonify({"error": "minutes must be positive"}), 400
    today = str(date.today())
    conn = get_db()
    owner = conn.execute(
        "SELECT 1 FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)
    ).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "habit not found"}), 404
    existing = conn.execute(
        "SELECT id FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
        (habit_id, today),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE habit_completions SET duration_minutes = duration_minutes + ? WHERE id = ?",
            (minutes, existing["id"]),
        )
    else:
        # Log time also marks the habit done for today
        conn.execute(
            "INSERT INTO habit_completions (habit_id, completion_date, duration_minutes) VALUES (?, ?, ?)",
            (habit_id, today, minutes),
        )
    conn.commit()
    row = conn.execute(
        "SELECT duration_minutes FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
        (habit_id, today),
    ).fetchone()
    conn.close()
    return jsonify({"time_logged_today": row["duration_minutes"]})


@app.route("/api/habits/<int:habit_id>", methods=["DELETE"])
@require_user
def delete_habit(uid, habit_id):
    conn = get_db()
    cur = conn.execute(
        "UPDATE habits SET active = 0 WHERE id = ? AND user_id = ?",
        (habit_id, uid),
    )
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if not deleted:
        return jsonify({"error": "habit not found"}), 404
    return "", 204


# ── Goals ─────────────────────────────────────────────────────────────────────

@app.route("/api/goals", methods=["GET"])
@require_user
def get_goals(uid):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC",
        (uid,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/goals", methods=["POST"])
@require_user
def create_goal(uid):
    data = request.json
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO goals (title, target_value, current_value, unit, deadline, user_id)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            data["title"],
            float(data["target_value"]),
            float(data.get("current_value", 0)),
            data.get("unit", ""),
            data.get("deadline"),
            uid,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM goals WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@app.route("/api/goals/<int:goal_id>", methods=["PUT"])
@require_user
def update_goal(uid, goal_id):
    data = request.json
    conn = get_db()
    owner = conn.execute(
        "SELECT 1 FROM goals WHERE id = ? AND user_id = ?", (goal_id, uid)
    ).fetchone()
    if not owner:
        conn.close()
        return jsonify({"error": "goal not found"}), 404
    if "current_value" in data:
        conn.execute(
            "UPDATE goals SET current_value = ? WHERE id = ?",
            (float(data["current_value"]), goal_id),
        )
    if "title" in data:
        conn.execute("UPDATE goals SET title = ? WHERE id = ?", (data["title"], goal_id))
    conn.commit()
    row = conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))


@app.route("/api/goals/<int:goal_id>", methods=["DELETE"])
@require_user
def delete_goal(uid, goal_id):
    conn = get_db()
    cur = conn.execute(
        "DELETE FROM goals WHERE id = ? AND user_id = ?", (goal_id, uid)
    )
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    if not deleted:
        return jsonify({"error": "goal not found"}), 404
    return "", 204


# ── Analytics ─────────────────────────────────────────────────────────────────

@app.route("/api/analytics")
@require_user
def analytics(uid):
    conn = get_db()
    today = date.today()
    since = str(today - timedelta(days=6))

    # Daily time: task logs + habit time combined
    daily_time = conn.execute(
        """SELECT date, SUM(total) AS total FROM (
               SELECT tl.logged_at AS date, SUM(tl.duration_minutes) AS total
                 FROM task_logs tl
                 JOIN tasks t ON tl.task_id = t.id
                WHERE tl.logged_at >= ? AND t.user_id = ?
               GROUP BY tl.logged_at
               UNION ALL
               SELECT hc.completion_date AS date, SUM(hc.duration_minutes) AS total
                 FROM habit_completions hc
                 JOIN habits h ON hc.habit_id = h.id
                WHERE hc.completion_date >= ? AND h.user_id = ?
                  AND hc.duration_minutes > 0
               GROUP BY hc.completion_date
           )
         GROUP BY date ORDER BY date ASC""",
        (since, uid, since, uid),
    ).fetchall()
    daily_map = {r["date"]: r["total"] for r in daily_time}
    daily_filled = [
        {"date": str(today - timedelta(days=6 - i)),
         "total": daily_map.get(str(today - timedelta(days=6 - i)), 0)}
        for i in range(7)
    ]

    # Time by priority (tasks) + habits as their own slice
    time_by_category = list(conn.execute(
        """SELECT t.priority AS category, SUM(tl.duration_minutes) AS total
             FROM task_logs tl
             JOIN tasks t ON tl.task_id = t.id
            WHERE tl.logged_at >= ? AND t.user_id = ?
         GROUP BY t.priority ORDER BY total DESC""",
        (since, uid),
    ).fetchall())
    habit_mins = conn.execute(
        """SELECT COALESCE(SUM(hc.duration_minutes), 0) AS total
             FROM habit_completions hc
             JOIN habits h ON hc.habit_id = h.id
            WHERE hc.completion_date >= ? AND h.user_id = ?""",
        (since, uid),
    ).fetchone()["total"]
    if habit_mins > 0:
        time_by_category = list(time_by_category) + [{"category": "habit", "total": habit_mins}]

    task_stats = conn.execute(
        """SELECT
               COUNT(*) AS total,
               SUM(completed) AS done,
               SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS pending
             FROM tasks WHERE user_id = ?""",
        (uid,),
    ).fetchone()

    habit_count = conn.execute(
        "SELECT COUNT(*) AS n FROM habits WHERE active = 1 AND user_id = ?",
        (uid,),
    ).fetchone()["n"]

    completions_7d = conn.execute(
        """SELECT COUNT(*) AS n FROM habit_completions hc
             JOIN habits h ON hc.habit_id = h.id
            WHERE hc.completion_date >= ? AND h.user_id = ?""",
        (since, uid),
    ).fetchone()["n"]

    habit_rate = round(completions_7d / max(habit_count * 7, 1) * 100)

    conn.close()
    return jsonify({
        "time_by_category": [dict(r) for r in time_by_category],
        "daily_time": daily_filled,
        "task_stats": dict(task_stats),
        "habit_completion_rate": habit_rate,
    })


# ── Forecast ──────────────────────────────────────────────────────────────────

@app.route("/api/forecast")
@require_user
def get_forecast(uid):
    conn = get_db()
    today = date.today()
    since = str(today - timedelta(days=59))

    rows = conn.execute(
        """SELECT tl.logged_at AS date, SUM(tl.duration_minutes) AS total
             FROM task_logs tl
             JOIN tasks t ON tl.task_id = t.id
            WHERE tl.logged_at >= ? AND t.user_id = ?
         GROUP BY tl.logged_at ORDER BY tl.logged_at ASC""",
        (since, uid),
    ).fetchall()
    conn.close()

    daily_map = {r["date"]: float(r["total"]) for r in rows}
    historical = [
        daily_map.get(str(today - timedelta(days=59 - i)), 0.0)
        for i in range(60)
    ]

    try:
        from predictor import forecast as run_forecast
        predictions = run_forecast(historical, horizon=7)
    except Exception as exc:
        return jsonify({"error": str(exc), "forecast": []}), 200

    future_dates = [str(today + timedelta(days=i + 1)) for i in range(7)]
    return jsonify({
        "forecast": [
            {"date": d, "value": round(v, 1)}
            for d, v in zip(future_dates, predictions)
        ]
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000, threaded=True)
