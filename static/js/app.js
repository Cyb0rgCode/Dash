// ── Theme (iOS-style segmented sun/moon toggle) ────────────────────────────────

// Apply saved theme immediately so the page doesn't flash the wrong palette.
(function () {
  const saved = localStorage.getItem("theme") || "light";
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
})();

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector("#theme-toggle");

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("theme", theme);
    if (toggle) toggle.dataset.theme = theme;
    document.querySelectorAll(".theme-opt").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.mode === theme ? "true" : "false");
    });
  }

  applyTheme(localStorage.getItem("theme") || "light");

  document.querySelectorAll(".theme-opt").forEach(b => {
    b.addEventListener("click", () => applyTheme(b.dataset.mode));
  });
});

// ── Utilities ──────────────────────────────────────────────────────────────────

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  // Session expired or never started → boot the auth overlay and stop the caller.
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    showAuthOverlay();
    throw new Error("unauthorized");
  }
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

function updateNavIndicator(animate = true) {
  const nav = $("aside.sidebar nav");
  const indicator = $(".nav-indicator");
  const active = nav?.querySelector(".nav-btn.active");
  if (!nav || !indicator || !active) return;
  if (!animate) indicator.style.transition = "none";
  const navRect = nav.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  indicator.style.transform = `translateX(${btnRect.left - navRect.left}px) translateY(${btnRect.top - navRect.top}px)`;
  indicator.style.width  = `${btnRect.width}px`;
  indicator.style.height = `${btnRect.height}px`;
  indicator.style.opacity = "1";
  if (!animate) requestAnimationFrame(() => { indicator.style.transition = ""; });
}

$$(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    // 1. Synchronous DOM swap so the tab visually flips instantly
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    $$(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    $(`#tab-${activeTab}`).classList.add("active");
    updateNavIndicator();
    // 2. Reset scroll to top. Without this, switching from a tall tab
    //    (habits, tasks with many items) to a shorter one (dashboard)
    //    leaves the page scrolled mid-content on iOS Safari, which looks
    //    like the page is broken.
    window.scrollTo(0, 0);
    // 3. Defer the data fetch + render to the next frame so the tab swap
    //    paints first. Otherwise the synchronous innerHTML rebuild and
    //    Chart.js work block the visible transition and feel laggy.
    requestAnimationFrame(() => {
      if (activeTab === "dashboard") loadDashboard();
      else if (activeTab === "tasks")  { loadTasks(); updateFilterIndicator(false); }
      else if (activeTab === "habits") { Promise.all([loadHabits(), loadGoals()]); updateHabitsTabsIndicator(false); }
      else if (activeTab === "matrix") loadMatrix();
    });
  });
});

window.addEventListener("resize", () => updateNavIndicator(false));
window.addEventListener("load", () => updateNavIndicator(false));
requestAnimationFrame(() => updateNavIndicator(false));

// ── Dashboard ──────────────────────────────────────────────────────────────────

let dailyChart = null;
let priorityChart = null;
let forecastLoaded = false;

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
  if (!forecastLoaded) loadForecast();
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
      forecastLoaded = true;
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
    borderColor: "rgba(106,247,200,0.9)",
    backgroundColor: "rgba(106,247,200,0.08)",
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 4,
    pointBackgroundColor: "rgba(106,247,200,1)",
    pointBorderColor: "#0a0a0f",
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
  const labels = data.map(d => new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" }));
  const values = data.map(d => d.total);

  // PERF: update in place instead of destroy + recreate (Chart.js destroy
  // is ~100ms and triggers a full canvas tear-down).
  if (dailyChart) {
    dailyChart.data.labels = labels;
    dailyChart.data.datasets[0].data = values;
    dailyChart.update("none");
    return;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, "rgba(124,106,247,0.95)");
  gradient.addColorStop(1, "rgba(124,106,247,0.2)");
  const hoverGrad = ctx.createLinearGradient(0, 0, 0, 220);
  hoverGrad.addColorStop(0, "rgba(157,143,255,1)");
  hoverGrad.addColorStop(1, "rgba(106,247,200,0.4)");

  dailyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
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
          backgroundColor: "rgba(18,18,26,0.97)",
          borderColor: "rgba(124,106,247,0.4)",
          borderWidth: 1,
          titleColor: "#e8e8f0",
          bodyColor: "#e8e8f0",
          padding: 10,
          cornerRadius: 10,
          displayColors: false,
          callbacks: { label: c => fmtTime(c.parsed.y) || "0m" },
        },
      },
      scales: {
        x: { ticks: { color: "#6060a0", font: { size: 11, family: "JetBrains Mono" } }, grid: { display: false } },
        y: { ticks: { color: "#6060a0", font: { size: 11, family: "JetBrains Mono" } }, grid: { color: "rgba(30,30,46,0.8)" }, beginAtZero: true, border: { display: false } },
      },
    },
  });
}

