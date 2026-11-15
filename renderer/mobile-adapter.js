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

  // ---- Mobile in-app update (real check, not a dead message) ----
  // The GitHub release publishes version.json next to Side.Dock.apk.
  // versionCode rises on every CI build, so Android accepts the new APK
  // over the installed one (same versionCode used to block the install).
    const UPDATE_CHECK_URLS = [
      'https://raw.githubusercontent.com/tylermorrison00/sidedocks/main/version.json',
      'https://github.com/tylermorrison00/sidedocks/releases/download/mobile-v1.0.0/version.json'
      ];
  const APK_DOWNLOAD_URL = 'https://github.com/tylermorrison00/sidedocks/releases/download/mobile-v1.0.0/Side.Dock.apk';
  window.sideDock.doUpdate = async () => {
    try {
      let latest = null;
      if (window.SideDockAndroid && window.SideDockAndroid.fetchUrl) {
        try {
          const text = window.SideDockAndroid.fetchUrl(UPDATE_CHECK_URLS[1]);
          if (text) latest = JSON.parse(text);
        } catch {}
      }
      if (!latest) {
        for (const url of UPDATE_CHECK_URLS) {
          try {
            const res = await fetch(url + '?v=' + Date.now(), { cache: 'no-store' });
            if (res.ok) { latest = await res.json(); break; }
          } catch {}
        }
      }
      if (!latest) {
        return { ok: false, message: 'Update check failed. Download the latest APK from the website.' };
      }
      const current = (window.SideDockAndroid && window.SideDockAndroid.getVersionCode)
        ? window.SideDockAndroid.getVersionCode()
        : 0;
      if (latest.versionCode && current && latest.versionCode <= current) {
        return { ok: true, message: 'App already up to date.' };
      }
      if (window.SideDockAndroid && window.SideDockAndroid.downloadApk) {
        if (window.SideDockAndroid.canInstallPackages && !window.SideDockAndroid.canInstallPackages()) {
          window.SideDockAndroid.openInstallSettings();
          return { ok: false, message: 'Allow "Install unknown apps" for Side Dock, then tap Update again.' };
        }
        window.SideDockAndroid.downloadApk(APK_DOWNLOAD_URL);
        return { ok: true, message: 'Downloading latest APK... install it when asked.' };
      }
      window.open(APK_DOWNLOAD_URL, '_blank');
      return { ok: true, message: 'Latest APK opened in browser — install it when the download finishes.' };
    } catch (e) {
      return { ok: false, message: 'No internet / update check failed. Download the latest APK from the website.' };
    }
  };
})();
