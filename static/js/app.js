// ── Utilities ──────────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  return res.json();
}

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Sidebar date ───────────────────────────────────────────────────────────────

function updateSidebarDate() {
  const d = new Date();
  $("#sidebar-date").textContent = d.toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
}
updateSidebarDate();

// ── Tab navigation ─────────────────────────────────────────────────────────────

let activeTab = "dashboard";

$$(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    $$(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    $(`#tab-${activeTab}`).classList.add("active");
    if (activeTab === "dashboard") loadDashboard();
    if (activeTab === "tasks")    loadTasks();
    if (activeTab === "time")     loadLogs();
    if (activeTab === "habits")   { loadHabits(); loadGoals(); }
    if (activeTab === "matrix")   loadMatrix();
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

let dailyChart = null;
let categoryChart = null;

async function loadDashboard() {
  const [analytics, tasks, logs] = await Promise.all([
    api("/api/analytics"),
    api("/api/tasks"),
    api("/api/time-logs?days=1"),
  ]);

  const todayStr = today();
  const tasksDoneToday = tasks.filter(t => t.completed && t.completed_at === todayStr).length;
  const timeToday = logs
    .filter(l => l.log_date === todayStr)
    .reduce((s, l) => s + l.duration_minutes, 0);
  const pending = analytics.task_stats.pending;

  $("#stat-tasks-done").textContent = tasksDoneToday;
  $("#stat-time-today").textContent = (timeToday / 60).toFixed(1) + "h";
  $("#stat-habit-rate").textContent = analytics.habit_completion_rate + "%";
  $("#stat-pending").textContent = pending;

  renderDailyChart(analytics.daily_time);
  renderCategoryChart(analytics.time_by_category);
}

function renderDailyChart(data) {
  const ctx = $("#chart-daily").getContext("2d");
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })),
      datasets: [{
        label: "Minutes",
        data: data.map(d => d.total),
        backgroundColor: "rgba(108,99,255,0.7)",
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#7c8499" }, grid: { color: "#2e3347" } },
        y: { ticks: { color: "#7c8499" }, grid: { color: "#2e3347" }, beginAtZero: true },
      },
    },
  });
}

function renderCategoryChart(data) {
  const ctx = $("#chart-category").getContext("2d");
  if (categoryChart) categoryChart.destroy();
  if (!data.length) return;
  const colors = ["#6c63ff","#22c55e","#f59e0b","#ef4444","#38bdf8","#e879f9"];
  categoryChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: data.map(d => d.category),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: colors.slice(0, data.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: "#e2e8f0", boxWidth: 12, padding: 16 } },
      },
    },
  });
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

let allTasks = [];
let taskFilter = "all";

async function loadTasks() {
  allTasks = await api("/api/tasks");
  renderTasks();
}

function renderTasks() {
  const list = $("#task-list");
  let tasks = allTasks;
  if (taskFilter === "pending") tasks = tasks.filter(t => !t.completed);
  if (taskFilter === "done") tasks = tasks.filter(t => t.completed);

  if (!tasks.length) {
    list.innerHTML = '<li style="color:var(--muted);justify-content:center;">No tasks here</li>';
    return;
  }

  list.innerHTML = tasks.map(t => `
    <li class="${t.completed ? "done" : ""}" data-id="${t.id}">
      <button class="habit-check ${t.completed ? "done" : ""}" data-action="toggle" title="Toggle complete">
        ${t.completed ? "✓" : ""}
      </button>
      <span class="item-title">${escHtml(t.title)}</span>
      <span class="badge badge-${t.priority}">${t.priority}</span>
      ${t.deadline ? `<span class="item-meta">${t.deadline}</span>` : ""}
      <button class="btn-icon" data-action="delete" title="Delete">✕</button>
    </li>
  `).join("");
}

// ── Urgent / Important toggles ─────────────────────────────────────────────────

$$(".toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const pressed = btn.getAttribute("aria-pressed") === "true";
    btn.setAttribute("aria-pressed", String(!pressed));
  });
});

function getToggle(id) {
  return $("#" + id).getAttribute("aria-pressed") === "true";
}
function resetToggle(id) {
  $("#" + id).setAttribute("aria-pressed", "false");
}

$("#task-form").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("#task-title").value.trim();
  if (!title) return;
  const task = await api("/api/tasks", "POST", {
    title,
    priority:  $("#task-priority").value,
    deadline:  $("#task-deadline").value || null,
    urgent:    getToggle("task-urgent"),
    important: getToggle("task-important"),
  });
  allTasks.unshift(task);
  renderTasks();
  toast("Task added");
  $("#task-title").value = "";
  $("#task-deadline").value = "";
  resetToggle("task-urgent");
  resetToggle("task-important");
});

