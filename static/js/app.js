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

function fmtTime(mins) {
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

let dailyChart = null;
let priorityChart = null;

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

  renderDailyChart(analytics.daily_time);
  renderPriorityChart(analytics.time_by_category);
  loadForecast();
}

async function loadForecast() {
  const titleEl = $("#chart-daily").closest(".chart-card").querySelector("h2");
  const badge = document.createElement("span");
  badge.className = "forecast-badge loading";
  badge.textContent = "Loading forecast…";
  titleEl.appendChild(badge);

  try {
    const data = await api("/api/forecast");
    badge.remove();
    if (data.forecast && data.forecast.length) {
      overlayForecast(data.forecast);
    }
  } catch (_) {
    badge.textContent = "Forecast unavailable";
    badge.classList.add("error");
  }
}

function overlayForecast(forecastData) {
  if (!dailyChart) return;

  const newLabels = forecastData.map(f =>
    new Date(f.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
  );
  const newValues = forecastData.map(f => f.value);
  const histLen = dailyChart.data.labels.length;

  // Extend labels and pad existing bar dataset with nulls
  dailyChart.data.labels = [...dailyChart.data.labels, ...newLabels];
  dailyChart.data.datasets[0].data = [
    ...dailyChart.data.datasets[0].data,
    ...Array(7).fill(null),
  ];

  // Bridge point: connect last historical bar to forecast line
  const lastVal = dailyChart.data.datasets[0].data[histLen - 1] ?? 0;
  const lineData = [
    ...Array(histLen - 1).fill(null),
    lastVal,
    ...newValues,
  ];

  dailyChart.data.datasets.push({
    type: "line",
    label: "Forecast",
    data: lineData,
    borderColor: "rgba(56,189,248,0.9)",
    backgroundColor: "rgba(56,189,248,0.08)",
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 4,
    pointBackgroundColor: "rgba(56,189,248,1)",
    pointBorderColor: "#161925",
    pointBorderWidth: 2,
    tension: 0.35,
    fill: false,
  });

  dailyChart.update();

  // Update chart title
  const titleEl = $("#chart-daily").closest(".chart-card").querySelector("h2");
  const badge = document.createElement("span");
  badge.className = "forecast-badge";
  badge.textContent = "7d forecast";
  titleEl.appendChild(badge);
}

function renderDailyChart(data) {
  const canvas = $("#chart-daily");
  const ctx = canvas.getContext("2d");
  if (dailyChart) dailyChart.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, "rgba(124,117,255,0.95)");
  gradient.addColorStop(1, "rgba(124,117,255,0.2)");
  const hoverGrad = ctx.createLinearGradient(0, 0, 0, 220);
  hoverGrad.addColorStop(0, "rgba(157,151,255,1)");
  hoverGrad.addColorStop(1, "rgba(56,189,248,0.4)");

  dailyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(d => new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: gradient,
        hoverBackgroundColor: hoverGrad,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 48,
      }],
    },
    options: {
      responsive: true,
      animation: { duration: 600, easing: "easeOutCubic" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(31,35,51,0.95)",
          borderColor: "rgba(124,117,255,0.4)",
          borderWidth: 1,
          titleColor: "#e6e9f2",
          bodyColor: "#e6e9f2",
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: { label: c => fmtTime(c.parsed.y) || "0m" },
        },
      },
      scales: {
        x: { ticks: { color: "#828aa1", font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: "#828aa1", font: { size: 11 } }, grid: { color: "rgba(42,47,67,0.6)" }, beginAtZero: true, border: { display: false } },
      },
    },
  });
}