function renderPriorityChart(data) {
  const ctx = $("#chart-priority").getContext("2d");
  if (!data.length) {
    if (priorityChart) { priorityChart.destroy(); priorityChart = null; }
    return;
  }
  const colorMap = { high: "#f76a8c", medium: "#f7c76a", low: "#6af7c8" };
  const colors = data.map(d => colorMap[d.category] || "#7c75ff");
  const labels = data.map(d => d.category.charAt(0).toUpperCase() + d.category.slice(1));
  const values = data.map(d => d.total);

  // PERF: update in place instead of destroy + recreate
  if (priorityChart) {
    priorityChart.data.labels = labels;
    priorityChart.data.datasets[0].data = values;
    priorityChart.data.datasets[0].backgroundColor = colors;
    priorityChart.update("none");
    return;
  }

  priorityChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: "#0a0a0f",
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
          labels: { color: "#e8e8f0", boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, font: { size: 11, family: "JetBrains Mono", weight: "600" } },
        },
        tooltip: {
          backgroundColor: "rgba(18,18,26,0.97)",
          borderColor: "rgba(124,106,247,0.4)",
          borderWidth: 1,
          padding: 10,
          cornerRadius: 10,
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

  // Live page subtitle — counts reflect ALL tasks, not just the filtered set
  const meta = $("#tasks-meta");
  if (meta) {
    const todayStr = today();
    const pending  = allTasks.filter(t => !t.completed).length;
    const doneToday = allTasks.filter(t => t.completed && t.completed_at === todayStr).length;
    if (!allTasks.length) meta.textContent = "Nothing here yet — add a task to get started";
    else if (pending === 0) meta.textContent = `All clear · ${allTasks.length} archived`;
    else meta.textContent = `${pending} pending${doneToday ? ` · ${doneToday} done today` : ""}`;
  }

  let tasks = allTasks;
  if (taskFilter === "pending") tasks = tasks.filter(t => !t.completed);
  if (taskFilter === "done") tasks = tasks.filter(t => t.completed);

  if (!tasks.length) {
    const hint = taskFilter === "done"    ? "Complete tasks will appear here."
              : taskFilter === "pending"  ? "All caught up — no pending tasks."
              :                              "Add a task above or import a JSON list to get started.";
    list.innerHTML = `<li class="empty-state">
      <div class="empty-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      </div>
      <div class="empty-state-title">${taskFilter === "done" ? "Nothing done yet" : taskFilter === "pending" ? "Inbox zero" : "No tasks yet"}</div>
      <div class="empty-state-hint">${hint}</div>
    </li>`;
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
          <button class="btn-icon" data-action="edit" title="Edit">✎</button>
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

  // The long-press handler fires a synthetic click after lifting the finger.
  // Swallow that one click so we don't immediately deselect the item we just
  // selected via long-press.
  if (suppressNextTaskClick) {
    suppressNextTaskClick = false;
    return;
  }

  // In selection mode: tapping the row body (anywhere not on a button/input)
  // toggles selection instead of doing the action under the cursor.
  if (!action && selectedIds.size > 0) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      li.classList.remove("selected");
    } else {
      selectedIds.add(id);
      li.classList.add("selected");
    }
    updateBatchBar();
    return;
  }

  if (action === "toggle") {
    const task = allTasks.find(t => t.id === id);
    const willComplete = !task.completed;
    const updated = await api(`/api/tasks/${id}`, "PUT", { completed: !task.completed });
    const idx = allTasks.findIndex(t => t.id === id);
    allTasks[idx] = { ...updated, time_logged: task.time_logged };
    renderTasks();
    if (willComplete) bounceCheck($(`#task-list li[data-id="${id}"]`));
  }
  if (action === "edit") {
    openEditSheet(id);
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

// Generic: position a .filter-indicator pill under the .active .filter-btn
// inside the given row. Used by both the tasks filter and the habits section
// switcher.
function positionFilterPill(row, animate = true) {
  if (!row) return;
  const indicator = row.querySelector(".filter-indicator");
  const active = row.querySelector(".filter-btn.active");
  if (!indicator || !active) return;
  if (!animate) indicator.style.transition = "none";
  const rowRect = row.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  indicator.style.transform = `translateX(${btnRect.left - rowRect.left - 4}px)`;
  indicator.style.width = `${btnRect.width}px`;
  indicator.style.opacity = "1";
  if (!animate) requestAnimationFrame(() => { indicator.style.transition = ""; });
}

function updateFilterIndicator(animate = true) {
  positionFilterPill($("#tab-tasks .filter-row"), animate);
}
function updateHabitsTabsIndicator(animate = true) {
  positionFilterPill($("#tab-habits .filter-row"), animate);
}

// Tasks filter buttons (All / Pending / Done)
$$("#tab-tasks .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $$("#tab-tasks .filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    taskFilter = btn.dataset.filter;
    updateFilterIndicator();
    renderTasks();
  });
});