$("#task-list").addEventListener("click", async e => {
  const li = e.target.closest("li");
  if (!li) return;
  const id = Number(li.dataset.id);
  const action = e.target.dataset.action || e.target.closest("[data-action]")?.dataset.action;
  if (action === "toggle") {
    const task = allTasks.find(t => t.id === id);
    const updated = await api(`/api/tasks/${id}`, "PUT", { completed: !task.completed });
    const idx = allTasks.findIndex(t => t.id === id);
    allTasks[idx] = updated;
    renderTasks();
  }
  if (action === "delete") {
    await api(`/api/tasks/${id}`, "DELETE");
    allTasks = allTasks.filter(t => t.id !== id);
    renderTasks();
    toast("Task deleted");
  }
});

$$(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    taskFilter = btn.dataset.filter;
    renderTasks();
  });
});

// ── Time Tracker ───────────────────────────────────────────────────────────────

let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;

function fmtTimer(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

$("#timer-start").addEventListener("click", () => {
  if (timerRunning) return;
  timerRunning = true;
  timerSeconds = 0;
  const display = $("#timer-display");
  display.textContent = "00:00:00";
  display.classList.add("running");
  $("#timer-start").disabled = true;
  $("#timer-stop").disabled = false;
  timerInterval = setInterval(() => {
    timerSeconds++;
    display.textContent = fmtTimer(timerSeconds);
  }, 1000);
});

$("#timer-stop").addEventListener("click", async () => {
  if (!timerRunning) return;
  clearInterval(timerInterval);
  timerRunning = false;
  const display = $("#timer-display");
  display.classList.remove("running");
  $("#timer-start").disabled = false;
  $("#timer-stop").disabled = true;

  const mins = Math.max(1, Math.round(timerSeconds / 60));
  const activity = $("#timer-activity").value.trim() || "Untitled session";
  await api("/api/time-logs", "POST", {
    activity,
    category: $("#timer-category").value,
    duration_minutes: mins,
    log_date: today(),
  });
  timerSeconds = 0;
  display.textContent = "00:00:00";
  toast(`Saved: ${fmtMinutes(mins)} logged`);
  loadLogs();
});

$("#log-form").addEventListener("submit", async e => {
  e.preventDefault();
  const activity = $("#log-activity").value.trim();
  if (!activity) return;
  await api("/api/time-logs", "POST", {
    activity,
    category: $("#log-category").value,
    duration_minutes: Number($("#log-duration").value),
    log_date: $("#log-date").value || today(),
  });
  $("#log-activity").value = "";
  $("#log-duration").value = "";
  toast("Entry logged");
  loadLogs();
});

async function loadLogs() {
  const logs = await api("/api/time-logs?days=7");
  const list = $("#log-list");
  if (!logs.length) {
    list.innerHTML = '<li style="color:var(--muted);justify-content:center;">No entries yet</li>';
    return;
  }
  list.innerHTML = logs.map(l => `
    <li data-id="${l.id}">
      <span class="item-title">${escHtml(l.activity)}</span>
      <span class="badge badge-medium">${escHtml(l.category)}</span>
      <span class="item-meta">${fmtMinutes(l.duration_minutes)}</span>
      <span class="item-meta">${l.log_date}</span>
      <button class="btn-icon" data-action="delete" title="Delete">✕</button>
    </li>
  `).join("");
}

$("#log-list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-action='delete']");
  if (!btn) return;
  const id = Number(btn.closest("li").dataset.id);
  await api(`/api/time-logs/${id}`, "DELETE");
  toast("Log deleted");
  loadLogs();
});

// ── Habits ─────────────────────────────────────────────────────────────────────

async function loadHabits() {
  const habits = await api("/api/habits");
  const list = $("#habit-list");
  if (!habits.length) {
    list.innerHTML = '<li style="color:var(--muted);justify-content:center;">No habits yet</li>';
    return;
  }
  list.innerHTML = habits.map(h => `
    <li data-id="${h.id}">
      <button class="habit-check ${h.done_today ? "done" : ""}" data-action="toggle" title="Toggle today">
        ${h.done_today ? "✓" : ""}
      </button>
      <span class="item-title">${escHtml(h.name)}</span>
      <span class="streak-badge">${h.streak > 0 ? `🔥 ${h.streak}d` : ""}</span>
      <button class="btn-icon" data-action="delete" title="Delete">✕</button>
    </li>
  `).join("");
}

$("#habit-form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("#habit-name").value.trim();
  if (!name) return;
  await api("/api/habits", "POST", { name });
  $("#habit-name").value = "";
  toast("Habit added");
  loadHabits();
});

