// ── Theme (Single button with rotating sun/moon icons) ──────────────────────────

// Apply saved theme immediately so the page doesn't flash the wrong palette.
(function () {
  const saved = localStorage.getItem("theme") || "light";
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
})();

// Restore sidebar collapsed state before first paint
(function () {
  if (localStorage.getItem("sidebar-collapsed") === "1")
    document.body.classList.add("sidebar-collapsed");
})();

document.addEventListener("DOMContentLoaded", () => {
  // Sidebar collapse toggle (clicking the logo title)
  const collapseBtn = document.querySelector("#sidebar-collapse-btn");
  function toggleSidebar() {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    if (collapseBtn) {
      collapseBtn.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      collapseBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    }
    setTimeout(() => updateNavIndicator(false), 260);
  }
  if (collapseBtn) {
    collapseBtn.addEventListener("click", toggleSidebar);
    collapseBtn.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSidebar(); }
    });
  }

  // Auto-expand sidebar when resizing to mobile (≤720px);
  // restore saved state when going back to desktop.
  const MOBILE_BP = 720;
  function syncSidebarToViewport() {
    if (window.innerWidth <= MOBILE_BP) {
      document.body.classList.remove("sidebar-collapsed");
    } else {
      if (localStorage.getItem("sidebar-collapsed") === "1")
        document.body.classList.add("sidebar-collapsed");
      else
        document.body.classList.remove("sidebar-collapsed");
    }
    setTimeout(() => updateNavIndicator(false), 260);
  }
  window.addEventListener("resize", syncSidebarToViewport);

  const toggle = document.querySelector("#theme-toggle");

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("theme", theme);
    // Keep Safari's URL bar color in sync with the page background
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#0a0a0f" : "#f6f6fa";
  }

  const currentTheme = localStorage.getItem("theme") || "light";
  applyTheme(currentTheme);

  if (toggle) {
    toggle.addEventListener("click", () => {
      const isCurrentlyDark = document.documentElement.getAttribute("data-theme") === "dark";
      applyTheme(isCurrentlyDark ? "light" : "dark");
      // Charts hold canvas-baked colors (gradients, tooltip skins, doughnut
      // borders). Tear them down so they rebuild from the new CSS vars next
      // time the dashboard loads.
      try { if (typeof dailyChart    !== "undefined" && dailyChart)    dailyChart.destroy(); } catch (e) {}
      try { if (typeof priorityChart !== "undefined" && priorityChart) priorityChart.destroy(); } catch (e) {}
      if (typeof dailyChart    !== "undefined") dailyChart = null;
      if (typeof priorityChart !== "undefined") priorityChart = null;
      if (typeof forecastLoaded !== "undefined") forecastLoaded = false;
      if (typeof activeTab !== "undefined" && activeTab === "dashboard" && typeof loadDashboard === "function") loadDashboard();
    });
  }
});


// ── Scroll-reveal: toggle a body class once the user scrolls a bit ──────────
// Used on mobile to hide the floating @username pill at the page top and
// fade it in once the user starts scrolling, so it doesn't crowd the title.
(function () {
  const THRESHOLD = 24; // px
  let raf = null;
  function rectsOverlap(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }
  function syncScrollFlag() {
    raf = null;
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.toggle("is-scrolled", y > THRESHOLD);
    // Hide the floating @user pill whenever a sticky category header is
    // sitting under it — the "Select all" control needs to stay tappable.
    const pill = document.querySelector(".sidebar-user");
    const tasksActive = document.querySelector("#tab-tasks.tab.active");
    let covered = false;
    if (pill && tasksActive) {
      const pillRect = pill.getBoundingClientRect();
      const headers = tasksActive.querySelectorAll(".category-header");
      for (const h of headers) {
        if (rectsOverlap(h.getBoundingClientRect(), pillRect)) { covered = true; break; }
      }
    }
    document.body.classList.toggle("pill-covered", covered);
  }
  function onScroll() {
    if (raf != null) return;
    raf = requestAnimationFrame(syncScrollFlag);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  // Initialize on load + after any tab swap that resets scroll to top.
  syncScrollFlag();
  document.addEventListener("DOMContentLoaded", syncScrollFlag);
})();

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
  countUp($("#stat-total"), tasks.length);

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

  const tcF = themeChartColors();
  dailyChart.data.datasets.push({
    type: "line",
    label: "Forecast",
    data: lineData,
    borderColor:           `rgba(${tcF.greenRGB}, 0.9)`,
    backgroundColor:       `rgba(${tcF.greenRGB}, 0.08)`,
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 4,
    pointBackgroundColor:  `rgba(${tcF.greenRGB}, 1)`,
    pointBorderColor:      tcF.canvasGap,
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

// ── Theme-aware chart colors ─────────────────────────────────────────────────
// Resolves CSS custom properties at runtime so chart canvases match the
// active theme. Reads on every render so a theme toggle picks up new values.
function themeChartColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const accentRGB = v("--accent-rgb", "124, 106, 247");
  const greenRGB  = v("--green-rgb",  "106, 247, 200");
  return {
    isDark,
    bg:       v("--bg",       "#0a0a0f"),
    text:     v("--text",     "#e8e8f0"),
    muted:    v("--muted",    "#6060a0"),
    accent:   v("--accent",   "#7c6af7"),
    accentRGB,
    green:    v("--green",    "#6af7c8"),
    greenRGB,
    red:      v("--red",      "#f76a8c"),
    yellow:   v("--yellow",   "#f7c76a"),
    cyan:     v("--cyan",     "#6af7c8"),
    // Tooltip skin: keep dark in both modes for legibility on the violet bars.
    tooltipBg:     isDark ? "rgba(18,18,26,0.97)" : "rgba(20,20,40,0.94)",
    tooltipBorder: `rgba(${accentRGB}, 0.4)`,
    tooltipText:   "#f4f4fa",
    gridLine:      isDark ? "rgba(30,30,46,0.8)" : "rgba(20,20,40,0.08)",
    // Doughnut gap-ring + line-chart point border. Was hardcoded to #0a0a0f,
    // which painted black gaps on a white page in light mode.
    canvasGap:     v("--bg", isDark ? "#0a0a0f" : "#ffffff"),
  };
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

  const tc = themeChartColors();
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, `rgba(${tc.accentRGB}, 0.95)`);
  gradient.addColorStop(1, `rgba(${tc.accentRGB}, 0.2)`);
  const hoverGrad = ctx.createLinearGradient(0, 0, 0, 220);
  hoverGrad.addColorStop(0, `rgba(${tc.accentRGB}, 1)`);
  hoverGrad.addColorStop(1, `rgba(${tc.greenRGB}, 0.4)`);

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
          backgroundColor: tc.tooltipBg,
          borderColor: tc.tooltipBorder,
          borderWidth: 1,
          titleColor: tc.tooltipText,
          bodyColor: tc.tooltipText,
          padding: 10,
          cornerRadius: 10,
          displayColors: false,
          callbacks: { label: c => fmtTime(c.parsed.y) || "0m" },
        },
      },
      scales: {
        x: { ticks: { color: tc.muted, font: { size: 11, family: "JetBrains Mono" } }, grid: { display: false } },
        y: {
          ticks: {
            color: tc.muted,
            font: { size: 11, family: "JetBrains Mono" },
            callback: val => val === 0 ? "0m" : fmtTime(val),
          },
          grid: { color: tc.gridLine },
          beginAtZero: true,
          suggestedMax: 60,
          border: { display: false },
        },
      },
    },
  });
}

