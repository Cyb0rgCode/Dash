# Dash

A personal productivity dashboard for tracking tasks, time, habits, and goals — all in one place.

## Features

- **Tasks** — Create and prioritize tasks (high/medium/low), set deadlines, and mark them complete
- **Time Tracker** — Log work sessions with a built-in timer or manual entry, categorized by type (Deep Work, Meetings, Admin, Learning, General)
- **Habits** — Build daily habits with automatic streak tracking
- **Goals** — Set measurable goals with target values and track progress visually
- **Dashboard** — Analytics overview with Chart.js visualizations: daily time logged and category distribution

## Tech Stack

- **Backend:** Python 3, Flask, SQLite
- **Frontend:** Vanilla JavaScript, Chart.js, CSS3 (dark theme)

## Getting Started

**Prerequisites:** Python 3.8+

```bash
# Clone the repository
git clone https://github.com/cyb0rgcode/dash.git
cd dash

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

Open your browser at `http://localhost:5000`.

The SQLite database is created automatically on first run — no setup required.

## Project Structure

```
Dash/
├── app.py           # Flask application and API endpoints
├── database.py      # Database initialization and connection
├── requirements.txt
├── static/
│   ├── css/style.css
│   └── js/app.js
└── templates/
    └── index.html
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/tasks` | List or create tasks |
| PUT/DELETE | `/api/tasks/<id>` | Update or delete a task |
| GET/POST | `/api/time-logs` | List or create time logs |
| DELETE | `/api/time-logs/<id>` | Delete a time log |
| GET/POST | `/api/habits` | List or create habits |
| POST | `/api/habits/<id>/toggle` | Toggle today's habit completion |
| DELETE | `/api/habits/<id>` | Deactivate a habit |
| GET/POST/PUT/DELETE | `/api/goals` | Full CRUD for goals |
| GET | `/api/analytics` | Aggregate stats for the dashboard |
