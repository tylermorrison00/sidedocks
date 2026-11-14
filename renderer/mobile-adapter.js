// Mobile Adapter & Storage Engine for Side Dock
(function() {
  if (window.sideDock) {
    // Running in Electron Desktop
    return;
  }

  // Running on Android / Mobile Browser
  console.log('Side Dock: Running in Mobile / Browser Mode');

  function getLocal(key, def = []) {
    try {
      const val = localStorage.getItem('sidedock_' + key);
      return val ? JSON.parse(val) : def;
    } catch {
      return def;
    }
  }

  function setLocal(key, val) {
    try {
      localStorage.setItem('sidedock_' + key, JSON.stringify(val));
    } catch {}
    // Trigger auto-sync if logged in
    if (window.SyncEngine && window.SyncEngine.getUser()) {
      window.SyncEngine.pushToCloud();
    }
  }

  const defaultTools = [
    { id: 'todo-list', name: 'To Do List', icon: '', target: 'todo', kind: 'app', logo: 'todo-logo-orange-final-inverted.png', iconAccent: 'todo-icon-accent.png' },
    { id: 'notes', name: 'Notes', icon: '', target: 'notes', kind: 'app', logo: 'notes-logo-orange-final.png', iconAccent: 'notes-icon-accent.png' },
    { id: 'habit-tracker', name: 'Habit Tracker', icon: '', target: 'habit', kind: 'app', logo: 'habit-tracker-logo.png', iconAccent: 'habit-tracker-logo.png' }
  ];

  window.sideDock = {
    getState: async () => ({
      mode: 'collapsed',
      autoStart: false,
      theme: localStorage.getItem('sidedock_theme') || 'dark',
      autoHide: false,
      hidden: false,
      panelOpen: true,
      hasToken: false,
      tools: getLocal('tools', defaultTools)
    }),
    setMode: async (m) => m,
    setPanel: async (p) => p,
    setHidden: async (h) => false,
    setAutohide: async (a) => false,
    showFromArrow: async () => false,
    onAutoHideShow: () => {},
    onAutoHideHide: () => {},
    onAutoHideArrowOnly: () => {},
    setTheme: async (t) => {
      localStorage.setItem('sidedock_theme', t);
      return t;
    },
    setAutostart: async () => false,
    doUpdate: async () => ({ ok: false, message: 'App updates are managed through APK downloads.' }),
    addTool: async (tool) => {
      const tools = getLocal('tools', defaultTools);
      tools.push({ id: Date.now().toString(), name: String(tool.name || 'Tool').slice(0, 40), icon: String(tool.icon || '◆').slice(0, 4), target: String(tool.target || ''), kind: tool.kind === 'app' ? 'app' : 'url' });
      setLocal('tools', tools);
      return tools;
    },
    removeTool: async (id) => {
      const tools = getLocal('tools', defaultTools).filter(t => t.id !== id);
      setLocal('tools', tools);
      return tools;
    },
    launchTool: (tool) => {
      if (!tool || !tool.target) return;
      if (tool.kind === 'url' || tool.target.startsWith('http')) {
        window.open(tool.target, '_blank');
      }
    },
    minimize: () => {},
    close: () => {},
    setMouseEvents: () => {},

    // Todos
    getTodos: async () => getLocal('todos', []),
    addTodo: async (text) => {
      const todos = getLocal('todos', []);
      const item = { id: Date.now().toString(), text: String(text || '').slice(0, 200), done: false };
      if (!item.text.trim()) return todos;
      todos.push(item);
      setLocal('todos', todos);
      return todos;
    },
    toggleTodo: async (id) => {
      const todos = getLocal('todos', []).map(x => x.id === id ? { ...x, done: !x.done } : x);
      setLocal('todos', todos);
      return todos;
    },
    deleteTodo: async (id) => {
      const todos = getLocal('todos', []).filter(x => x.id !== id);
      setLocal('todos', todos);
      return todos;
    },
    editTodo: async (id, text) => {
      const todos = getLocal('todos', []).map(x => x.id === id ? { ...x, text: String(text || '').slice(0, 200) } : x);
      setLocal('todos', todos);
      return todos;
    },
    restoreTodo: async (item) => {
      const todos = getLocal('todos', []);
      if (!item || todos.some(x => x.id === item.id)) return todos;
      todos.push(item);
      setLocal('todos', todos);
      return todos;
    },

    // Notes
    getNotes: async () => getLocal('notes', []),
    addNote: async (data) => {
      const notes = getLocal('notes', []);
      const title = typeof data === 'object' ? String(data.title || '').slice(0, 200) : '';
      const text = typeof data === 'object' ? String(data.text || '').slice(0, 5000) : String(data || '').slice(0, 5000);
      if (!text.trim()) return notes;
      const item = { id: Date.now().toString(), title: title.trim() || text.split('\n')[0].slice(0, 60), text };
      notes.unshift(item);
      setLocal('notes', notes);
      return notes;
    },
    copyNote: async (text) => {
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(String(text || ''));
      } catch {}
      return true;
    },
    deleteNote: async (id) => {
      const notes = getLocal('notes', []).filter(x => x.id !== id);
      setLocal('notes', notes);
      return notes;
    },
    editNote: async (id, data) => {
      const notes = getLocal('notes', []).map(x => {
        if (x.id !== id) return x;
        if (typeof data === 'object') return { ...x, title: String(data.title || x.title || '').slice(0, 200), text: String(data.text || '').slice(0, 5000) };
        return { ...x, text: String(data || '').slice(0, 5000) };
      });
      setLocal('notes', notes);
      return notes;
    },
    restoreNote: async (item) => {
      const notes = getLocal('notes', []);
      if (!item || notes.some(x => x.id === item.id)) return notes;
      notes.unshift(item);
      setLocal('notes', notes);
      return notes;
    },

    // Habits
    getHabits: async () => getLocal('habits', []),
    addHabit: async (name) => {
      const h = getLocal('habits', []);
      const nm = String(name || '').trim().slice(0, 200);
      if (!nm) return h;
      h.push({ id: Date.now().toString(), name: nm, days: {} });
      setLocal('habits', h);
      return h;
    },
    deleteHabit: async (id) => {
      const h = getLocal('habits', []).filter(x => x.id !== id);
      setLocal('habits', h);
      return h;
    },
    toggleHabit: async (id) => {
      function todayPKT() {
        try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
        catch { const x = new Date(); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0'); }
      }
      const h = getLocal('habits', []).map(x => {
        if (x.id !== id) return x;
        const days = { ...(x.days || {}) };
        const today = todayPKT();
        if (days[today]) delete days[today]; else days[today] = true;
        return { ...x, days };
      });
      setLocal('habits', h);
      return h;
    },
    editHabit: async (id, name) => {
      const h = getLocal('habits', []).map(x => x.id === id ? { ...x, name: String(name || '').trim().slice(0, 200) || x.name } : x);
      setLocal('habits', h);
      return h;
    },
    restoreHabit: async (item) => {
      const h = getLocal('habits', []);
      if (!item || h.some(x => x.id === item.id)) return h;
      h.push(item);
      setLocal('habits', h);
      return h;
    },

    // Screen controls fallback for mobile
    getExtraDim: async () => ({ level: 0 }),
    setExtraDim: async () => ({ level: 0 })
  };
})();