function renderPriorityChart(data) {
  const canvas = $("#chart-priority");
  const emptyId = "chart-priority-empty";
  // Remove any previous empty-state so it doesn't pile up on re-renders.
  canvas.parentElement.querySelector(`#${emptyId}`)?.remove();

  if (!data.length) {
    if (priorityChart) { priorityChart.destroy(); priorityChart = null; }
    canvas.style.display = "none";
    const msg = document.createElement("p");
    msg.id = emptyId;
    msg.className = "chart-empty-state";
    msg.textContent = "No time logged yet — use the timer on a task to log time.";
    canvas.parentElement.appendChild(msg);
    return;
  }

  canvas.style.display = "";
  const ctx = canvas.getContext("2d");
  const tc = themeChartColors();
  const colorMap = { high: tc.red, medium: tc.yellow, low: tc.green, habit: tc.accent };
  const labelMap = { high: "High", medium: "Medium", low: "Low", habit: "Habits" };
  const colors = data.map(d => colorMap[d.category] || tc.accent);
  const labels = data.map(d => labelMap[d.category] || (d.category.charAt(0).toUpperCase() + d.category.slice(1)));
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
        borderColor: tc.canvasGap,
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
          labels: { color: tc.text, boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, font: { size: 11, family: "JetBrains Mono", weight: "600" } },
        },
        tooltip: {
          backgroundColor: tc.tooltipBg,
          borderColor: tc.tooltipBorder,
          borderWidth: 1,
          titleColor: tc.tooltipText,
          bodyColor: tc.tooltipText,
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
let taskSearch = "";
let taskSort = "default";
let collapsedCats = new Set();
let selectedIds = new Set();
let suppressNextTaskClick = false;

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function refreshTaskDatalists() {
  const catSet = new Set();
  const chSet = new Set();
  allTasks.forEach(t => {
    if (t.category) catSet.add(t.category);
    if (t.chapter)  chSet.add(t.chapter);
  });
  const catList = $("#task-categories-list");
  const chList  = $("#task-chapters-list");
  if (catList) catList.innerHTML = [...catSet].sort().map(c => `<option value="${escHtml(c)}">`).join("");
  if (chList)  chList.innerHTML  = [...chSet].sort().map(c => `<option value="${escHtml(c)}">`).join("");
}

async function loadTasks() {
  allTasks = await api("/api/tasks");
  refreshTaskDatalists();
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

  // Search by title (case-insensitive substring match)
  const q = taskSearch.trim().toLowerCase();
  if (q) tasks = tasks.filter(t => t.title.toLowerCase().includes(q));

  if (!tasks.length) {
    const hint = q                          ? "No tasks match your search."
              : taskFilter === "done"       ? "Complete tasks will appear here."
              : taskFilter === "pending"    ? "All caught up — no pending tasks."
              :                                "Add a task above or import a JSON list to get started.";
    list.innerHTML = `<li class="empty-state">
      <div class="empty-state-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      </div>
      <div class="empty-state-title">${q ? "No matches" : taskFilter === "done" ? "Nothing done yet" : taskFilter === "pending" ? "Inbox zero" : "No tasks yet"}</div>
      <div class="empty-state-hint">${hint}</div>
    </li>`;
    updateBatchBar();
    return;
  }

  const todayStr2 = today();
  const sortTasks = arr => {
    const a = arr.slice();
    if (taskSort === "deadline") {
      a.sort((x, y) => (x.deadline || "9999-12-31").localeCompare(y.deadline || "9999-12-31"));
    } else if (taskSort === "priority") {
      a.sort((x, y) => (PRIORITY_RANK[x.priority] ?? 9) - (PRIORITY_RANK[y.priority] ?? 9));
    } else if (taskSort === "recent") {
      a.sort((x, y) => (y.id ?? 0) - (x.id ?? 0));
    }
    return a;
  };

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
    const catDone = catTasks.filter(t => t.completed).length;
    const catTotal = catTasks.length;
    const catPct = catTotal ? Math.round((catDone / catTotal) * 100) : 0;
    const collapsed = collapsedCats.has(cat);
    html += `<li class="category-header${allSel ? " all-selected" : ""}${collapsed ? " collapsed" : ""}" data-category="${escHtml(cat)}">
      <button type="button" class="category-collapse-btn" data-action="toggle-category" aria-label="${collapsed ? "Expand" : "Collapse"}">${collapsed ? "▸" : "▾"}</button>
      <span class="category-header-name">${escHtml(cat)}</span>
      <span class="category-header-count">${catDone}/${catTotal}</span>
      <span class="category-progress" title="${catPct}% complete"><span class="category-progress-fill" style="width:${catPct}%"></span></span>
      <button type="button" class="category-select-btn" data-action="select-category">${allSel ? "Deselect all" : "Select all"}</button>
    </li>`;

    if (collapsed) continue;

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
      sortTasks(chGroups[ch]).forEach(t => {
        const urgCls = t.urgent && t.important ? " li-both"
          : t.important ? " li-important"
          : t.urgent    ? " li-urgent" : "";
        const isOverdue = t.deadline && !t.completed && t.deadline < todayStr2;
        html += `<li class="${t.completed ? "done" : ""}${selectedIds.has(t.id) ? " selected" : ""}${urgCls}${isOverdue ? " overdue" : ""}" data-id="${t.id}">
          <button class="habit-check ${t.completed ? "done" : ""}" data-action="toggle" title="Toggle complete" aria-label="${t.completed ? "Mark incomplete" : "Mark complete"}"></button>
          <span class="item-title">${escHtml(t.title)}</span>
          ${t.task_type ? `<span class="tag-type">${escHtml(t.task_type)}</span>` : ""}
          ${t.urgent ? '<span class="tag-urgent">! urgent</span>' : ""}
          ${t.important ? '<span class="tag-important">★ key</span>' : ""}
          <span class="badge badge-${t.priority}">${t.priority}</span>
          ${t.deadline ? `<span class="item-meta${isOverdue ? " overdue-meta" : ""}">${isOverdue ? "⚠ " : ""}${t.deadline}</span>` : ""}
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
    category:  $("#task-category").value.trim(),
    chapter:   $("#task-chapter").value.trim(),
  });
  allTasks.unshift(task);
  refreshTaskDatalists();
  renderTasks();
  _pushUndo(`Add "${task.title}"`,
    async () => { await api(`/api/tasks/${task.id}`, "DELETE"); await loadTasks(); },
    async () => {
      const re = await api("/api/tasks", "POST", {
        title: task.title, priority: task.priority, deadline: task.deadline,
        urgent: task.urgent, important: task.important, category: task.category,
        estimated_minutes: task.estimated_minutes, task_type: task.task_type, chapter: task.chapter,
      });
      task = re; // update captured id so future undo uses new id
      await loadTasks();
    }
  );
  toast("Task added");
  $("#task-title").value = "";
  $("#task-deadline").value = "";
  $("#task-category").value = "";
  $("#task-chapter").value = "";
  resetToggle("task-urgent");
  resetToggle("task-important");
});

// Search + sort listeners
const taskSearchEl = $("#task-search");
if (taskSearchEl) {
  taskSearchEl.addEventListener("input", () => {
    taskSearch = taskSearchEl.value;
    renderTasks();
  });
}
const taskSortEl = $("#task-sort");
if (taskSortEl) {
  taskSortEl.addEventListener("change", () => {
    taskSort = taskSortEl.value;
    renderTasks();
  });
}

// ── Double-tap any ⏱ logged-time badge to reset it ────────────────────────────
// Shared by both the Tasks pane (.time-badge) and the Matrix (.matrix-time-logged).
const _logTapState = { id: null, t: 0 };
async function _handleLogBadgeTap(e, chipSelector) {
  const chip = e.target.closest(chipSelector);
  if (!chip) return false;
  e.stopPropagation();
  const li = chip.closest("li[data-id]");
  if (!li) return true;
  const id  = Number(li.dataset.id);
  const now = Date.now();
  if (_logTapState.id === id && now - _logTapState.t < 400) {
    _logTapState.id = null;
    chip.style.opacity = "0.3";
    await api(`/api/tasks/${id}/log`, "DELETE", null);
    toast("Time log cleared");
    return "reset";
  }
  _logTapState.id = id;
  _logTapState.t  = now;
  return true;
}

$("#task-list").addEventListener("click", async e => {
  const result = await _handleLogBadgeTap(e, ".time-badge");
  if (result === "reset") { await loadTasks(); return; }
  if (result !== false) return; // chip tapped once — arm state, skip normal handling

  const action = e.target.dataset.action || e.target.closest("[data-action]")?.dataset.action;

  if (action === "toggle-category") {
    const header = e.target.closest(".category-header");
    const cat = header?.dataset.category;
    if (!cat) return;
    if (collapsedCats.has(cat)) collapsedCats.delete(cat);
    else collapsedCats.add(cat);
    renderTasks();
    return;
  }

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
    const updated = await api(`/api/tasks/${id}`, "PUT", { completed: willComplete });
    const idx = allTasks.findIndex(t => t.id === id);
    allTasks[idx] = { ...updated, time_logged: task.time_logged };
    _pushUndo(willComplete ? `Complete "${task.title}"` : `Reopen "${task.title}"`,
      async () => { await api(`/api/tasks/${id}`, "PUT", { completed: !willComplete }); await loadTasks(); },
      async () => { await api(`/api/tasks/${id}`, "PUT", { completed:  willComplete }); await loadTasks(); }
    );
    renderTasks();
    if (willComplete) bounceCheck($(`#task-list li[data-id="${id}"]`));
  }
  if (action === "edit") {
    openEditSheet(id);
  }
  if (action === "delete") {
    const task = allTasks.find(t => t.id === id);
    const snapshot = task ? { ...task } : null;
    await api(`/api/tasks/${id}`, "DELETE");
    allTasks = allTasks.filter(t => t.id !== id);
    selectedIds.delete(id);
    renderTasks();
    if (snapshot) {
      _pushUndo(`Delete "${snapshot.title}"`,
        async () => {
          const restored = await api("/api/tasks", "POST", {
            title: snapshot.title, priority: snapshot.priority,
            deadline: snapshot.deadline, urgent: snapshot.urgent,
            important: snapshot.important, category: snapshot.category,
            estimated_minutes: snapshot.estimated_minutes,
            task_type: snapshot.task_type, chapter: snapshot.chapter,
          });
          await loadTasks();
        },
        async () => {
          // redo = delete again; but we don't have the restored id here,
          // so just reload so the user can delete manually if needed
          await loadTasks();
        }
      );
    }
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
    check.setAttribute("aria-label", task.completed ? "Mark incomplete" : "Mark complete");
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
      <button class="habit-check ${h.check_count_today > 0 ? "done" : ""}" data-action="toggle"
              aria-label="Check habit"></button>
      ${h.check_count_today > 0
          ? `<span class="habit-count-badge">${h.check_count_today}×</span>`
          : ""}
      <span class="item-title">${escHtml(h.name)}</span>
      <div class="habit-row-right">
        ${h.time_logged_today > 0 ? `<span class="habit-time-chip">⏱ ${fmtTime(h.time_logged_today)}</span>` : ""}
        <button class="btn-icon habit-log-btn" data-action="log-time" title="Log time">⏱</button>
        ${h.streak > 0 ? `<span class="streak-badge">🔥 ${h.streak}d</span>` : ""}
        <button class="btn-icon" data-action="delete" title="Delete">✕</button>
      </div>
    </li>
  `).join("");
  wireHabitLongPress();
}

let suppressHabitClick = false;

function wireHabitLongPress() {
  // Long press on the CHECK BUTTON → -1 count (uncheck one step)
  $$("#habit-list .habit-check").forEach(btn => {
    let timer = null;
    const start = () => {
      timer = setTimeout(async () => {
        timer = null;
        suppressHabitClick = true;
        const li = btn.closest("li");
        const id = Number(li.dataset.id);
        btn.classList.add("press-hold");
        navigator.vibrate?.(25);
        await api(`/api/habits/${id}/uncheck`, "POST");
        await loadHabits();
      }, 500);
    };
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      btn.classList.remove("press-hold");
    };
    btn.addEventListener("mousedown",   start);
    btn.addEventListener("touchstart",  start, { passive: true });
    btn.addEventListener("mouseup",     cancel);
    btn.addEventListener("mouseleave",  cancel);
    btn.addEventListener("touchend",    cancel);
    btn.addEventListener("touchcancel", cancel);
  });

  // Long press on the HABIT ROW itself → full reset (ignores counter)
  $$("#habit-list li[data-id]").forEach(li => {
    let timer = null;
    const start = (e) => {
      // Only trigger from the row background, not from buttons / inputs
      if (e.target.closest("button, input, .habit-time-form")) return;
      timer = setTimeout(async () => {
        timer = null;
        const id = Number(li.dataset.id);
        li.classList.add("press-hold");
        navigator.vibrate?.(40);
        await api(`/api/habits/${id}/reset`, "POST");
        toast("Habit reset");
        await loadHabits();
      }, 600);
    };
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      li.classList.remove("press-hold");
    };
    li.addEventListener("mousedown",   start);
    li.addEventListener("touchstart",  start, { passive: true });
    li.addEventListener("mouseup",     cancel);
    li.addEventListener("mouseleave",  cancel);
    li.addEventListener("touchend",    cancel);
    li.addEventListener("touchcancel", cancel);
  });
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
    if (suppressHabitClick) { suppressHabitClick = false; return; }
    const res = await api(`/api/habits/${id}/toggle`, "POST");
    await loadHabits();
    bounceCheck($(`#habit-list li[data-id="${id}"]`));
  }

  if (action === "log-time") {
    // Close any open picker elsewhere
    $$("#habit-list .habit-time-form").forEach(f => f.remove());

    const PRESETS = [5, 10, 15, 30, 45, 60];
    const form = document.createElement("div");
    form.className = "habit-time-form";
    form.innerHTML = `
      <div class="habit-time-presets">
        ${PRESETS.map(m => `
          <button class="habit-preset-btn" data-minutes="${m}">${fmtTime(m)}</button>
        `).join("")}
        <button class="habit-preset-btn habit-preset-custom" data-action="show-custom">Custom</button>
        <button class="btn-icon" data-action="cancel-time" title="Cancel">✕</button>
      </div>
      <div class="habit-custom-row" hidden>
        <input type="number" class="habit-time-input" placeholder="min" min="1" max="480" inputmode="numeric">
        <button class="habit-preset-btn" data-action="commit-custom">Log</button>
        <button class="btn-icon" data-action="cancel-time" title="Cancel">✕</button>
      </div>
    `;
    li.appendChild(form);

    const logMinutes = async (minutes) => {
      form.remove();
      if (!minutes || minutes < 1) return;
      await api(`/api/habits/${id}/log`, "POST", { minutes });
      toast(`⏱ ${fmtTime(minutes)} logged`);
      loadHabits();
    };

    // Preset chips
    form.querySelectorAll(".habit-preset-btn[data-minutes]").forEach(btn => {
      btn.addEventListener("click", () => logMinutes(Number(btn.dataset.minutes)));
    });

    // Show custom input
    form.querySelector("[data-action='show-custom']").addEventListener("click", () => {
      form.querySelector(".habit-time-presets").hidden = true;
      const row = form.querySelector(".habit-custom-row");
      row.hidden = false;
      const inp = row.querySelector(".habit-time-input");
      inp.focus();
      inp.addEventListener("keydown", ev => {
        if (ev.key === "Enter")  { ev.preventDefault(); logMinutes(parseInt(inp.value, 10)); }
        if (ev.key === "Escape") form.remove();
      });
      row.querySelector("[data-action='commit-custom']").addEventListener("click",
        () => logMinutes(parseInt(inp.value, 10)));
    });
  }

  if (action === "cancel-time") {
    li.querySelector(".habit-time-form")?.remove();
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

// Quadrant → urgent/important flags
const MATRIX_FLAGS = {
  'matrix-q1': { urgent: true,  important: true  },
  'matrix-q2': { urgent: false, important: true  },
  'matrix-q3': { urgent: true,  important: false },
  'matrix-q4': { urgent: false, important: false },
};

// ── Matrix order persistence (localStorage) ───────────────────────────────────

function getMatrixOrders() {
  try { return JSON.parse(localStorage.getItem("matrix-order")) || {}; } catch { return {}; }
}
function saveMatrixOrders(o) { localStorage.setItem("matrix-order", JSON.stringify(o)); }

function applyQuadrantOrder(listId, tasks) {
  const order = getMatrixOrders()[listId] || [];
  if (!order.length) return tasks;
  return [...tasks].sort((a, b) =>
    (order.indexOf(a.id) < 0 ? 9999 : order.indexOf(a.id)) -
    (order.indexOf(b.id) < 0 ? 9999 : order.indexOf(b.id))
  );
}

function captureOrder(listEl) {
  const o = getMatrixOrders();
  o[listEl.id] = [...listEl.querySelectorAll(".matrix-task[data-id]")]
                   .map(li => Number(li.dataset.id));
  saveMatrixOrders(o);
}

function placeInOrder(listId, taskId, beforeId) {
  const o = getMatrixOrders();
  let arr = (o[listId] || []).filter(id => id !== taskId);
  const idx = beforeId != null ? arr.indexOf(beforeId) : -1;
  idx >= 0 ? arr.splice(idx, 0, taskId) : arr.push(taskId);
  o[listId] = arr;
  saveMatrixOrders(o);
}

function removeFromOrder(listId, taskId) {
  const o = getMatrixOrders();
  if (o[listId]) { o[listId] = o[listId].filter(id => id !== taskId); saveMatrixOrders(o); }
}

// ── Drop-line helper (shared by desktop + touch) ───────────────────────────────

let matrixDropLine = null;

function getDropLine() {
  if (!matrixDropLine) {
    matrixDropLine = document.createElement("li");
    matrixDropLine.className = "matrix-drop-line";
    matrixDropLine.setAttribute("aria-hidden", "true");
  }
  return matrixDropLine;
}

function placeDropLine(list, clientY) {
  const line  = getDropLine();
  const items = [...list.querySelectorAll(".matrix-task:not(.dragging)")];
  let placed  = false;
  for (const item of items) {
    const r = item.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { list.insertBefore(line, item); placed = true; break; }
  }
  if (!placed) list.appendChild(line);
}

function removeDropLine() { matrixDropLine?.remove(); }

// id of the item that will follow the drop line (null = end of list)
function getDropBeforeId() {
  if (!matrixDropLine) return null;
  const next = matrixDropLine.nextElementSibling;
  return next?.dataset?.id ? Number(next.dataset.id) : null;
}

// ── Matrix timers (server-persisted, parallel) ────────────────────────────────
// Multiple tasks can be timed simultaneously. Server is source of truth.
// matrixTimers: Map<taskId(number), { serverAccSec, localStart, paused }>
//   localStart = performance.now() at start of current running segment (null if paused)
//   serverAccSec = accumulated seconds from server at last sync

const matrixTimers = new Map();
let matrixTimerIv   = null;  // single interval that ticks all running timers

function _mtElapsed(id) {
  const t = matrixTimers.get(id);
  if (!t) return 0;
  const local = t.localStart != null ? Math.floor((performance.now() - t.localStart) / 1000) : 0;
  return t.serverAccSec + local;
}

function fmtTimerSec(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function _mtUpdateOne(id) {
  const t    = matrixTimers.get(id);
  const span = document.querySelector(`.matrix-task[data-id="${id}"] .matrix-timer`);
  if (!span) return;
  span.textContent = (t?.paused ? "⏸ " : "⏱ ") + fmtTimerSec(_mtElapsed(id));
}

function updateMatrixTimerDisplay() {
  for (const id of matrixTimers.keys()) _mtUpdateOne(id);
}

function _mtApplyUI(id, paused) {
  const li = document.querySelector(`.matrix-task[data-id="${id}"]`);
  if (!li) return;
  li.classList.add("timing");
  li.setAttribute("draggable", "false");
  if (paused) li.classList.add("paused"); else li.classList.remove("paused");
}

function _mtEnsureInterval() {
  if (matrixTimerIv) return;
  matrixTimerIv = setInterval(updateMatrixTimerDisplay, 1000);
}

function _mtMaybeStopInterval() {
  // Stop interval if no running (non-paused) timers remain
  const anyRunning = [...matrixTimers.values()].some(t => !t.paused);
  if (!anyRunning && matrixTimerIv) {
    clearInterval(matrixTimerIv);
    matrixTimerIv = null;
  }
}

async function startMatrixTimer(id) {
  const res = await api("/api/timer/start", "POST", { task_id: id });
  matrixTimers.set(id, { serverAccSec: 0, localStart: performance.now(), paused: false });
  _mtApplyUI(id, false);
  _mtUpdateOne(id);
  _mtEnsureInterval();
}

async function pauseMatrixTimer(id) {
  const t = matrixTimers.get(id);
  if (!t || t.paused) return;
  const res = await api("/api/timer/pause", "POST", { task_id: id });
  if (!res.ok) return;
  t.serverAccSec = res.accumulated_sec;
  t.localStart   = null;
  t.paused       = true;
  const li = document.querySelector(`.matrix-task[data-id="${id}"]`);
  if (li) li.classList.add("paused");
  _mtUpdateOne(id);
  _mtMaybeStopInterval();
}

async function resumeMatrixTimer(id) {
  const t = matrixTimers.get(id);
  if (!t || !t.paused) return;
  const res = await api("/api/timer/resume", "POST", { task_id: id });
  if (!res.ok) return;
  t.localStart = performance.now();
  t.paused     = false;
  const li = document.querySelector(`.matrix-task[data-id="${id}"]`);
  if (li) li.classList.remove("paused");
  _mtUpdateOne(id);
  _mtEnsureInterval();
}

function _mtClearOne(id) {
  matrixTimers.delete(id);
  const li = document.querySelector(`.matrix-task[data-id="${id}"]`);
  if (li) {
    li.classList.remove("timing", "paused");
    li.setAttribute("draggable", "true");
    const s = li.querySelector(".matrix-timer");
    if (s) s.textContent = "";
  }
  _mtMaybeStopInterval();
}

function cancelMatrixTimer(id) {
  // Fire-and-forget delete on server; clear UI immediately
  api("/api/timer", "DELETE", { task_id: id });
  _mtClearOne(id);
}

async function restoreMatrixTimerUI() {
  // Called after every loadMatrix() — seeds local state from server array
  const rows = await api("/api/timer");
  if (!Array.isArray(rows)) return;

  // Clear all local state first
  if (matrixTimerIv) { clearInterval(matrixTimerIv); matrixTimerIv = null; }
  matrixTimers.clear();

  for (const data of rows) {
    const id = data.task_id;
    matrixTimers.set(id, {
      serverAccSec: data.elapsed_sec,
      localStart:   data.paused ? null : performance.now(),
      paused:       data.paused,
    });
    _mtApplyUI(id, data.paused);
    _mtUpdateOne(id);
  }

  if ([...matrixTimers.values()].some(t => !t.paused)) {
    _mtEnsureInterval();
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────

async function loadMatrix() {
  matrixTasks = await api("/api/tasks");
  renderMatrixQuadrant("matrix-q1", matrixTasks.filter(t =>  t.urgent &&  t.important));
  renderMatrixQuadrant("matrix-q2", matrixTasks.filter(t => !t.urgent &&  t.important));
  renderMatrixQuadrant("matrix-q3", matrixTasks.filter(t =>  t.urgent && !t.important));
  renderMatrixQuadrant("matrix-q4", matrixTasks.filter(t => !t.urgent && !t.important));
  await restoreMatrixTimerUI();
  _updateDelegationBadge();
}

function _delegationChip(t) {
  const d = t.delegation_out;
  const i = t.delegation_in;
  if (d) {
    const icon     = { pending: '⏳', accepted: '✓', declined: '✕', done: '✅', revoked: '↩' }[d.status] ?? '';
    const canRevoke = d.status !== 'done' && d.status !== 'revoked' && d.status !== 'declined';
    return `<span class="matrix-delegation-chip out" data-deleg-id="${d.id}" title="Delegated to @${escHtml(d.to_username)}">${icon} @${escHtml(d.to_username)}${
      canRevoke ? ` <button class="deleg-revoke" title="Revoke delegation">✕</button>` : ''
    }</span>`;
  }
  if (i) {
    const isPending  = i.status === 'pending';
    const isAccepted = i.status === 'accepted';
    return `<span class="matrix-delegation-chip in" data-deleg-id="${i.id}">← @${escHtml(i.from_username)}${
      isPending  ? ` <button class="deleg-accept" title="Accept">✓</button><button class="deleg-decline" title="Decline">✕</button>` :
      isAccepted ? ` <button class="deleg-unaccept" title="Undo acceptance">↩</button>` : ''
    }</span>`;
  }
  return '';
}

function renderMatrixQuadrant(listId, tasks) {
  const list   = $(`#${listId}`);
  const sorted = applyQuadrantOrder(listId, tasks);
  if (!sorted.length) { list.innerHTML = '<li class="matrix-empty">No tasks</li>'; return; }
  list.innerHTML = sorted.map(t => {
    const hasDelegOut  = !!t.delegation_out;
    const hasDelegIn   = !!t.delegation_in;
    const extraClass   = hasDelegOut ? ' delegated-out' : hasDelegIn ? ' delegated-in' : '';
    const canDelegate  = !t.completed && !hasDelegOut;
    const draggable    = !t.completed && !matrixTimers.has(t.id);
    return `
    <li class="matrix-task${t.completed ? ' done' : ''}${extraClass}" data-id="${t.id}" draggable="${draggable}">
      <button class="matrix-check${t.completed ? ' done' : ''}" data-action="toggle"
              title="${t.completed ? 'Mark incomplete' : 'Mark complete'}"
              aria-label="${t.completed ? 'Mark incomplete' : 'Mark complete'}"></button>
      <span class="matrix-task-title">${escHtml(t.title)}</span>
      <span class="matrix-timer"></span>
      ${_delegationChip(t)}
      ${t.time_logged > 0 ? `<span class="matrix-time-logged">⏱ ${fmtTime(t.time_logged)}</span>` : ''}
      ${t.deadline ? `<span class="item-meta">${t.deadline}</span>` : ''}
      ${canDelegate ? `<button class="matrix-delegate-btn" title="Delegate task" aria-label="Delegate">→</button>` : ''}
    </li>`;
  }).join("");
}

// ── Delegation UI ──────────────────────────────────────────────────────────────

let _delegPopover = null;

function _showDelegatePopover(li, taskId) {
  _hideDelegatePopover();
  const pop = document.createElement('div');
  pop.className = 'delegate-popover';
  pop.innerHTML = `
    <input class="dp-user" type="text" placeholder="Username" autocomplete="off" spellcheck="false" />
    <input class="dp-note" type="text" placeholder="Note (optional)" />
    <div class="delegate-popover-btns">
      <button class="delegate-cancel-btn">Cancel</button>
      <button class="delegate-send-btn">Delegate →</button>
    </div>
    <div class="delegate-popover-error"></div>`;
  document.body.appendChild(pop);

  // position: fixed is viewport-relative — do NOT add scrollY
  const rect = li.getBoundingClientRect();
  pop.style.top  = (rect.bottom + 4) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';

  _delegPopover = { el: pop, taskId };
  // Defer focus until after the browser has painted the element
  requestAnimationFrame(() => pop.querySelector('.dp-user').focus());

  const send = async () => {
    const username = pop.querySelector('.dp-user').value.trim();
    const note     = pop.querySelector('.dp-note').value.trim();
    const errEl    = pop.querySelector('.delegate-popover-error');
    errEl.style.display = 'none';
    if (!username) { errEl.textContent = 'Enter a username'; errEl.style.display = 'block'; return; }
    const res = await api(`/api/tasks/${taskId}/delegate`, 'POST', { username, note });
    if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
    toast(`Delegated to @${username} ✓`);
    _hideDelegatePopover();
    loadMatrix();
  };

  pop.querySelector('.delegate-send-btn').addEventListener('click', send);
  pop.querySelector('.delegate-cancel-btn').addEventListener('click', _hideDelegatePopover);
  pop.querySelector('.dp-user').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  // Delay so the originating click doesn't immediately re-close the popover
  setTimeout(() => document.addEventListener('click', _delegOutsideClick), 120);
}

function _delegOutsideClick(e) {
  if (_delegPopover && !_delegPopover.el.contains(e.target)) _hideDelegatePopover();
}
function _hideDelegatePopover() {
  _delegPopover?.el.remove();
  _delegPopover = null;
  document.removeEventListener('click', _delegOutsideClick);
}

async function _updateDelegationBadge() {
  const inbox = await api('/api/delegations/inbox');
  const count = Array.isArray(inbox) ? inbox.length : 0;
  const btn   = document.querySelector('.nav-btn[data-tab="matrix"]');
  if (!btn) return;
  let badge = btn.querySelector('.nav-badge');
  if (count > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; btn.appendChild(badge); }
    badge.textContent = count;
  } else {
    badge?.remove();
  }
}

// ── Undo / Redo ────────────────────────────────────────────────────────────────
// Each entry: { label, undo: async fn, redo: async fn }
// Performing a new action always clears the redo branch.

const _undoStack = [];
const _redoStack = [];
const UNDO_LIMIT = 50;

function _pushUndo(label, undoFn, redoFn) {
  _undoStack.push({ label, undo: undoFn, redo: redoFn });
  if (_undoStack.length > UNDO_LIMIT) _undoStack.shift();
  _redoStack.length = 0;
  _updateUndoRedoBtns();
}

async function _doUndo() {
  const a = _undoStack.pop();
  if (!a) { toast("Nothing to undo"); return; }
  await a.undo();
  _redoStack.push(a);
  toast(`↩ ${a.label}`);
  _updateUndoRedoBtns();
}

async function _doRedo() {
  const a = _redoStack.pop();
  if (!a) { toast("Nothing to redo"); return; }
  await a.redo();
  _undoStack.push(a);
  toast(`↪ ${a.label}`);
  _updateUndoRedoBtns();
}

function _reloadActivePane() {
  const p = document.querySelector('.nav-btn.active')?.dataset.tab;
  if (p === 'matrix')    return loadMatrix();
  if (p === 'tasks')     return loadTasks();
  if (p === 'dashboard') return loadDashboard();
  if (p === 'habits')    return Promise.all([loadHabits(), loadGoals()]);
  return Promise.resolve();
}

function _updateUndoRedoBtns() {
  const u = document.getElementById('undo-btn');
  const r = document.getElementById('redo-btn');
  if (u) u.disabled = _undoStack.length === 0;
  if (r) r.disabled = _redoStack.length === 0;
}
document.getElementById('undo-btn')?.addEventListener('click', _doUndo);
document.getElementById('redo-btn')?.addEventListener('click', _doRedo);

// Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo  (skip when focus is in an input)
document.addEventListener('keydown', e => {
  const inField = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
  if (inField) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); _doUndo(); }
  if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); _doRedo(); }
});

// ── Click / timer / double-click ──────────────────────────────────────────────

let matrixPauseHoldTimer = null;

// Double-tap on logged-time chip → reset all logs for that task
$("#tab-matrix").addEventListener("click", async e => {
  const result = await _handleLogBadgeTap(e, ".matrix-time-logged");
  if (result === "reset") loadMatrix();
});

// Delegate button → open popover
$("#tab-matrix").addEventListener("click", e => {
  const btn = e.target.closest(".matrix-delegate-btn");
  if (!btn) return;
  e.stopImmediatePropagation(); // prevent other #tab-matrix click listeners from firing
  const li = btn.closest("li[data-id]");
  if (li) _showDelegatePopover(li, Number(li.dataset.id));
});

// Accept / decline / unaccept / revoke delegation chips
$("#tab-matrix").addEventListener("click", async e => {
  const accept   = e.target.closest(".deleg-accept");
  const decline  = e.target.closest(".deleg-decline");
  const unaccept = e.target.closest(".deleg-unaccept");
  const revoke   = e.target.closest(".deleg-revoke");
  const hit = accept || decline || unaccept || revoke;
  if (!hit) return;
  e.stopImmediatePropagation();
  const chip    = hit.closest(".matrix-delegation-chip");
  const delegId = Number(chip?.dataset.delegId);
  if (!delegId) return;
  if (accept) {
    await api(`/api/delegations/${delegId}/accept`,   'POST', {});
    toast("Delegation accepted ✓");
  } else if (decline) {
    await api(`/api/delegations/${delegId}/decline`,  'POST', {});
    toast("Delegation declined");
  } else if (unaccept) {
    await api(`/api/delegations/${delegId}/unaccept`, 'POST', {});
    toast("Acceptance undone — back to pending");
  } else if (revoke) {
    await api(`/api/delegations/${delegId}/revoke`,   'POST', {});
    toast("Delegation revoked");
  }
  loadMatrix();
});

// Checkbox: 1st click = start timer, 2nd click = stop + log + sacrifice
// Double-click = instant sacrifice (no timer)
// Completed task checkbox = reopen immediately
$("#tab-matrix").addEventListener("dblclick", async e => {
  const checkBtn = e.target.closest(".matrix-check");
  if (!checkBtn) return;
  const li = checkBtn.closest("li[data-id]");
  if (!li) return;
  const id   = Number(li.dataset.id);
  const task = matrixTasks.find(t => t.id === id);
  if (!task || task.completed) return;
  if (matrixTimers.has(id)) cancelMatrixTimer(id);
  await api(`/api/tasks/${id}`, "PUT", { completed: true });
  _pushUndo(`Sacrifice "${task.title}"`,
    async () => { await api(`/api/tasks/${id}`, "PUT", { completed: false }); await loadMatrix(); },
    async () => { await api(`/api/tasks/${id}`, "PUT", { completed: true  }); await loadMatrix(); }
  );
  toast("Task sacrificed ✓");
  loadMatrix();
});

$("#tab-matrix").addEventListener("click", async e => {
  const checkBtn = e.target.closest(".matrix-check");
  if (!checkBtn) return;
  if (e.detail >= 2) return; // dblclick handles it

  const li = checkBtn.closest("li[data-id]");
  if (!li) return;
  const id   = Number(li.dataset.id);
  const task = matrixTasks.find(t => t.id === id);
  if (!task) return;

  // Already done → reopen immediately
  if (task.completed) {
    await api(`/api/tasks/${id}`, "PUT", { completed: false });
    _pushUndo(`Reopen "${task.title}"`,
      async () => { await api(`/api/tasks/${id}`, "PUT", { completed: true  }); await loadMatrix(); },
      async () => { await api(`/api/tasks/${id}`, "PUT", { completed: false }); await loadMatrix(); }
    );
    toast("Task reopened");
    loadMatrix();
    return;
  }

  // Timer running on this task → stop, log, sacrifice
  if (matrixTimers.has(id)) {
    const elapsed = _mtElapsed(id);
    cancelMatrixTimer(id);
    await api(`/api/tasks/${id}`, "PUT", { completed: true });
    const mins = elapsed >= 60 ? Math.round(elapsed / 60) : 0;
    if (mins > 0) await api(`/api/tasks/${id}/log`, "POST", { minutes: mins });
    _pushUndo(`Sacrifice "${task.title}"`,
      async () => {
        await api(`/api/tasks/${id}`, "PUT", { completed: false });
        if (mins > 0) await api(`/api/tasks/${id}/log`, "DELETE", null);
        await loadMatrix();
      },
      async () => {
        await api(`/api/tasks/${id}`, "PUT", { completed: true });
        if (mins > 0) await api(`/api/tasks/${id}/log`, "POST", { minutes: mins });
        await loadMatrix();
      }
    );
    toast(mins > 0 ? `Task sacrificed ✓ — ${mins}m logged` : "Task sacrificed ✓");
    loadMatrix();
    return;
  }

  // No timer on this task yet → start one (other tasks keep their timers)
  await startMatrixTimer(id);
});

// Desktop hold on task row: pause/resume when timer is running on that task
$("#tab-matrix").addEventListener("mousedown", e => {
  if (e.button !== 0) return;
  if (e.target.closest(".matrix-check")) return; // checkbox handles its own clicks
  const li = e.target.closest(".matrix-task[data-id]");
  if (!li) return;
  const id = Number(li.dataset.id);
  if (!matrixTimers.has(id)) return; // no timer on this task → drag handles it
  matrixPauseHoldTimer = setTimeout(() => {
    matrixPauseHoldTimer = null;
    const t = matrixTimers.get(id);
    if (t) t.paused ? resumeMatrixTimer(id) : pauseMatrixTimer(id);
  }, 400);
});
window.addEventListener("mouseup", () => {
  if (matrixPauseHoldTimer) { clearTimeout(matrixPauseHoldTimer); matrixPauseHoldTimer = null; }
});

// ── Desktop drag-and-drop ──────────────────────────────────────────────────────

let matrixDragId       = null;
let matrixDragSourceId = null;

$("#tab-matrix").addEventListener("dragstart", e => {
  const li = e.target.closest(".matrix-task[data-id]");
  if (!li) { e.preventDefault(); return; }
  const id = Number(li.dataset.id);
  if (matrixTimers.has(id)) { e.preventDefault(); return; } // timed task: no drag
  matrixDragId       = id;
  matrixDragSourceId = li.closest(".matrix-task-list")?.id ?? null;
  e.dataTransfer.effectAllowed = "move";
  requestAnimationFrame(() => li.classList.add("dragging"));
});

$("#tab-matrix").addEventListener("dragend", () => {
  matrixDragId = null; matrixDragSourceId = null;
  removeDropLine();
  $$(".matrix-task.dragging").forEach(el => el.classList.remove("dragging"));
  $$(".matrix-quadrant.drag-over").forEach(el => el.classList.remove("drag-over"));
});

$("#tab-matrix").addEventListener("dragover", e => {
  if (matrixDragId == null) return;
  const q = e.target.closest(".matrix-quadrant");
  if (!q) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (!q.classList.contains("drag-over")) {
    $$(".matrix-quadrant.drag-over").forEach(el => el.classList.remove("drag-over"));
    q.classList.add("drag-over");
  }
  const list = q.querySelector(".matrix-task-list");
  if (list) placeDropLine(list, e.clientY);
});

$("#tab-matrix").addEventListener("dragleave", e => {
  const q = e.target.closest(".matrix-quadrant");
  if (!q || q.contains(e.relatedTarget)) return;
  q.classList.remove("drag-over");
  removeDropLine();
});

$("#tab-matrix").addEventListener("drop", async e => {
  e.preventDefault();
  const q = e.target.closest(".matrix-quadrant");
  $$(".matrix-quadrant.drag-over").forEach(el => el.classList.remove("drag-over"));
  if (!q || matrixDragId == null) return;

  const listEl = q.querySelector(".matrix-task-list");
  const flags  = listEl && MATRIX_FLAGS[listEl.id];
  if (!flags) return;

  const task     = matrixTasks.find(t => t.id === matrixDragId);
  if (!task) return;

  const beforeId = getDropBeforeId();
  removeDropLine();

  const sameQ = !!task.urgent === flags.urgent && !!task.important === flags.important;

  if (sameQ) {
    // Reorder within column — pure DOM move, no API call
    const draggedEl = listEl.querySelector(`.matrix-task[data-id="${matrixDragId}"]`);
    if (draggedEl) {
      const beforeEl = beforeId != null
        ? listEl.querySelector(`.matrix-task[data-id="${beforeId}"]`) : null;
      beforeEl ? listEl.insertBefore(draggedEl, beforeEl) : listEl.appendChild(draggedEl);
    }
    captureOrder(listEl);
  } else {
    // Cross-column move: persist new position then re-render
    if (matrixDragSourceId) removeFromOrder(matrixDragSourceId, matrixDragId);
    placeInOrder(listEl.id, matrixDragId, beforeId);
    const label = q.querySelector(".quadrant-label")?.textContent ?? "quadrant";
    await api(`/api/tasks/${matrixDragId}`, "PUT", { urgent: flags.urgent, important: flags.important });
    toast(`Moved to "${label}"`);
    loadMatrix();
  }
});

// ── Touch drag-and-drop (mobile / Safari) ─────────────────────────────────────

let touchDragId       = null;
let touchDragEl       = null;
let touchDragSourceId = null;
let touchClone        = null;
let touchOffsetX      = 0;
let touchOffsetY      = 0;
let touchOverQ        = null;
let touchActive       = false;
let touchStartX       = 0;
let touchStartY       = 0;
let touchLastY        = 0;
let longPressTimer    = null;
let autoScrollRAF     = null;

const LONG_PRESS_MS    = 420;
const SCROLL_CANCEL_PX = 10;
const SCROLL_EDGE_SIZE = 80;
const SCROLL_MAX_SPEED = 14;

function edgeScrollSpeed(clientY) {
  const vh = window.innerHeight;
  if (clientY < SCROLL_EDGE_SIZE)
    return -Math.round((1 - clientY / SCROLL_EDGE_SIZE) * SCROLL_MAX_SPEED);
  if (clientY > vh - SCROLL_EDGE_SIZE)
    return  Math.round(((clientY - (vh - SCROLL_EDGE_SIZE)) / SCROLL_EDGE_SIZE) * SCROLL_MAX_SPEED);
  return 0;
}

function stopAutoScroll() {
  if (autoScrollRAF) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
}

function startAutoScroll() {
  if (autoScrollRAF) return;
  (function tick() {
    const s = edgeScrollSpeed(touchLastY);
    if (s === 0) { autoScrollRAF = null; return; }
    window.scrollBy(0, s);
    autoScrollRAF = requestAnimationFrame(tick);
  })();
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  touchDragEl?.classList.remove("press-hold");
}

(function wireMatrixTouch() {
  const tab = $("#tab-matrix");

  tab.addEventListener("touchstart", e => {
    const li = e.target.closest(".matrix-task[data-id]");
    if (!li || e.target.closest(".matrix-check")) return;
    const id = Number(li.dataset.id);

    // ── Timed task: long press on row = pause/resume, drag is blocked ──
    if (matrixTimers.has(id)) {
      if (e.target.closest(".matrix-check")) return; // let checkbox handle its own tap
      li.classList.add("press-hold");
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        li.classList.remove("press-hold");
        try { navigator.vibrate?.(15); } catch (_) {}
        const t = matrixTimers.get(id);
        if (t) t.paused ? resumeMatrixTimer(id) : pauseMatrixTimer(id);
      }, LONG_PRESS_MS);
      return; // skip drag setup entirely
    }

    // ── Normal task: long press = drag ──
    const t         = e.touches[0];
    touchDragEl     = li;
    touchDragId     = id;
    touchDragSourceId = li.closest(".matrix-task-list")?.id ?? null;
    touchActive     = false;
    touchStartX     = t.clientX;
    touchStartY     = t.clientY;
    touchLastY      = t.clientY;
    const r         = li.getBoundingClientRect();
    touchOffsetX    = t.clientX - r.left;
    touchOffsetY    = t.clientY - r.top;
    li.classList.add("press-hold");

    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      touchActive = true;
      li.classList.remove("press-hold");
      try { navigator.vibrate?.(25); } catch (_) {}
      const rect = li.getBoundingClientRect();
      touchClone = li.cloneNode(true);
      touchClone.classList.add("matrix-drag-clone");
      Object.assign(touchClone.style, {
        position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, pointerEvents: "none", zIndex: "9999",
      });
      document.body.appendChild(touchClone);
      li.classList.add("dragging");
    }, LONG_PRESS_MS);
  }, { passive: true });

  tab.addEventListener("touchmove", e => {
    if (!touchDragEl) return;
    const t = e.touches[0];
    touchLastY = t.clientY;

    if (!touchActive) {
      if (Math.abs(t.clientX - touchStartX) > SCROLL_CANCEL_PX ||
          Math.abs(t.clientY - touchStartY) > SCROLL_CANCEL_PX) {
        cancelLongPress(); touchDragEl = null; touchDragId = null;
      }
      return;
    }

    e.preventDefault();
    touchClone.style.left = `${t.clientX - touchOffsetX}px`;
    touchClone.style.top  = `${t.clientY - touchOffsetY}px`;
    edgeScrollSpeed(t.clientY) !== 0 ? startAutoScroll() : stopAutoScroll();

    touchClone.style.visibility = "hidden";
    const under = document.elementFromPoint(t.clientX, t.clientY);
    touchClone.style.visibility = "";
    const q = under?.closest(".matrix-quadrant") ?? null;

    if (q !== touchOverQ) {
      touchOverQ?.classList.remove("drag-over");
      touchOverQ = q;
      q?.classList.add("drag-over");
    }

    // Show insertion line within the list
    const list = q?.querySelector(".matrix-task-list");
    if (list) placeDropLine(list, t.clientY);
    else removeDropLine();
  }, { passive: false });

  async function onTouchEnd() {
    cancelLongPress();
    stopAutoScroll();

    const wasActive = touchActive;
    const q         = touchOverQ;
    const id        = touchDragId;
    const sourceId  = touchDragSourceId;
    const beforeId  = getDropBeforeId();

    removeDropLine();
    touchClone?.remove();                                        touchClone  = null;
    touchDragEl?.classList.remove("dragging", "press-hold");    touchDragEl = null;
    $$(".matrix-quadrant.drag-over").forEach(el => el.classList.remove("drag-over"));
    touchDragId = null; touchActive = false; touchOverQ = null; touchDragSourceId = null;

    if (!wasActive || !q || id == null) return;

    const listEl = q.querySelector(".matrix-task-list");
    const flags  = listEl && MATRIX_FLAGS[listEl.id];
    if (!flags) return;

    const task = matrixTasks.find(t => t.id === id);
    if (!task) return;

    const sameQ = !!task.urgent === flags.urgent && !!task.important === flags.important;

    if (sameQ) {
      const draggedEl = listEl.querySelector(`.matrix-task[data-id="${id}"]`);
      if (draggedEl) {
        const beforeEl = beforeId != null
          ? listEl.querySelector(`.matrix-task[data-id="${beforeId}"]`) : null;
        beforeEl ? listEl.insertBefore(draggedEl, beforeEl) : listEl.appendChild(draggedEl);
      }
      captureOrder(listEl);
    } else {
      if (sourceId) removeFromOrder(sourceId, id);
      placeInOrder(listEl.id, id, beforeId);
      const label = q.querySelector(".quadrant-label")?.textContent ?? "quadrant";
      await api(`/api/tasks/${id}`, "PUT", { urgent: flags.urgent, important: flags.important });
      toast(`Moved to "${label}"`);
      loadMatrix();
    }
  }

  tab.addEventListener("touchend",    onTouchEnd);
  tab.addEventListener("touchcancel", onTouchEnd);
})();

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
  // Show correct extras per tab
  const loginExtras  = $("#auth-login-extras");
  const signupExtras = $("#auth-signup-extras");
  if (loginExtras)  loginExtras.hidden  = authMode !== "login";
  if (signupExtras) signupExtras.hidden = authMode !== "signup";
  // Reset users list when switching tabs
  const ul = $("#auth-users-list");
  if (ul) { ul.hidden = true; ul.innerHTML = ""; }
  const sub = $("#show-users-btn");
  if (sub) sub.textContent = "Show all users";
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
    // Full reload flushes all JS state (cached tasks, matrix, habits, etc.)
    // so the new user starts with a completely clean slate.
    location.reload();
  } catch (err) {
    setAuthError("Network error. Try again.");
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
  // Show-users button (signup pane only)
  const showUsersBtn  = $("#show-users-btn");
  const usersListEl   = $("#auth-users-list");
  const signupExtras  = $("#auth-signup-extras");
  if (showUsersBtn) {
    showUsersBtn.addEventListener("click", async () => {
      const pwd = prompt("Enter password to view users:");
      if (pwd === null) return;
      if (pwd !== "claude") { alert("Wrong password."); return; }
      // Toggle list visibility
      if (!usersListEl.hidden) { usersListEl.hidden = true; showUsersBtn.textContent = "Show all users"; return; }
      showUsersBtn.disabled = true;
      try {
        const res  = await fetch("/api/auth/users");
        const data = await res.json();
        usersListEl.innerHTML = data.length
          ? data.map(u => `<li><span class="auth-user-name">${escHtml(u.username)}</span><span class="auth-user-date">${u.created_at}</span></li>`).join("")
          : "<li class='auth-users-empty'>No users yet</li>";
        usersListEl.hidden = false;
        showUsersBtn.textContent = "Hide users";
      } finally {
        showUsersBtn.disabled = false;
      }
    });
  }

  // Delete account
  const del = $("#delete-account-btn");
  if (del) del.addEventListener("click", async () => {
    const username = $("#auth-username").value.trim();
    if (!username) { alert("Enter your username first."); $("#auth-username").focus(); return; }
    const pwd = prompt("Enter reset password:");
    if (pwd === null) return;
    if (pwd !== "claude") { alert("Wrong password."); return; }
    if (!confirm(`Reset all data for "${username}"? Tasks, habits and goals will be permanently cleared.`)) return;
    del.disabled = true;
    try {
      const { ok, data } = await authFetch("/api/auth/reset", { username });
      if (!ok) { alert(data?.error || "Reset failed."); return; }
      toast("Account data cleared");
    } finally {
      del.disabled = false;
    }
  });
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