function renderPriorityChart(data) {
  const ctx = $("#chart-priority").getContext("2d");
  if (priorityChart) priorityChart.destroy();
  if (!data.length) return;
  const colorMap = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };
  const colors = data.map(d => colorMap[d.category] || "#7c75ff");
  priorityChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: data.map(d => d.category.charAt(0).toUpperCase() + d.category.slice(1)),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: colors,
        borderColor: "#161925",
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      cutout: "65%",
      animation: { animateRotate: true, duration: 600 },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#e6e9f2", boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, font: { size: 12, weight: "500" } },
        },
        tooltip: {
          backgroundColor: "rgba(31,35,51,0.95)",
          borderColor: "rgba(124,117,255,0.4)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: { label: c => ` ${c.label}: ${fmtTime(c.parsed)}` },
        },
      },
    },
  });
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
let selectedIds = new Set();

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
    updateBatchBar();
    return;
  }

  // Group by category
  const groups = {};
  tasks.forEach(t => {
    const key = t.category || "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  const sortedKeys = Object.keys(groups).sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)
  );

  let html = "";
  for (const cat of sortedKeys) {
    const catTasks = groups[cat];
    const allSel = catTasks.every(t => selectedIds.has(t.id));
    html += `<li class="category-header${allSel ? " all-selected" : ""}" data-category="${escHtml(cat)}">
      <span class="category-header-name">${escHtml(cat)}</span>
      <span class="category-header-count">${catTasks.length} task${catTasks.length === 1 ? "" : "s"}</span>
      <button type="button" class="category-select-btn" data-action="select-category">${allSel ? "Deselect all" : "Select all"}</button>
    </li>`;

    // Sub-group by chapter within the category
    const chGroups = {};
    catTasks.forEach(t => {
      const ch = t.chapter || "";
      if (!chGroups[ch]) chGroups[ch] = [];
      chGroups[ch].push(t);
    });
    const chKeys = Object.keys(chGroups).sort((a, b) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, undefined, { numeric: true })
    );

    for (const ch of chKeys) {
      if (ch) {
        const chTasks = chGroups[ch];
        const chAllSel = chTasks.every(t => selectedIds.has(t.id));
        html += `<li class="chapter-header${chAllSel ? " all-selected" : ""}" data-category="${escHtml(cat)}" data-chapter="${escHtml(ch)}">
          <span class="chapter-header-name">${escHtml(ch)}</span>
          <button type="button" class="chapter-select-btn" data-action="select-chapter">${chAllSel ? "Deselect" : "Select"}</button>
        </li>`;
      }
      chGroups[ch].forEach(t => {
        const urgCls = t.urgent && t.important ? " li-both"
          : t.important ? " li-important"
          : t.urgent    ? " li-urgent" : "";
        html += `<li class="${t.completed ? "done" : ""}${selectedIds.has(t.id) ? " selected" : ""}${urgCls}" data-id="${t.id}">
          <button class="habit-check ${t.completed ? "done" : ""}" data-action="toggle" title="Toggle complete">${t.completed ? "✓" : ""}</button>
          <span class="item-title">${escHtml(t.title)}</span>
          ${t.task_type ? `<span class="tag-type">${escHtml(t.task_type)}</span>` : ""}
          ${t.urgent ? '<span class="tag-urgent">! urgent</span>' : ""}
          ${t.important ? '<span class="tag-important">★ key</span>' : ""}
          <span class="badge badge-${t.priority}">${t.priority}</span>
          ${t.deadline ? `<span class="item-meta">${t.deadline}</span>` : ""}
          ${t.estimated_minutes ? `<span class="estimate-badge">~${fmtTime(t.estimated_minutes)}</span>` : ""}
          ${t.time_logged ? `<span class="time-badge">⏱ ${fmtTime(t.time_logged)}</span>` : ""}
          <input class="log-mins-inline" type="number" placeholder="log min" min="1" max="999" title="Type minutes and press Enter" />
          <button class="btn-icon" data-action="delete" title="Delete">✕</button>
        </li>`;
      });
    }
  }
  list.innerHTML = html;
  updateBatchBar();
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
  const action = e.target.dataset.action || e.target.closest("[data-action]")?.dataset.action;

  if (action === "select-category") {
    const header = e.target.closest(".category-header");
    const cat = header?.dataset.category;
    if (!cat) return;
    let catTasks = allTasks.filter(t => (t.category || "Other") === cat);
    if (taskFilter === "pending") catTasks = catTasks.filter(t => !t.completed);
    if (taskFilter === "done")    catTasks = catTasks.filter(t => t.completed);
    const allSel = catTasks.length > 0 && catTasks.every(t => selectedIds.has(t.id));
    catTasks.forEach(t => allSel ? selectedIds.delete(t.id) : selectedIds.add(t.id));
    renderTasks();
    return;
  }

  if (action === "select-chapter") {
    const header = e.target.closest(".chapter-header");
    const cat = header?.dataset.category;
    const ch  = header?.dataset.chapter;
    if (!cat || ch === undefined) return;
    let chTasks = allTasks.filter(t => (t.category || "Other") === cat && (t.chapter || "") === ch);
    if (taskFilter === "pending") chTasks = chTasks.filter(t => !t.completed);
    if (taskFilter === "done")    chTasks = chTasks.filter(t => t.completed);
    const allSel = chTasks.length > 0 && chTasks.every(t => selectedIds.has(t.id));
    chTasks.forEach(t => allSel ? selectedIds.delete(t.id) : selectedIds.add(t.id));
    renderTasks();
    return;
  }

  const li = e.target.closest("li[data-id]");
  if (!li) return;
  const id = Number(li.dataset.id);

  if (action === "toggle") {
    const task = allTasks.find(t => t.id === id);
    const updated = await api(`/api/tasks/${id}`, "PUT", { completed: !task.completed });
    const idx = allTasks.findIndex(t => t.id === id);
    allTasks[idx] = { ...updated, time_logged: task.time_logged };
    renderTasks();
  }
  if (action === "delete") {
    await api(`/api/tasks/${id}`, "DELETE");
    allTasks = allTasks.filter(t => t.id !== id);
    selectedIds.delete(id);
    renderTasks();
    toast("Task deleted");
  }
});