// Habits/Goals section switcher (mobile-only visually; harmless on desktop)
$$("#tab-habits .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const section = btn.dataset.section;
    $$("#tab-habits .filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    $$("#tab-habits .habits-pane").forEach(p => {
      p.classList.toggle("active", p.dataset.pane === section);
    });
    updateHabitsTabsIndicator();
  });
});

window.addEventListener("resize", () => {
  updateFilterIndicator(false);
  updateHabitsTabsIndicator(false);
});
window.addEventListener("load", () => {
  updateFilterIndicator(false);
  updateHabitsTabsIndicator(false);
});
requestAnimationFrame(() => {
  updateFilterIndicator(false);
  updateHabitsTabsIndicator(false);
});

// Tactile spring-bounce when a check transitions to "done"
function bounceCheck(li) {
  const check = li?.querySelector(".habit-check");
  if (!check) return;
  check.animate(
    [
      { transform: "scale(0.7)" },
      { transform: "scale(1.28)" },
      { transform: "scale(1)" },
    ],
    { duration: 420, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
  );
}

// ── Batch actions ──────────────────────────────────────────────────────────────

// Cheap update: count + visibility only. Safe to call on every drag tick.
function updateBatchBarCount() {
  const bar = $("#batch-bar");
  const n = selectedIds.size;
  bar.hidden = n === 0;
  if (n > 0) $("#batch-count").textContent = `${n} selected`;
}

// Full update: aggregate states + button labels. Call once per discrete action.
function updateBatchBar() {
  updateBatchBarCount();
  const n = selectedIds.size;
  if (n === 0) return;

  const sel = allTasks.filter(t => selectedIds.has(t.id));
  const allDone    = sel.length > 0 && sel.every(t => t.completed);
  const allUrgent  = sel.every(t => t.urgent);
  const someUrgent = sel.some(t => t.urgent);
  const allImp     = sel.every(t => t.important);
  const someImp    = sel.some(t => t.important);

  $("#batch-done").textContent = allDone ? "Mark undone" : "Mark done";
  $("#batch-urgent").dataset.state    = allUrgent ? "all" : someUrgent ? "some" : "none";
  $("#batch-important").dataset.state = allImp    ? "all" : someImp    ? "some" : "none";
}

// Targeted helpers — patch the DOM in place instead of re-rendering the whole list.
function patchTaskInDom(task) {
  const li = $(`#task-list li[data-id="${task.id}"]`);
  if (!li) return;
  li.classList.toggle("done", !!task.completed);
  li.classList.toggle("li-both",      task.urgent && task.important);
  li.classList.toggle("li-important", !!task.important && !task.urgent);
  li.classList.toggle("li-urgent",    !!task.urgent && !task.important);
  const check = li.querySelector(".habit-check");
  if (check) {
    check.classList.toggle("done", !!task.completed);
    check.textContent = task.completed ? "✓" : "";
  }
  const badge = li.querySelector(".badge");
  if (badge) {
    badge.className = `badge badge-${task.priority}`;
    badge.textContent = task.priority;
  }
}


$("#batch-clear").addEventListener("click", () => {
  $$("#task-list li.selected").forEach(li => li.classList.remove("selected"));
  selectedIds.clear();
  updateBatchBar();
});

$("#batch-priority").addEventListener("change", async e => {
  const priority = e.target.value;
  if (!priority) return;
  e.target.value = "";
  const ids = [...selectedIds];
  await Promise.all(ids.map(id => api(`/api/tasks/${id}`, "PUT", { priority })));
  ids.forEach(id => {
    const idx = allTasks.findIndex(t => t.id === id);
    if (idx >= 0) {
      allTasks[idx] = { ...allTasks[idx], priority };
      patchTaskInDom(allTasks[idx]);
    }
  });
  updateBatchBar();
  toast(`Priority set to ${priority} for ${ids.length} task${ids.length === 1 ? "" : "s"}`);
});

$("#batch-urgent").addEventListener("click", async () => {
  const sel = allTasks.filter(t => selectedIds.has(t.id));
  const urgent = !sel.every(t => t.urgent);
  await Promise.all(sel.map(t => api(`/api/tasks/${t.id}`, "PUT", { urgent })));
  sel.forEach(t => {
    const idx = allTasks.findIndex(a => a.id === t.id);
    if (idx >= 0) {
      allTasks[idx] = { ...allTasks[idx], urgent };
      patchTaskInDom(allTasks[idx]);
    }
  });
  updateBatchBar();
  toast(`${sel.length} tasks marked ${urgent ? "urgent" : "not urgent"}`);
});

$("#batch-important").addEventListener("click", async () => {
  const sel = allTasks.filter(t => selectedIds.has(t.id));
  const important = !sel.every(t => t.important);
  await Promise.all(sel.map(t => api(`/api/tasks/${t.id}`, "PUT", { important })));
  sel.forEach(t => {
    const idx = allTasks.findIndex(a => a.id === t.id);
    if (idx >= 0) {
      allTasks[idx] = { ...allTasks[idx], important };
      patchTaskInDom(allTasks[idx]);
    }
  });
  updateBatchBar();
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
    if (idx >= 0) {
      allTasks[idx] = { ...allTasks[idx], completed: completed ? 1 : 0, completed_at: completed ? todayStr : null };
    }
  });
  selectedIds.clear();
  // If the new state no longer matches the current filter, full re-render
  // so the rows disappear (and orphan headers clear). Otherwise patch in place.
  const filterChanged = (taskFilter === "pending" && completed) || (taskFilter === "done" && !completed);
  if (filterChanged) {
    renderTasks();
  } else {
    sel.forEach(t => {
      const idx = allTasks.findIndex(a => a.id === t.id);
      if (idx >= 0) patchTaskInDom(allTasks[idx]);
    });
    $$("#task-list li.selected").forEach(li => li.classList.remove("selected"));
    updateBatchBar();
  }
  toast(completed
    ? `${sel.length} task${sel.length === 1 ? "" : "s"} done`
    : `${sel.length} task${sel.length === 1 ? "" : "s"} reopened`);
});

