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

function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late night focus";
}

function countUp(el, target, { decimals = 0, suffix = "", duration = 700 } = {}) {
  const startText = el.textContent.replace(/[^\d.-]/g, "");
  const start = parseFloat(startText) || 0;
  const startTime = performance.now();
  function tick(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = start + (target - start) * eased;
    el.textContent = (decimals ? value.toFixed(decimals) : Math.round(value)) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
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
    if (activeTab === "habits")   { loadHabits(); loadGoals(); }
    if (activeTab === "matrix")   loadMatrix();
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const [analytics, tasks] = await Promise.all([
    api("/api/analytics"),
    api("/api/tasks"),
  ]);

  const todayStr = today();
  const tasksDoneToday = tasks.filter(t => t.completed && t.completed_at === todayStr).length;
  const pending = analytics.task_stats.pending;

  // Hero greeting + meta
  $("#greeting").textContent = greeting();
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
  const metaBits = [dateStr];
  if (pending > 0) metaBits.push(`${pending} task${pending === 1 ? "" : "s"} on your plate`);
  else metaBits.push("Inbox zero — nice");
  $("#dashboard-meta").textContent = metaBits.join(" · ");

  // Today's focus: top-priority pending task
  renderFocusBanner(tasks);

  // Animated count-up on stat numbers
  countUp($("#stat-tasks-done"), tasksDoneToday);
  countUp($("#stat-habit-rate"), analytics.habit_completion_rate, { suffix: "%" });
  countUp($("#stat-pending"), pending);
}

function renderFocusBanner(tasks) {
  const pending = tasks.filter(t => !t.completed);
  // Priority preference: urgent+important > high > medium > low
  const score = t => {
    let s = 0;
    if (t.urgent && t.important) s += 100;
    if (t.priority === "high") s += 30;
    else if (t.priority === "medium") s += 10;
    if (t.deadline) s += 5;
    return s;
  };
  pending.sort((a, b) => score(b) - score(a));
  const top = pending[0];
  const taskEl = $("#focus-task");
  const metaEl = $("#focus-meta");
  if (!top) {
    taskEl.textContent = "All clear — add a task to plan your day";
    metaEl.innerHTML = "";
    return;
  }
  taskEl.textContent = top.title;
  const others = pending.length - 1;
  metaEl.innerHTML = others > 0
    ? `<strong>${others}</strong> more pending`
    : "Last one standing";
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
