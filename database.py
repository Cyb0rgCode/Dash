import sqlite3
from datetime import date

DB = "productivity.db"


def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
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
    """)
    conn.commit()
    conn.close()