$("#batch-delete").addEventListener("click", async () => {
  const ids = [...selectedIds];
  await Promise.all(ids.map(id => api(`/api/tasks/${id}`, "DELETE")));
  allTasks = allTasks.filter(t => !selectedIds.has(t.id));
  selectedIds.clear();
  renderTasks(); // re-render to drop orphan category/chapter headers + show empty state
  toast(`Deleted ${ids.length} task${ids.length === 1 ? "" : "s"}`);
});

// ── Edit sheet (single-task editor) ────────────────────────────────────────────

let editingTaskId = null;
const editSheet = $("#edit-sheet");

function openEditSheet(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  $("#edit-title").value = task.title;
  $("#edit-category").value = task.category || "";
  $("#edit-chapter").value = task.chapter || "";
  $("#edit-type").value = task.task_type || "";
  $("#edit-priority").value = task.priority || "medium";
  $("#edit-deadline").value = task.deadline || "";
  $("#edit-estimate").value = task.estimated_minutes || "";
  $("#edit-urgent").setAttribute("aria-pressed", task.urgent ? "true" : "false");
  $("#edit-important").setAttribute("aria-pressed", task.important ? "true" : "false");
  editSheet.hidden = false;
  requestAnimationFrame(() => editSheet.classList.add("open"));
  setTimeout(() => $("#edit-title").focus(), 100);
}

