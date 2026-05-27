"""
Production Gunicorn config for Render (and any WSGI host).

Start command:   gunicorn -c gunicorn.conf.py app:app
Render env var:  PORT is injected automatically.
"""
import os

# ── Binding ───────────────────────────────────────────────────────────────────
# Render sets $PORT; fall back to 10000 (Render default) or 5000 locally.
bind = f"0.0.0.0:{os.environ.get('PORT', '10000')}"

# ── Workers ───────────────────────────────────────────────────────────────────
# 2 sync workers is the sweet spot for a 256 MB free container with SQLite.
# More workers = more memory = OOM kill.
workers     = 2
worker_class = "sync"

# ── Timeouts & keep-alive ─────────────────────────────────────────────────────
timeout   = 120   # kill a hung worker after 2 min
keepalive = 5     # reuse TCP connections for 5 s (good for UptimeRobot pings)

# ── Memory leak prevention ────────────────────────────────────────────────────
# Recycle each worker after N requests so slow leaks never accumulate.
max_requests        = 500
max_requests_jitter = 50   # stagger restarts so both workers don't die together

# ── App preloading ────────────────────────────────────────────────────────────
# Load the Flask app once in the master process, fork to workers.
# Saves ~25 MB RAM on the free tier and catches import errors at startup.
preload_app = True

# ── Logging ───────────────────────────────────────────────────────────────────
# Write everything to stdout/stderr so Render's log viewer picks it up.
accesslog      = "-"
errorlog       = "-"
loglevel       = "info"
capture_output = True


# ── Background tasks ──────────────────────────────────────────────────────────
# on_starting runs ONCE in the gunicorn master process before workers are forked.
# With preload_app=True, threads don't survive fork, so the scheduler and the
# webhook registration only live in the master — exactly what we want.
def on_starting(server):
    try:
        from app import _start_scheduler, _tg_register_webhook
        _start_scheduler()
        _tg_register_webhook()
    except Exception as exc:
        print(f"[gunicorn] Background tasks startup error: {exc}")