$("#task-list").addEventListener("keydown", async e => {
  if (e.key !== "Enter" || !e.target.classList.contains("log-mins-inline")) return;
  const li = e.target.closest("li");
  const id = Number(li.dataset.id);
  const mins = parseInt(e.target.value, 10);
  if (!mins || mins < 1) return;
  e.target.value = "";
  const updated = await api(`/api/tasks/${id}/log`, "POST", { minutes: mins });
  const idx = allTasks.findIndex(t => t.id === id);
  allTasks[idx] = updated;
  renderTasks();
  toast(`Logged ${fmtTime(mins)}`);
});

$$(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    taskFilter = btn.dataset.filter;
    renderTasks();
  });
});

// ── Batch actions ──────────────────────────────────────────────────────────────

function updateBatchBar() {
  const bar = $("#batch-bar");
  const n = selectedIds.size;
  bar.hidden = n === 0;
  if (n === 0) return;

  const sel = allTasks.filter(t => selectedIds.has(t.id));
  $("#batch-count").textContent = `${n} selected`;

  // Done button label reflects current state
  const allDone = sel.length > 0 && sel.every(t => t.completed);
  $("#batch-done").textContent = allDone ? "Mark undone" : "Mark done";

  if (n === 1) {
    const task = sel[0];
    if (task) {
      $("#batch-edit-title").value = task.title;
      $("#batch-edit-category").value = task.category || "";
      $("#batch-edit-chapter").value = task.chapter || "";
      $("#batch-edit-type").value = task.task_type || "";
      $("#batch-edit-priority").value = task.priority;
      $("#batch-edit-deadline").value = task.deadline || "";
      $("#batch-edit-estimate").value = task.estimated_minutes || "";
      $("#batch-edit-urgent").setAttribute("aria-pressed", task.urgent ? "true" : "false");
      $("#batch-edit-important").setAttribute("aria-pressed", task.important ? "true" : "false");
    }
    $("#batch-edit").hidden = false;
    $("#batch-multi").hidden = true;
  } else {
    // Show aggregate urgent/important state on multi buttons
    const allUrgent   = sel.every(t => t.urgent);
    const someUrgent  = sel.some(t => t.urgent);
    const allImp      = sel.every(t => t.important);
    const someImp     = sel.some(t => t.important);
    $("#batch-urgent").dataset.state   = allUrgent  ? "all" : someUrgent ? "some" : "none";
    $("#batch-important").dataset.state = allImp    ? "all" : someImp    ? "some" : "none";
    $("#batch-edit").hidden = true;
    $("#batch-multi").hidden = false;
  }
}


