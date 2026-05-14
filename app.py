from flask import Flask, jsonify, request, render_template
from datetime import date, timedelta
import sqlite3
from database import get_db, init_db

app = Flask(__name__)

init_db()


@app.route("/")
def index():
    return render_template("index.html")


# ── Tasks ──────────────────────────────────────────────────────────────────────

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM tasks ORDER BY completed ASC, priority DESC, created_at DESC"
    ).fetchall()
    tasks = []
    for row in rows:
        task = dict(row)
        task["time_logged"] = conn.execute(
            "SELECT COALESCE(SUM(duration_minutes), 0) FROM task_logs WHERE task_id = ?",
            (task["id"],),
        ).fetchone()[0]
        tasks.append(task)
    conn.close()
    return jsonify(tasks)


@app.route("/api/tasks/<int:task_id>/log", methods=["POST"])
def log_task_time(task_id):
    minutes = int(request.json.get("minutes", 0))
    if minutes <= 0:
        return jsonify({"error": "minutes must be positive"}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO task_logs (task_id, duration_minutes) VALUES (?, ?)",
        (task_id, minutes),
    )
    conn.commit()
    task = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
    task["time_logged"] = conn.execute(
        "SELECT COALESCE(SUM(duration_minutes), 0) FROM task_logs WHERE task_id = ?",
        (task_id,),
    ).fetchone()[0]
    conn.close()
    return jsonify(task)


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.json
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO tasks (title, priority, deadline, urgent, important, category, estimated_minutes, task_type, chapter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (data["title"], data.get("priority", "medium"), data.get("deadline"),
         int(bool(data.get("urgent", False))), int(bool(data.get("important", False))),
         data.get("category", ""), int(data.get("estimated_minutes", 0)),
         data.get("task_type", ""), data.get("chapter", "")),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.json
    conn = get_db()
    if "completed" in data:
        completed_at = str(date.today()) if data["completed"] else None
        conn.execute(
            "UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ?",
            (int(data["completed"]), completed_at, task_id),
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
def delete_task(task_id):
    conn = get_db()
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return "", 204


# ── Habits ─────────────────────────────────────────────────────────────────────

@app.route("/api/habits", methods=["GET"])
def get_habits():
    today = str(date.today())
    conn = get_db()
    habits = conn.execute(
        "SELECT * FROM habits WHERE active = 1 ORDER BY created_at ASC"
    ).fetchall()
    result = []
    for h in habits:
        h = dict(h)
        done_today = conn.execute(
            "SELECT 1 FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
            (h["id"], today),
        ).fetchone()
        h["done_today"] = bool(done_today)
        streak = _calc_streak(conn, h["id"])
        h["streak"] = streak
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
def create_habit():
    data = request.json
    conn = get_db()
    cur = conn.execute("INSERT INTO habits (name) VALUES (?)", (data["name"],))
    conn.commit()
    row = conn.execute("SELECT * FROM habits WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    h = dict(row)
    h["done_today"] = False
    h["streak"] = 0
    return jsonify(h), 201


@app.route("/api/habits/<int:habit_id>/toggle", methods=["POST"])
def toggle_habit(habit_id):
    today = str(date.today())
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
        (habit_id, today),
    ).fetchone()
    if existing:
        conn.execute(
            "DELETE FROM habit_completions WHERE habit_id = ? AND completion_date = ?",
            (habit_id, today),
        )
        done = False
    else:
        conn.execute(
            "INSERT INTO habit_completions (habit_id, completion_date) VALUES (?, ?)",
            (habit_id, today),
        )
        done = True
    conn.commit()
    streak = _calc_streak(conn, habit_id)
    conn.close()
    return jsonify({"done_today": done, "streak": streak})


@app.route("/api/habits/<int:habit_id>", methods=["DELETE"])
def delete_habit(habit_id):
    conn = get_db()
    conn.execute("UPDATE habits SET active = 0 WHERE id = ?", (habit_id,))
    conn.commit()
    conn.close()
    return "", 204


# ── Goals ──────────────────────────────────────────────────────────────────────

@app.route("/api/goals", methods=["GET"])
def get_goals():
    conn = get_db()
    rows = conn.execute("SELECT * FROM goals ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/goals", methods=["POST"])
def create_goal():
    data = request.json
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO goals (title, target_value, current_value, unit, deadline) VALUES (?, ?, ?, ?, ?)",
        (
            data["title"],
            float(data["target_value"]),
            float(data.get("current_value", 0)),
            data.get("unit", ""),
            data.get("deadline"),
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM goals WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@app.route("/api/goals/<int:goal_id>", methods=["PUT"])
def update_goal(goal_id):
    data = request.json
    conn = get_db()
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
def delete_goal(goal_id):
    conn = get_db()
    conn.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    conn.commit()
    conn.close()
    return "", 204


# ── Analytics ──────────────────────────────────────────────────────────────────

@app.route("/api/analytics")
def analytics():
    conn = get_db()
    today = date.today()

    since = str(today - timedelta(days=6))

    # Daily time totals from task logs over last 7 days
    daily_time = conn.execute(
        """SELECT logged_at as date, SUM(duration_minutes) as total
           FROM task_logs WHERE logged_at >= ?
           GROUP BY logged_at ORDER BY logged_at ASC""",
        (since,),
    ).fetchall()
    daily_map = {r["date"]: r["total"] for r in daily_time}
    daily_filled = []
    for i in range(7):
        d = str(today - timedelta(days=6 - i))
        daily_filled.append({"date": d, "total": daily_map.get(d, 0)})

    # Time by task priority over last 7 days
    time_by_category = conn.execute(
        """SELECT t.priority as category, SUM(tl.duration_minutes) as total
           FROM task_logs tl
           JOIN tasks t ON tl.task_id = t.id
           WHERE tl.logged_at >= ?
           GROUP BY t.priority ORDER BY total DESC""",
        (since,),
    ).fetchall()

    # Task completion stats
    task_stats = conn.execute(
        """SELECT
               COUNT(*) as total,
               SUM(completed) as done,
               SUM(CASE WHEN completed=0 THEN 1 ELSE 0 END) as pending
           FROM tasks"""
    ).fetchone()

    # Habit completion rate over last 7 days
    habit_count = conn.execute(
        "SELECT COUNT(*) as n FROM habits WHERE active = 1"
    ).fetchone()["n"]

    completions_7d = conn.execute(
        """SELECT COUNT(*) as n FROM habit_completions
           WHERE completion_date >= ?""",
        (since,),
    ).fetchone()["n"]

    habit_rate = round(completions_7d / max(habit_count * 7, 1) * 100)

    conn.close()
    return jsonify({
        "time_by_category": [dict(r) for r in time_by_category],
        "daily_time": daily_filled,
        "task_stats": dict(task_stats),
        "habit_completion_rate": habit_rate,
    })


# ── Forecast ───────────────────────────────────────────────────────────────────

@app.route("/api/forecast")
def get_forecast():
    conn = get_db()
    today = date.today()
    since = str(today - timedelta(days=59))  # 60 days of context

    rows = conn.execute(
        """SELECT logged_at AS date, SUM(duration_minutes) AS total
           FROM task_logs WHERE logged_at >= ?
           GROUP BY logged_at ORDER BY logged_at ASC""",
        (since,),
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
    app.run(debug=True, port=5000, threaded=True)