$("#habit-list").addEventListener("click", async e => {
  const li = e.target.closest("li");
  if (!li) return;
  const id = Number(li.dataset.id);
  const action = e.target.dataset.action || e.target.closest("[data-action]")?.dataset.action;
  if (action === "toggle") {
    await api(`/api/habits/${id}/toggle`, "POST");
    loadHabits();
  }
  if (action === "delete") {
    await api(`/api/habits/${id}`, "DELETE");
    loadHabits();
  }
});

// ── Goals ──────────────────────────────────────────────────────────────────────

async function loadGoals() {
  const goals = await api("/api/goals");
  const list = $("#goal-list");
  if (!goals.length) {
    list.innerHTML = '<li style="color:var(--muted);justify-content:center;">No goals yet</li>';
    return;
  }
  list.innerHTML = goals.map(g => {
    const pct = Math.min(100, Math.round((g.current_value / g.target_value) * 100));
    return `
      <li data-id="${g.id}" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="item-title" style="flex:1">${escHtml(g.title)}</span>
          ${g.deadline ? `<span class="item-meta">${g.deadline}</span>` : ""}
          <button class="btn-icon" data-action="delete" title="Delete">✕</button>
        </div>
        <div class="goal-progress-wrap">
          <div class="goal-bar-bg"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
          <div class="goal-label-row">
            <span>${g.current_value} / ${g.target_value} ${escHtml(g.unit)}</span>
            <span>${pct}%</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="color:var(--muted);font-size:12px;">Update progress:</span>
          <input class="goal-input-inline" type="number" data-action="update-val" value="${g.current_value}" min="0" max="${g.target_value}" step="any" />
          <button class="btn-icon" data-action="save-val" style="color:var(--green)" title="Save">✓</button>
        </div>
      </li>
    `;
  }).join("");
}

$("#goal-form").addEventListener("submit", async e => {
  e.preventDefault();
  const title = $("#goal-title").value.trim();
  if (!title) return;
  await api("/api/goals", "POST", {
    title,
    target_value: Number($("#goal-target").value),
    unit: $("#goal-unit").value.trim(),
    deadline: $("#goal-deadline").value || null,
  });
  $("#goal-title").value = "";
  $("#goal-target").value = "";
  $("#goal-unit").value = "";
  $("#goal-deadline").value = "";
  toast("Goal added");
  loadGoals();
});

$("#goal-list").addEventListener("click", async e => {
  const li = e.target.closest("li");
  if (!li) return;
  const id = Number(li.dataset.id);
  const action = e.target.dataset.action;
  if (action === "delete") {
    await api(`/api/goals/${id}`, "DELETE");
    loadGoals();
  }
  if (action === "save-val") {
    const input = li.querySelector("[data-action='update-val']");
    await api(`/api/goals/${id}`, "PUT", { current_value: Number(input.value) });
    toast("Progress updated");
    loadGoals();
  }
});

// ── Eisenhower Matrix ──────────────────────────────────────────────────────────

let matrixTasks = [];

async function loadMatrix() {
  matrixTasks = await api("/api/tasks");
  const open = matrixTasks.filter(t => !t.completed);
  renderMatrixQuadrant("matrix-q1", open.filter(t =>  t.urgent &&  t.important));
  renderMatrixQuadrant("matrix-q2", open.filter(t => !t.urgent &&  t.important));
  renderMatrixQuadrant("matrix-q3", open.filter(t =>  t.urgent && !t.important));
  renderMatrixQuadrant("matrix-q4", open.filter(t => !t.urgent && !t.important));
}

function renderMatrixQuadrant(listId, tasks) {
  const list = $(`#${listId}`);
  if (!tasks.length) {
    list.innerHTML = '<li class="matrix-empty">No tasks</li>';
    return;
  }
  list.innerHTML = tasks.map(t => `
    <li class="matrix-task" data-id="${t.id}">
      <button class="matrix-check" data-action="toggle" title="Mark complete"></button>
      <span>${escHtml(t.title)}</span>
      ${t.deadline ? `<span class="item-meta" style="margin-left:auto;font-size:11px">${t.deadline}</span>` : ""}
    </li>
  `).join("");
}

$("#tab-matrix").addEventListener("click", async e => {
  const btn = e.target.closest("[data-action='toggle']");
  if (!btn) return;
  const li = btn.closest(".matrix-task");
  const id = Number(li.dataset.id);
  await api(`/api/tasks/${id}`, "PUT", { completed: true });
  toast("Task done");
  loadMatrix();
});

// ── Toast notifications ────────────────────────────────────────────────────────

function toast(msg, type = "success") {
  const container = $("#toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("fade-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 2600);
}

// ── Escape HTML ────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Init ───────────────────────────────────────────────────────────────────────

loadDashboard();

// Set today's date as default in log form
$("#log-date").value = today();