$("#batch-save").addEventListener("click", async () => {
  const id = [...selectedIds][0];
  if (!id) return;
  const title = $("#batch-edit-title").value.trim();
  if (!title) return;
  const category          = $("#batch-edit-category").value.trim();
  const chapter           = $("#batch-edit-chapter").value.trim();
  const task_type         = $("#batch-edit-type").value;
  const priority          = $("#batch-edit-priority").value;
  const deadline          = $("#batch-edit-deadline").value || null;
  const estimated_minutes = parseInt($("#batch-edit-estimate").value, 10) || 0;
  const urgent            = $("#batch-edit-urgent").getAttribute("aria-pressed") === "true";
  const important         = $("#batch-edit-important").getAttribute("aria-pressed") === "true";
  const updated = await api(`/api/tasks/${id}`, "PUT", { title, category, chapter, task_type, priority, deadline, estimated_minutes, urgent, important });
  const idx = allTasks.findIndex(t => t.id === id);
  allTasks[idx] = { ...updated, time_logged: allTasks[idx].time_logged };
  selectedIds.clear();
  renderTasks();
  toast("Task updated");
});

$("#batch-clear").addEventListener("click", () => {
  selectedIds.clear();
  renderTasks();
});

$("#batch-priority").addEventListener("change", async e => {
  const priority = e.target.value;
  if (!priority) return;
  e.target.value = "";
  const ids = [...selectedIds];
  await Promise.all(ids.map(id => api(`/api/tasks/${id}`, "PUT", { priority })));
  ids.forEach(id => {
    const idx = allTasks.findIndex(t => t.id === id);
    if (idx >= 0) allTasks[idx] = { ...allTasks[idx], priority };
  });
  renderTasks();
  toast(`Priority set to ${priority} for ${ids.length} task${ids.length === 1 ? "" : "s"}`);
});

$("#batch-urgent").addEventListener("click", async () => {
  const sel = allTasks.filter(t => selectedIds.has(t.id));
  const urgent = !sel.every(t => t.urgent);
  await Promise.all(sel.map(t => api(`/api/tasks/${t.id}`, "PUT", { urgent })));
  sel.forEach(t => {
    const idx = allTasks.findIndex(a => a.id === t.id);
    if (idx >= 0) allTasks[idx] = { ...allTasks[idx], urgent };
  });
  renderTasks();
  toast(`${sel.length} tasks marked ${urgent ? "urgent" : "not urgent"}`);
});

$("#batch-important").addEventListener("click", async () => {
  const sel = allTasks.filter(t => selectedIds.has(t.id));
  const important = !sel.every(t => t.important);
  await Promise.all(sel.map(t => api(`/api/tasks/${t.id}`, "PUT", { important })));
  sel.forEach(t => {
    const idx = allTasks.findIndex(a => a.id === t.id);
    if (idx >= 0) allTasks[idx] = { ...allTasks[idx], important };
  });
  renderTasks();
  toast(`${sel.length} tasks marked ${important ? "important" : "not important"}`);
});

$("#batch-done").addEventListener("click", async () => {
  const sel = allTasks.filter(t => selectedIds.has(t.id));
  if (!sel.length) return;
  const completed = !sel.every(t => t.completed);
  await Promise.all(sel.map(t => api(`/api/tasks/${t.id}`, "PUT", { completed })));
  const todayStr = today();
  sel.forEach(t => {
    const idx = allTasks.findIndex(a => a.id === t.id);
    if (idx >= 0) allTasks[idx] = { ...allTasks[idx], completed: completed ? 1 : 0, completed_at: completed ? todayStr : null };
  });
  selectedIds.clear();
  renderTasks();
  toast(completed
    ? `${sel.length} task${sel.length === 1 ? "" : "s"} done`
    : `${sel.length} task${sel.length === 1 ? "" : "s"} reopened`);
});

$("#batch-delete").addEventListener("click", async () => {
  const ids = [...selectedIds];
  await Promise.all(ids.map(id => api(`/api/tasks/${id}`, "DELETE")));
  allTasks = allTasks.filter(t => !selectedIds.has(t.id));
  selectedIds.clear();
  renderTasks();
  toast(`Deleted ${ids.length} task${ids.length === 1 ? "" : "s"}`);
});

// ── JSON Import ────────────────────────────────────────────────────────────────

