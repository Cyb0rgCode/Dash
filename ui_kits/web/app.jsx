/* App orchestrator — tab routing + in-memory state. */

const THEME_KEY = "husky-theme";
const USERS_KEY = "husky-users";          // JSON array of usernames
const SESSION_KEY = "husky-username";     // currently signed-in username

const USERNAME_RE = /^[A-Za-z0-9_]{2,32}$/;

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch (e) {}
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // Seed the kit with the same default owner as the Flask backend.
  const seed = ["sofien"];
  try { localStorage.setItem(USERS_KEY, JSON.stringify(seed)); } catch (e) {}
  return seed;
}

function writeUsers(users) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch (e) {}
}

function Login({ onLogin }) {
  const [mode, setMode] = React.useState("login");
  const [username, setUsername] = React.useState("");
  const [error, setError] = React.useState("");
  const inputRef = React.useRef(null);

  React.useEffect(() => { try { inputRef.current && inputRef.current.focus(); } catch (e) {} }, []);

  function submit(e) {
    e.preventDefault();
    setError("");
    const u = username.trim();
    if (!USERNAME_RE.test(u)) {
      setError("Username must be 2–32 characters: letters, numbers, underscore.");
      return;
    }
    const users = readUsers();
    const exists = users.some(x => x.toLowerCase() === u.toLowerCase());
    if (mode === "login") {
      if (!exists) { setError("No account with that username. Try Sign up instead."); return; }
      onLogin(u);
    } else {
      if (exists) { setError("That username is taken. Try Sign in instead."); return; }
      writeUsers(users.concat(u));
      onLogin(u);
    }
  }

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-text">Husky</span>
          <span className="auth-brand-sub">Sign in with just a username</span>
        </div>

        <div className="auth-tabs" role="tablist" data-mode={mode}>
          <span className="auth-tab-indicator" aria-hidden="true"/>
          <button type="button" className={`auth-tab ${mode === "login"  ? "active" : ""}`} role="tab" aria-selected={mode === "login"}  onClick={() => { setMode("login");  setError(""); }}>Sign in</button>
          <button type="button" className={`auth-tab ${mode === "signup" ? "active" : ""}`} role="tab" aria-selected={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button>
        </div>

        <form className="auth-form" onSubmit={submit} autoComplete="off" noValidate>
          <label className="auth-label" htmlFor="auth-username">Username</label>
          <input
            ref={inputRef}
            id="auth-username"
            className="auth-input"
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="user"
            minLength={2}
            maxLength={32}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <p className="auth-hint">Letters, numbers, underscore. 2–32 characters.</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="auth-submit">
            <span className="auth-submit-label">{mode === "signup" ? "Create account" : "Continue"}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = React.useState("dashboard");
  const [theme, setTheme] = React.useState(readInitialTheme);
  const [user, setUser] = React.useState(() => {
    try { return localStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; }
  });

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }, [theme]);

  React.useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_KEY, user);
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }, [user]);

  if (!user) return <Login onLogin={setUser}/>;

  const logout = () => setUser(null);
  const [tasks, setTasks] = React.useState([
    { id: 1, title: "Finish thesis introduction draft",  priority: "high",   urgent: true,  important: true,  completed: false, category: "Thesis",  task_type: "writing", deadline: "May 18", time_logged: 80 },
    { id: 2, title: "Reply to advisor about Friday",      priority: "high",   urgent: true,  important: false, completed: false, category: "Email" },
    { id: 3, title: "Submit assignment 4 to portal",      priority: "high",   urgent: false, important: true,  completed: false, category: "Math 201",  task_type: "assignment", deadline: "May 21" },
    { id: 4, title: "Read chapter 3 intro",               priority: "low",    urgent: false, important: false, completed: true,  category: "Math 201",  task_type: "reading",    time_logged: 12, completed_today: true },
    { id: 5, title: "Review meeting notes from Tuesday",  priority: "medium", urgent: false, important: false, completed: false, category: "Lab" },
    { id: 6, title: "Cancel unused subscription",         priority: "low",    urgent: false, important: false, completed: false, category: "Admin" },
  ]);

  const [habits, setHabits] = React.useState([
    { id: 1, name: "Read for 30 minutes", done_today: true,  streak: 14 },
    { id: 2, name: "Run 3 km",            done_today: false, streak: 0  },
    { id: 3, name: "No screens after 11", done_today: true,  streak: 5  },
  ]);

  const [goals, setGoals] = React.useState([
    { id: 1, title: "Run 100 km this quarter",        target_value: 100, current_value: 62,  unit: "km",   deadline: "Jun 30" },
    { id: 2, title: "Finish 6 chapters of thesis",    target_value: 6,   current_value: 2,   unit: "ch",   deadline: "Aug 15" },
  ]);

  const nextId = (arr) => Math.max(0, ...arr.map(x => x.id)) + 1;

  const addTask = (data) => {
    setTasks(prev => [{ ...data, id: nextId(prev), completed: false }, ...prev]);
  };
  const toggleTask = (id) => {
    setTasks(prev => prev.map(t => t.id === id
      ? { ...t, completed: !t.completed, completed_today: !t.completed }
      : t));
  };
  const deleteTask = (id) => setTasks(prev => prev.filter(t => t.id !== id));

  const toggleHabit = (id) => {
    setHabits(prev => prev.map(h => h.id === id
      ? { ...h, done_today: !h.done_today, streak: h.done_today ? Math.max(0, h.streak - 1) : h.streak + 1 }
      : h));
  };
  const addHabit = (name) => setHabits(prev => [...prev, { id: nextId(prev), name, done_today: false, streak: 0 }]);
  const addGoal  = (data) => setGoals(prev => [...prev, { ...data, id: nextId(prev) }]);

  return (
    <React.Fragment>
      <Sidebar active={tab} onChange={setTab} theme={theme} onThemeChange={setTheme} user={user} onLogout={logout}/>
      <main className="content">
        {tab === "dashboard" && <Dashboard tasks={tasks}/>}
        {tab === "matrix"    && <MatrixView tasks={tasks} onToggle={toggleTask}/>}
        {tab === "tasks"     && <Tasks tasks={tasks} onAdd={addTask} onToggle={toggleTask} onDelete={deleteTask}/>}
        {tab === "habits"    && <HabitsGoals habits={habits} goals={goals} onToggleHabit={toggleHabit} onAddHabit={addHabit} onAddGoal={addGoal}/>}
      </main>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