function closeEditSheet() {
  editSheet.classList.remove("open");
  setTimeout(() => { editSheet.hidden = true; editingTaskId = null; }, 200);
}

editSheet.addEventListener("click", e => {
  if (e.target.dataset.action === "close-edit") closeEditSheet();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !editSheet.hidden) closeEditSheet();
});

$("#edit-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (editingTaskId == null) return;
  const id = editingTaskId;
  const title = $("#edit-title").value.trim();
  if (!title) return;
  const payload = {
    title,
    category:          $("#edit-category").value.trim(),
    chapter:           $("#edit-chapter").value.trim(),
    task_type:         $("#edit-type").value,
    priority:          $("#edit-priority").value,
    deadline:          $("#edit-deadline").value || null,
    estimated_minutes: parseInt($("#edit-estimate").value, 10) || 0,
    urgent:            $("#edit-urgent").getAttribute("aria-pressed") === "true",
    important:         $("#edit-important").getAttribute("aria-pressed") === "true",
  };
  const updated = await api(`/api/tasks/${id}`, "PUT", payload);
  const idx = allTasks.findIndex(t => t.id === id);
  if (idx >= 0) allTasks[idx] = { ...updated, time_logged: allTasks[idx].time_logged };
  closeEditSheet();
  renderTasks();
  toast("Task updated");
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
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(AI_PROMPT);
    } else {
      const ta = document.createElement("textarea");
      ta.value = AI_PROMPT;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast("Prompt copied — paste it into any AI chat");
  } catch {
    toast("Copy failed — check browser permissions", "error");
  }
});