const AI_PROMPT = `You are a productivity assistant. I will paste files, documents, syllabi, problem sets, schedules, or any content below. Extract EVERY actionable item as a task.

Return ONLY a valid JSON array — no markdown, no explanation. Each object must have:

- "title": string — specific task using exact names/numbers from the content (e.g. "Exercises 1–8", not "Do homework")
- "category": string — the course or subject name exactly as it appears (e.g. "Math 201", "Physics II", "CS50"). For non-class items use "Work", "Personal", "Health", etc.
- "chapter": string | null — the chapter, section, or topic within the course (e.g. "Chapter 3", "Week 5", "Unit 2: Integration"). null if not applicable
- "task_type": one of — "exercise" | "quiz" | "assignment" | "reading" | "lab" | "project" | "lecture" | "other"
- "priority": "high" | "medium" | "low" — based on deadline proximity and grade weight
- "urgent": false — default false; only set true if due within 48 hours or explicitly flagged urgent in the content
- "important": false — default false; only set true if it directly affects a grade, major milestone, or stated goal
- "deadline": "YYYY-MM-DD" | null — extract exact dates; null if none stated
- "estimated_minutes": number — realistic completion time (reading ≈ 2 min/page, per problem ≈ 20–40 min, coding task ≈ 45–120 min, short drill ≈ 15–30 min)

Rules:
- urgent and important start at false — raise them only when the content clearly justifies it
- Break compound items into individual tasks (one problem set = one task per section if separable)
- estimated_minutes must be a positive integer

[PASTE YOUR FILES, SYLLABUS, PROBLEM SET, SCHEDULE, OR ANY CONTENT BELOW]
`;

$("#task-import-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    toast("Invalid JSON file", "error");
    return;
  }
  if (!Array.isArray(data) || !data.length) {
    toast("JSON must be an array of tasks", "error");
    return;
  }
  const valid = data.filter(t => t && typeof t.title === "string" && t.title.trim());
  if (!valid.length) {
    toast("No valid tasks found (each needs a title)", "error");
    return;
  }
  let added = 0;
  for (const t of valid) {
    try {
      const task = await api("/api/tasks", "POST", {
        title:              t.title.trim(),
        category:           t.category ? String(t.category).trim() : "",
        chapter:            t.chapter  ? String(t.chapter).trim()  : "",
        task_type:          t.task_type ? String(t.task_type).trim() : "",
        priority:           ["high", "medium", "low"].includes(t.priority) ? t.priority : "medium",
        deadline:           t.deadline || null,
        urgent:             Boolean(t.urgent),
        important:          Boolean(t.important),
        estimated_minutes:  parseInt(t.estimated_minutes, 10) || 0,
      });
      allTasks.unshift(task);
      added++;
    } catch (_) {}
  }
  renderTasks();
  toast(`Imported ${added} task${added === 1 ? "" : "s"}`, added ? "success" : "error");
});

$("#copy-prompt-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(AI_PROMPT);
    toast("Prompt copied — paste it into any AI chat");
  } catch {
    toast("Copy failed — check browser permissions", "error");
  }
});

// ── Drag-to-select (left-click hold + drag) ────────────────────────────────────

let isDragSelecting = false;
let dragSelectMode = null; // "select" | "deselect"
let dragAnchorEl   = null;
let dragStartX = 0, dragStartY = 0;
const DRAG_THRESHOLD = 6;

document.addEventListener("mousedown", e => {
  if (e.button !== 0) return;
  const li = e.target.closest("#task-list li[data-id]");
  if (!li || e.target.closest("button, input, select")) return;
  dragAnchorEl = li;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
});

document.addEventListener("mousemove", e => {
  if (!dragAnchorEl) return;
  if (!isDragSelecting) {
    if (Math.abs(e.clientX - dragStartX) < DRAG_THRESHOLD &&
        Math.abs(e.clientY - dragStartY) < DRAG_THRESHOLD) return;
    isDragSelecting = true;
    document.body.classList.add("drag-selecting");
    const id = Number(dragAnchorEl.dataset.id);
    dragSelectMode = selectedIds.has(id) ? "deselect" : "select";
    applyDragSelect(dragAnchorEl, id);
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const li = el?.closest("#task-list li[data-id]");
  if (li) applyDragSelect(li, Number(li.dataset.id));
});

document.addEventListener("mouseup", e => {
  if (e.button !== 0) return;
  dragAnchorEl = null;
  if (!isDragSelecting) return;
  isDragSelecting = false;
  dragSelectMode = null;
  document.body.classList.remove("drag-selecting");
});

function applyDragSelect(li, id) {
  if (dragSelectMode === "select") {
    selectedIds.add(id);
    li.classList.add("selected");
  } else {
    selectedIds.delete(id);
    li.classList.remove("selected");
  }
  updateBatchBar();
}

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
