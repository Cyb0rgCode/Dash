import os
import sqlite3
from datetime import date

DB = os.path.join(os.environ.get("DATA_DIR", "."), "productivity.db")


def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


DEFAULT_OWNER = "sofien"


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at TEXT NOT NULL DEFAULT (date('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            priority TEXT NOT NULL DEFAULT 'medium',
            deadline TEXT,
            completed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (date('now')),
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS time_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            activity TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'general',
            duration_minutes INTEGER NOT NULL,
            log_date TEXT NOT NULL DEFAULT (date('now')),
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS habits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (date('now')),
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS habit_completions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            habit_id INTEGER NOT NULL,
            completion_date TEXT NOT NULL,
            UNIQUE(habit_id, completion_date),
            FOREIGN KEY (habit_id) REFERENCES habits(id)
        );

        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            target_value REAL NOT NULL,
            current_value REAL NOT NULL DEFAULT 0,
            unit TEXT NOT NULL DEFAULT '',
            deadline TEXT,
            created_at TEXT NOT NULL DEFAULT (date('now'))
        );

        CREATE TABLE IF NOT EXISTS task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            logged_at TEXT NOT NULL DEFAULT (date('now')),
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        );

        CREATE TABLE IF NOT EXISTS matrix_timers (
            user_id         INTEGER NOT NULL,
            task_id         INTEGER NOT NULL,
            started_at      REAL    NOT NULL,
            accumulated_sec INTEGER NOT NULL DEFAULT 0,
            paused          INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, task_id)
        );

        CREATE TABLE IF NOT EXISTS delegations (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            original_task_id INTEGER NOT NULL,
            copy_task_id     INTEGER,
            from_user_id     INTEGER NOT NULL,
            to_user_id       INTEGER NOT NULL,
            status           TEXT    NOT NULL DEFAULT 'pending',
            note             TEXT,
            created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (original_task_id) REFERENCES tasks(id),
            FOREIGN KEY (from_user_id)     REFERENCES users(id),
            FOREIGN KEY (to_user_id)       REFERENCES users(id)
        );
    """)
    conn.commit()

    # Per-table column migrations — safe to run on existing DBs.
    column_migrations = {
        "tasks": [
            ("urgent",            "INTEGER NOT NULL DEFAULT 0"),
            ("important",         "INTEGER NOT NULL DEFAULT 0"),
            ("category",          "TEXT NOT NULL DEFAULT ''"),
            ("estimated_minutes", "INTEGER NOT NULL DEFAULT 0"),
            ("task_type",         "TEXT NOT NULL DEFAULT ''"),
            ("chapter",           "TEXT NOT NULL DEFAULT ''"),
            ("user_id",           "INTEGER"),
            ("delegation_id",     "INTEGER"),   # set on received copies
            ("delegated_out",     "INTEGER"),   # set on tasks you delegated away
            ("archived",          "INTEGER NOT NULL DEFAULT 0"),
            ("archived_at",       "TEXT"),
        ],
        "habits":    [("user_id", "INTEGER")],
        "habit_completions": [
            ("duration_minutes", "INTEGER NOT NULL DEFAULT 0"),
            ("check_count",      "INTEGER NOT NULL DEFAULT 1"),
        ],
        "goals":     [("user_id", "INTEGER")],
        "time_logs": [("user_id", "INTEGER")],
    }
    for table, cols in column_migrations.items():
        for col, typedef in cols:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
                conn.commit()
            except sqlite3.OperationalError:
                pass  # column already exists

    # Migrate matrix_timers from single-PK (user_id only) → composite PK (user_id, task_id)
    pk_info = conn.execute("PRAGMA table_info(matrix_timers)").fetchall()
    pk_cols = [col["name"] for col in pk_info if col["pk"] > 0]
    if pk_cols == ["user_id"]:
        conn.execute("DROP TABLE matrix_timers")
        conn.execute("""CREATE TABLE matrix_timers (
            user_id         INTEGER NOT NULL,
            task_id         INTEGER NOT NULL,
            started_at      REAL    NOT NULL,
            accumulated_sec INTEGER NOT NULL DEFAULT 0,
            paused          INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, task_id)
        )""")
        conn.commit()

    # Ensure default owner exists and backfill any unowned rows to them.
    # This runs once: after the first run, all rows have user_id set, so
    # subsequent UPDATE ... WHERE user_id IS NULL is a cheap no-op.
    conn.execute(
        "INSERT OR IGNORE INTO users (username) VALUES (?)",
        (DEFAULT_OWNER,),
    )
    conn.commit()
    owner_id = conn.execute(
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
        (DEFAULT_OWNER,),
    ).fetchone()["id"]
    for table in ("tasks", "habits", "goals", "time_logs"):
        conn.execute(
            f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL",
            (owner_id,),
        )
    conn.commit()

    conn.close()


def get_user_by_username(username):
    """Return user row (or None) by case-insensitive username."""
    conn = get_db()
    row = conn.execute(
        "SELECT id, username, created_at FROM users WHERE username = ? COLLATE NOCASE",
        (username,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def create_user(username):
    """Insert a new user. Raises sqlite3.IntegrityError if username is taken."""
    conn = get_db()
    cur = conn.execute("INSERT INTO users (username) VALUES (?)", (username,))
    conn.commit()
    row = conn.execute(
        "SELECT id, username, created_at FROM users WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    conn.close()
    return dict(row)