$("#export-tasks-btn").addEventListener("click", async () => {
  try {
    // Fetch fresh so the export captures any changes made on other devices.
    const tasks = await api("/api/tasks");
    if (!tasks || !tasks.length) {
      toast("No tasks to export", "error");
      return;
    }
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasks-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${tasks.length} task${tasks.length === 1 ? "" : "s"}`);
  } catch {
    toast("Export failed", "error");
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
  updateBatchBar(); // settle final aggregate state once
});

function applyDragSelect(li, id) {
  if (dragSelectMode === "select") {
    if (selectedIds.has(id)) return;
    selectedIds.add(id);
    li.classList.add("selected");
  } else {
    if (!selectedIds.has(id)) return;
    selectedIds.delete(id);
    li.classList.remove("selected");
  }
  // During drag: only update count (cheap). Full update fires on mouseup.
  if (isDragSelecting) updateBatchBarCount();
  else updateBatchBar();
}

// ── Habits ─────────────────────────────────────────────────────────────────────

async function loadHabits() {
  const habits = await api("/api/habits");
  const list = $("#habit-list");
  if (!habits.length) {
    list.innerHTML = `<li class="empty-state">
      <div class="empty-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div class="empty-state-title">No habits yet</div>
      <div class="empty-state-hint">Track daily routines that build streaks over time.</div>
    </li>`;
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
    const res = await api(`/api/habits/${id}/toggle`, "POST");
    await loadHabits();
    if (res?.done_today) bounceCheck($(`#habit-list li[data-id="${id}"]`));
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
    list.innerHTML = `<li class="empty-state">
      <div class="empty-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2" fill="currentColor"/>
        </svg>
      </div>
      <div class="empty-state-title">No goals yet</div>
      <div class="empty-state-hint">Set a measurable target — like reading 12 books or running 100 km.</div>
    </li>`;
    return;
  }
  list.innerHTML = goals.map(g => {
    const pct = Math.min(100, Math.round((g.current_value / g.target_value) * 100));
    return `
      <li class="goal-item" data-id="${g.id}">
        <div class="goal-head">
          <span class="item-title">${escHtml(g.title)}</span>
          ${g.deadline ? `<span class="item-meta">${g.deadline}</span>` : ""}
          <button class="btn-icon" data-action="delete" title="Delete">✕</button>
        </div>
        <div class="goal-progress-wrap">
          <div class="goal-bar-bg"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
          <div class="goal-label-row">
            <span>${g.current_value} / ${g.target_value} ${escHtml(g.unit)} · ${pct}%</span>
            <span class="goal-edit-inline">
              <input class="goal-input-inline" type="number" data-action="update-val" value="${g.current_value}" min="0" max="${g.target_value}" step="any" />
              <button class="btn-icon goal-save-btn" data-action="save-val" title="Save">✓</button>
            </span>
          </div>
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

// ── Auth (username-only, session cookie) ───────────────────────────────────────

let authMode = "login";  // or "signup"

function showAuthOverlay() {
  const overlay = $("#auth-overlay");
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add("auth-visible");
  $("#sidebar-user").hidden = true;
  // Focus the input on next tick so animation runs first.
  setTimeout(() => { try { $("#auth-username").focus(); } catch (e) {} }, 60);
}

function hideAuthOverlay() {
  const overlay = $("#auth-overlay");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove("auth-visible");
}

function setSidebarUser(user) {
  const box = $("#sidebar-user");
  const name = $("#sidebar-user-name");
  if (!box || !name) return;
  if (user) {
    name.textContent = "@" + user.username;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  const tabs = $(".auth-tabs");
  if (tabs) tabs.dataset.mode = authMode;
  $$(".auth-tab").forEach(t => {
    const isActive = t.dataset.mode === authMode;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  const submitLabel = $(".auth-submit-label");
  if (submitLabel) submitLabel.textContent = authMode === "signup" ? "Create account" : "Continue";
  clearAuthError();
}

function clearAuthError() {
  const el = $("#auth-error");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function setAuthError(msg) {
  const el = $("#auth-error");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

async function authFetch(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function onLoggedIn(user) {
  setSidebarUser(user);
  hideAuthOverlay();
  // Boot the dashboard now that we have a session.
  try { await loadDashboard(); } catch (e) { /* api() already handled 401 */ }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  clearAuthError();
  const username = $("#auth-username").value.trim();
  if (!/^[A-Za-z0-9_]{2,32}$/.test(username)) {
    setAuthError("Username must be 2–32 characters: letters, numbers, underscore.");
    return;
  }
  const submitBtn = $("#auth-submit");
  submitBtn.disabled = true;
  const path = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  try {
    const { ok, status, data } = await authFetch(path, { username });
    if (!ok) {
      if (status === 404 && authMode === "login") {
        setAuthError("No account with that username. Try Sign up instead.");
      } else if (status === 409) {
        setAuthError("That username is taken. Try Sign in instead.");
      } else {
        setAuthError((data && data.error) || "Something went wrong. Try again.");
      }
      return;
    }
    await onLoggedIn(data.user);
  } catch (err) {
    setAuthError("Network error. Try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleLogout() {
  try { await authFetch("/api/auth/logout", {}); } catch (e) {}
  setSidebarUser(null);
  showAuthOverlay();
}

function wireAuthUI() {
  // Tab switching
  $$(".auth-tab").forEach(t => t.addEventListener("click", () => setAuthMode(t.dataset.mode)));
  // Submit
  const form = $("#auth-form");
  if (form) form.addEventListener("submit", handleAuthSubmit);
  // Logout
  const logout = $("#logout-btn");
  if (logout) logout.addEventListener("click", handleLogout);
  setAuthMode("login");
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function bootstrap() {
  wireAuthUI();
  try {
    const { data } = await authFetch("/api/auth/me");
    if (data && data.user) {
      await onLoggedIn(data.user);
    } else {
      showAuthOverlay();
    }
  } catch (e) {
    showAuthOverlay();
  }
}

bootstrap();
