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
