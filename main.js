const { app, BrowserWindow, ipcMain, shell, screen, safeStorage, clipboard } = require('electron');
const { execFile } = require('child_process');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

// One-click update: sidebar ke Update button se. Kaam is tarah:
// 1) repo ki package.json se naya version check karo
// 2) naya ho to repo ka main zip download karo, extract karo, app folder me copy karo
// 3) npm install dobara chalao (agar nayi library aayi ho to wo bhi aa jaye)
// 4) app restart karo. Zip download ya install dobara user ko nahi karna.
// Private repo update ka tareeqa: GitHub token (login ka hi ek tareeqa).
// Token sirf user ke laptop par, Windows ke apne encryption (DPAPI) se save
// hota hai — repo me NAHI jata, Muse ko NAHI bheja jata, sirf GitHub API ko
// update download karte waqt bheja jata hai. Token read-only rakho, sirf
// side-dock repo ke liye, taake leak hone par bhi sirf ye repo parha ja sake.
// Token na ho aur repo private ho to Update button seedha yehi batayega.
const UPDATE_RAW = 'https://raw.githubusercontent.com/tylermorrison00/side-dock/main/package.json';
const UPDATE_ZIP_API = 'https://api.github.com/repos/tylermorrison00/side-dock/zipball/main';
let tokenPath = '';

function isGithubHost(hostname) {
  return hostname === 'github.com' || hostname === 'api.github.com' ||
    hostname.endsWith('.github.com') || hostname.endsWith('.githubusercontent.com');
}
function authHeaders(url, token) {
  const headers = { 'User-Agent': 'SideDock-Updater', 'Accept': 'application/vnd.github+json' };
  try { if (token && isGithubHost(new URL(url).hostname)) headers.Authorization = 'Bearer ' + token; } catch {}
  return headers;
}
function loadToken() {
  try {
    const raw = fs.readFileSync(tokenPath, 'utf8').trim();
    if (!raw) return '';
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(raw, 'base64'));
    return raw;
  } catch { return ''; }
}
function saveToken(token) {
  const value = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token).toString('base64') : token;
  fs.writeFileSync(tokenPath, value, { mode: 0o600 });
}
function fetchText(url, token, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: authHeaders(url, token) }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        fetchText(res.headers.location, token, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
function downloadFile(url, dest, token, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: authHeaders(url, token) }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        downloadFile(res.headers.location, dest, token, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}
function runCmd(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, windowsHide: true, timeout: 600000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message)); else resolve(stdout);
    });
  });
}

let win = null;
let mode = 'collapsed'; // Always collapsed rail now; expanded panel is separate, see panelOpen
let panelOpen = false; // expanded panel beside rail, closed by default
let autoStart = true; // laptop on hote hi Side Dock khud khul jaye
let theme = 'dark'; // 'dark' = dark navy, 'light' = light beige
let hidden = false; // auto-hide: true = sirf arrow dikhta hai, sidebar side se bahar hai
let autoHide = true; // default ON: kaam karte waqt sidebar chhup jayegi, sirf arrow dikhega
let slideTimer = null; // legacy, unused in single-window version
let settingsPath = '';
let toolsPath = '';

function windowSize() {
  return mode === 'collapsed' ? { width: 76, height: 0 } : { width: 220, height: 0 };
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const data = JSON.parse(raw);
    mode = 'collapsed';
    if (typeof data.autoStart === 'boolean') autoStart = data.autoStart;
    if (data.theme === 'light' || data.theme === 'dark') theme = data.theme;
    if (typeof data.autoHide === 'boolean') autoHide = data.autoHide;
  } catch {}
}

function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify({ mode, autoStart, theme, autoHide }, null, 2)); } catch {}
}

function loadTools() {
  let defaults = [];
  try { defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools.json'), 'utf8')); } catch {}
  try {
    const existing = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
    // Naye built-in tools (jaise To Do List) purane users ko bhi mil jayen, unke tools delete kiye baghair.
    let changed = false;
    for (const d of defaults) {
      const ex = existing.find(x => x.id === d.id);
      if (!ex) { existing.push(d); changed = true; }
      else if (ex.icon !== d.icon || ex.name !== d.name || ex.logo !== d.logo || ex.logoLight !== d.logoLight || ex.iconOutline !== d.iconOutline || ex.iconAccent !== d.iconAccent) { ex.icon = d.icon; ex.name = d.name; ex.logo = d.logo; ex.logoLight = d.logoLight; ex.iconOutline = d.iconOutline; ex.iconAccent = d.iconAccent; changed = true; }
    }
    if (changed) { try { fs.writeFileSync(toolsPath, JSON.stringify(existing, null, 2)); } catch {} }
    return existing;
  } catch {}
  try { fs.writeFileSync(toolsPath, JSON.stringify(defaults, null, 2)); } catch {}
  return defaults;
}

function saveTools(tools) {
  fs.writeFileSync(toolsPath, JSON.stringify(tools, null, 2));
}


let todoWin = null;
let todosPath = '';
let notesPath = '';
function loadNotes() {
  try { return JSON.parse(fs.readFileSync(notesPath, 'utf8')); } catch { return []; }
}
function saveNotes(notes) {
  try { fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2)); } catch {}
}
function loadTodos() {
  try { return JSON.parse(fs.readFileSync(todosPath, 'utf8')); } catch { return []; }
}
function saveTodos(todos) {
  try { fs.writeFileSync(todosPath, JSON.stringify(todos, null, 2)); } catch {}
}
function openTodoWindow() {
  if (todoWin && !todoWin.isDestroyed()) { todoWin.focus(); return; }
  todoWin = new BrowserWindow({
    width: 400, height: 600,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'To Do List',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-todo.js'), contextIsolation: true, nodeIntegration: false }
  });
  todoWin.loadFile(path.join(__dirname, 'renderer', 'todo.html'));
  todoWin.on('closed', () => { todoWin = null; });
}
function startupShortcutPath() {
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Side Dock.lnk');
}
async function applyAutostart() {
  // Unpackaged app ka setLoginItemSettings sirf electron.exe kholta hai,
  // is liye wo default Electron window dikhata hai, sidebar nahi.
  // Is liye auto-start Startup folder ki shortcut se hota hai jo
  // launch.vbs chalati hai, aur wo npm start chhup kar chalata hai.
  if (process.platform !== 'win32') return;
  try { app.setLoginItemSettings({ openAtLogin: false }); } catch {}
  const lnk = startupShortcutPath();
  const vbs = path.join(__dirname, 'launch.vbs');
  if (!autoStart) { try { fs.unlinkSync(lnk); } catch {} return; }
  if (!fs.existsSync(vbs)) return;
  try {
    const ps1 = path.join(os.tmpdir(), 'sidedock-startup.ps1');
    const ps = `$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('${lnk.replace(/'/g, "''")}'); $Shortcut.TargetPath = '${vbs.replace(/'/g, "''")}'; $Shortcut.WorkingDirectory = '${__dirname.replace(/'/g, "''")}'; $Shortcut.IconLocation = '${path.join(__dirname, 'build', 'icon.ico').replace(/'/g, "''")}'; $Shortcut.Save()`;
    fs.writeFileSync(ps1, ps);
    await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, __dirname);
  } catch {}
}

function cardSize() {
  // Rail hamesha right edge par: panel closed = 220 wide window (56 rail + transparent left, click-through),
  // panel open = 284 wide window (220 expanded panel + 8 gap + 56 rail), right edge hamesha fixed.
  const area = screen.getPrimaryDisplay().workArea;
  const width = panelOpen ? 372 : 220;
  return { width, height: Math.max(400, area.height - 16), x: area.x + area.width - width - 4, y: area.y + 8 };
}
function updateBackgroundMaterial() {
  // Glassmorphism khatam: koi blur, koi acrylic nahi, sirf Light aur Dark.
  try { if (win && !win.isDestroyed() && win.setBackgroundMaterial) win.setBackgroundMaterial('none'); } catch {}
}
function dockWindow() {
  if (!win) return;
  const s = cardSize();
  win.setBounds({ x: s.x, y: s.y, width: s.width, height: s.height }, true);
}
let launchAt = Date.now();
let hideTimeout = null;
function slideToHidden(next) {
  if (!win) return;
  hidden = !!next;
  const area = screen.getPrimaryDisplay().workArea;
  const s = cardSize();
  if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  if (hidden) {
    try { win.webContents.send('auto-hide-hide'); } catch {}
    // Window slide, NOT resize: x ko full se right-edge tak le jao, size hamesha 220x1064 rahega, kabhi chota nahi hoga.
    const startX = win.getBounds().x;
    const targetX = area.x + area.width - 28;
    const steps = 12;
    let i = 0;
    hideTimeout = setInterval(() => {
      i++;
      try {
        const x = Math.round(startX + (targetX - startX) * (i / steps));
        win.setBounds({ x, y: s.y, width: s.width, height: s.height }, false);
        if (i >= steps) { clearInterval(hideTimeout); hideTimeout = null; try { win.setIgnoreMouseEvents(true, { forward: true }); } catch {} try { win.webContents.send('auto-hide-arrow-only'); } catch {} }
      } catch { clearInterval(hideTimeout); hideTimeout = null; }
    }, 25);
  } else {
    // Show: window ko wapas full position par slide karo, size kabhi change nahi.
    try { win.webContents.send('auto-hide-show'); } catch {}
    const startX = win.getBounds().x;
    const targetX = s.x;
    const steps = 12;
    let i = 0;
    hideTimeout = setInterval(() => {
      i++;
      try {
        const x = Math.round(startX + (targetX - startX) * (i / steps));
        win.setBounds({ x, y: s.y, width: s.width, height: s.height }, false);
        if (i >= steps) { clearInterval(hideTimeout); hideTimeout = null; }
      } catch { clearInterval(hideTimeout); hideTimeout = null; }
    }, 25);
    try { win.setIgnoreMouseEvents(false, { forward: true }); updateBackgroundMaterial(); } catch {}
  }
}
let mousePollTimer = null;
let outsideCount = 0;
function startMousePoll() {
  if (mousePollTimer) return;
  mousePollTimer = setInterval(() => {
    try {
      if (!win || win.isDestroyed()) return;
      if (!autoHide || hidden || panelOpen) { outsideCount = 0; return; }
      // Launch grace: pehle 10s me auto-hide mat karo, taake Settings -> Update tak pahunch sake.
      if (Date.now() - launchAt < 10000) return;
      const pt = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const inside = pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
      if (!inside) {
        outsideCount++;
        if (outsideCount >= 2) { outsideCount = 0; slideToHidden(true); }
      } else outsideCount = 0;
    } catch {}
  }, 500);
}
function createWindow() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  toolsPath = path.join(app.getPath('userData'), 'tools.json');
  todosPath = path.join(app.getPath('userData'), 'todos.json');
  notesPath = path.join(app.getPath('userData'), 'notes.json');
  tokenPath = path.join(app.getPath('userData'), 'github-token.enc');
  loadSettings();
  const s = cardSize();

  // Windows login par auto-start: Startup shortcut se, electron.exe seedha nahi.
  applyAutostart();
  win = new BrowserWindow({
    width: s.width,
    height: s.height,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    x: s.x,
    y: s.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => { updateBackgroundMaterial(); });
  win.on('closed', () => { win = null; });
  launchAt = Date.now();
  startMousePoll();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { try { win.show(); win.focus(); } catch {} }
    else { try { createWindow(); } catch {} }
  });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });

ipcMain.handle('get-state', () => ({ mode, autoStart, theme, autoHide, hidden, panelOpen, hasToken: !!loadToken(), tools: loadTools() }));
ipcMain.handle('set-hidden', (_e, next) => {
  if (!autoHide) { hidden = false; return hidden; }
  slideToHidden(next);
  return hidden;
});
ipcMain.handle('set-autohide', (_e, next) => {
  autoHide = !!next;
  saveSettings();
  if (!autoHide) slideToHidden(false);
  return autoHide;
});
ipcMain.handle('show-from-arrow', () => { slideToHidden(false); return hidden; });
ipcMain.handle('set-theme', (_e, next) => {
  theme = next === 'light' ? 'light' : 'dark';
  saveSettings();
  updateBackgroundMaterial();
  return theme;
});
ipcMain.handle('set-github-token', (_e, token) => {
  const value = String(token || '').trim();
  if (!value) return false;
  saveToken(value);
  return true;
});
ipcMain.handle('clear-github-token', () => {
  try { fs.unlinkSync(tokenPath); } catch {}
  return true;
});
ipcMain.handle('set-autostart', async (_e, next) => {
  autoStart = !!next;
  saveSettings();
  await applyAutostart();
  return autoStart;
});
ipcMain.handle('set-mode', (_e, next) => {
  mode = 'collapsed';
  saveSettings();
  return mode;
});
ipcMain.handle('set-panel', (_e, next) => {
  panelOpen = !!next;
  try { if (win && !win.isDestroyed()) { const s = cardSize(); win.setBounds({ x: s.x, y: s.y, width: s.width, height: s.height }, true); } } catch {}
  return panelOpen;
});
ipcMain.handle('set-mouse-events', (_e, ignore) => {
  try { if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true }); } catch {}
  return true;
});
ipcMain.handle('add-tool', (_e, tool) => {
  const tools = loadTools();
  tools.push({ id: Date.now().toString(), name: String(tool.name || 'Tool').slice(0, 40), icon: String(tool.icon || '◆').slice(0, 4), target: String(tool.target || ''), kind: tool.kind === 'app' ? 'app' : 'url' });
  saveTools(tools);
  return tools;
});
ipcMain.handle('remove-tool', (_e, id) => {
  const tools = loadTools().filter(t => t.id !== id);
  saveTools(tools);
  return tools;
});

function habitsPath() { return path.join(app.getPath('userData'), 'habits.json'); }
function loadHabits() { try { return JSON.parse(fs.readFileSync(habitsPath(), 'utf8')); } catch { return []; } }
function saveHabits(h) { try { fs.writeFileSync(habitsPath(), JSON.stringify(h, null, 2)); } catch {} }
function todayPKT() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { const x = new Date(); return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0'); } }
ipcMain.handle('get-todos', () => loadTodos());
ipcMain.handle('add-todo', (_e, text) => {
  const todos = loadTodos();
  const item = { id: Date.now().toString(), text: String(text || '').slice(0, 200), done: false };
  if (!item.text.trim()) return todos;
  todos.push(item); saveTodos(todos); return todos;
});
ipcMain.handle('toggle-todo', (_e, id) => {
  const todos = loadTodos().map(x => x.id === id ? { ...x, done: !x.done } : x);
  saveTodos(todos); return todos;
});
ipcMain.handle('delete-todo', (_e, id) => {
  const todos = loadTodos().filter(x => x.id !== id);
  saveTodos(todos); return todos;
});
ipcMain.handle('edit-todo', (_e, id, text) => {
  const todos = loadTodos().map(x => x.id === id ? { ...x, text: String(text || '').slice(0, 200) } : x);
  saveTodos(todos); return todos;
});
ipcMain.handle('get-notes', () => loadNotes());
ipcMain.handle('add-note', (_e, data) => {
  const notes = loadNotes();
  const title = typeof data === 'object' ? String(data.title || '').slice(0, 200) : '';
  const text = typeof data === 'object' ? String(data.text || '').slice(0, 5000) : String(data || '').slice(0, 5000);
  if (!text.trim()) return notes;
  const item = { id: Date.now().toString(), title: title.trim() || text.split('\n')[0].slice(0, 60), text };
  notes.unshift(item); saveNotes(notes); return notes;
});
ipcMain.handle('copy-note', (_e, text) => { try { clipboard.writeText(String(text || '')); } catch {} return true; });
ipcMain.handle('restore-note', (_e, item) => { const notes = loadNotes(); if (!item || notes.some(x => x.id === item.id)) return notes; notes.unshift({ id: String(item.id), title: String(item.title || '').slice(0,200), text: String(item.text || '').slice(0,5000) }); saveNotes(notes); return notes; });
ipcMain.handle('restore-todo', (_e, item) => { const todos = loadTodos(); if (!item || todos.some(x => x.id === item.id)) return todos; todos.push({ id: String(item.id), text: String(item.text || '').slice(0,200), done: !!item.done }); saveTodos(todos); return todos; });
ipcMain.handle('delete-note', (_e, id) => {
  const notes = loadNotes().filter(x => x.id !== id);
  saveNotes(notes); return notes;
});
ipcMain.handle('edit-note', (_e, id, data) => {
  const notes = loadNotes().map(x => {
    if (x.id !== id) return x;
    if (typeof data === 'object') return { ...x, title: String(data.title || x.title || '').slice(0, 200), text: String(data.text || '').slice(0, 5000) };
    return { ...x, text: String(data || '').slice(0, 5000) };
  });
  saveNotes(notes); return notes;
});
ipcMain.handle('get-habits', () => loadHabits());
ipcMain.handle('add-habit', (_e, name) => { const h = loadHabits(); const nm = String(name || '').trim().slice(0,200); if (!nm) return h; h.push({ id: Date.now().toString(), name: nm, days: {} }); saveHabits(h); return h; });
ipcMain.handle('delete-habit', (_e, id) => { const h = loadHabits().filter(x => x.id !== id); saveHabits(h); return h; });
ipcMain.handle('toggle-habit', (_e, id) => { const h = loadHabits().map(x => { if (x.id !== id) return x; const days = { ...(x.days || {}) }; const today = todayPKT(); if (days[today]) delete days[today]; else days[today] = true; return { ...x, days }; }); saveHabits(h); return h; });
ipcMain.handle('edit-habit', (_e, id, name) => { const h = loadHabits().map(x => x.id === id ? { ...x, name: String(name || '').trim().slice(0,200) || x.name } : x); saveHabits(h); return h; });
ipcMain.handle('restore-habit', (_e, item) => { const h = loadHabits(); if (!item || h.some(x => x.id === item.id)) return h; h.push({ id: String(item.id), name: String(item.name || ''), days: item.days || {} }); saveHabits(h); return h; });

let brightnessProc = null;
let extraDimWin = null;
let extraDimLevel = 0;
function extraDimPath() { return path.join(app.getPath('userData'), 'extra-dim.json'); }
function loadExtraDim() { try { const v = JSON.parse(fs.readFileSync(extraDimPath(), 'utf8')); return Math.max(0, Math.min(80, parseInt(v.level, 10) || 0)); } catch { return 0; } }
function saveExtraDim(lvl) { try { fs.writeFileSync(extraDimPath(), JSON.stringify({ level: lvl })); } catch {} }
function applyExtraDim(lvl) {
  extraDimLevel = Math.max(0, Math.min(80, parseInt(lvl, 10) || 0));
  saveExtraDim(extraDimLevel);
  if (extraDimLevel <= 0) { try { if (extraDimWin) extraDimWin.close(); } catch {} extraDimWin = null; return; }
  if (!extraDimWin) {
    extraDimWin = new BrowserWindow({ fullscreen: true, frame: false, transparent: false, backgroundColor: '#000000', alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, minimizable: false, maximizable: false, closable: true, show: false });
    try { extraDimWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}
    try { extraDimWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    extraDimWin.on('closed', () => { extraDimWin = null; });
  }
  try { extraDimWin.setOpacity(extraDimLevel / 100); } catch {}
  try { if (!extraDimWin.isVisible()) extraDimWin.showInactive(); } catch {}
}

let warmLevel = 0;
function warmPath() { return path.join(app.getPath('userData'), 'warm.json'); }
function loadWarm() { try { const v = JSON.parse(fs.readFileSync(warmPath(), 'utf8')); return Math.max(0, Math.min(100, parseInt(v.level, 10) || 0)); } catch { return 0; } }
function saveWarm(lvl) { try { fs.writeFileSync(warmPath(), JSON.stringify({ level: lvl })); } catch {} }
let warmProc = null;
let warmPending = null;
function applyWarm(lvl) {
  warmLevel = Math.max(0, Math.min(100, parseInt(lvl, 10) || 0));
  saveWarm(warmLevel);
  if (warmProc) { warmPending = warmLevel; return; }
  const runWarm = (level) => {
    // Path has a space (Side Dock folder) - -File without quotes fails silently, so copy to Temp (no spaces) and quote it
    const src = path.join(__dirname, 'warm.ps1');
    const tmpScript = path.join(os.tmpdir(), 'sidedock-warm.ps1');
    try { fs.copyFileSync(src, tmpScript); } catch {}
    const cmd = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmpScript + '" -WarmPercent ' + String(level);
    warmProc = exec(cmd, () => { warmProc = null; if (warmPending !== null && warmPending !== level) { const next = warmPending; warmPending = null; runWarm(next); } else { warmPending = null; } });
  };
  runWarm(warmLevel);
}
ipcMain.handle('get-nightlight', async () => { return new Promise((resolve) => { const src = path.join(__dirname, 'nightlight-state.ps1'); const tmpScript = path.join(os.tmpdir(), 'sidedock-nightlight-state.ps1'); try { fs.copyFileSync(src, tmpScript); } catch {} exec('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmpScript + '"', (_e, stdout) => { const s = String(stdout || '').trim(); resolve({ ok: true, on: s === 'ON' }); }); }); });
ipcMain.handle('toggle-nightlight', async () => { return new Promise((resolve) => { const src = path.join(__dirname, 'nightlight-silent.ps1'); const tmpScript = path.join(os.tmpdir(), 'sidedock-nightlight.ps1'); try { fs.copyFileSync(src, tmpScript); } catch {} exec('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmpScript + '"', (_e, stdout) => { resolve({ ok: String(stdout || '').trim() === 'OK', raw: String(stdout || '').trim() }); }); }); });
ipcMain.handle('get-nightlight-strength', async () => { return new Promise((resolve) => { const src = path.join(__dirname, 'nightlight-strength.ps1'); const tmpScript = path.join(os.tmpdir(), 'sidedock-nightlight-strength.ps1'); try { fs.copyFileSync(src, tmpScript); } catch {} exec('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmpScript + '" -Action get', (_e, stdout) => { const n = parseInt(String(stdout || '').trim(), 10); resolve({ ok: !isNaN(n), level: isNaN(n) ? 50 : n }); }); }); });
ipcMain.handle('set-nightlight-strength', async (_e, lvl) => { return new Promise((resolve) => { const src = path.join(__dirname, 'nightlight-strength.ps1'); const tmpScript = path.join(os.tmpdir(), 'sidedock-nightlight-strength.ps1'); try { fs.copyFileSync(src, tmpScript); } catch {} exec('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmpScript + '" -Action set -Percent ' + String(Math.max(0, Math.min(100, parseInt(lvl, 10) || 0))), () => { resolve({ ok: true }); }); }); });
ipcMain.handle('get-warm', () => ({ level: loadWarm() }));
ipcMain.handle('set-warm', (_e, lvl) => { applyWarm(lvl); return { level: warmLevel }; });
ipcMain.handle('get-extra-dim', () => ({ level: loadExtraDim() }));
ipcMain.handle('set-extra-dim', (_e, lvl) => { applyExtraDim(lvl); return { level: extraDimLevel }; });
ipcMain.handle('get-brightness', async () => {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"], (err, stdout) => {
      const n = parseInt(String(stdout || '').trim(), 10);
      resolve({ ok: !isNaN(n), level: isNaN(n) ? null : n });
    });
  });
});
ipcMain.handle('set-brightness', async (_e, level) => {
  const lvl = Math.max(0, Math.min(100, parseInt(level, 10) || 0));
  try { if (brightnessProc) brightnessProc.kill(); } catch {}
  return new Promise((resolve) => {
    brightnessProc = execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${lvl})`], (err) => { brightnessProc = null; resolve({ ok: !err, level: lvl }); });
  });
});
ipcMain.handle('launch-tool', (_e, tool) => {
  if (!tool || !tool.target) return;
  if (tool.target === 'todo' || tool.id === 'todo-list') { openTodoWindow(); return; }
  if (tool.kind === 'url') { shell.openExternal(tool.target); return; }
  // App: a file path opens directly, anything else runs as a local command.
  if (fs.existsSync(tool.target)) { shell.openPath(tool.target); return; }
  exec(tool.target, (err) => { if (err) console.error(err.message); });
});
ipcMain.handle('window-min', () => win && win.minimize());
ipcMain.handle('window-close', () => win && win.close());
ipcMain.handle('do-update', async () => {
  if (process.platform !== 'win32') return { ok: false, message: 'Update is only available on the Windows version.' };
  try {
    let localVersion = '';
    try { localVersion = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || ''; } catch {}
    const token = loadToken();
    // Raw file 5 minute tak purana version dikhata hai, is liye version
    // check GitHub API se karo, wo foran naya version deta hai.
    let remote;
    try {
      const api = JSON.parse(await fetchText('https://api.github.com/repos/tylermorrison00/side-dock/contents/package.json', token));
      remote = JSON.parse(Buffer.from(String(api.content || '').replace(/\n/g, ''), 'base64').toString('utf8'));
    } catch {
      remote = JSON.parse(await fetchText(UPDATE_RAW + '?t=' + Date.now(), token));
    }
    // Version hamesha 1.0.0 rehti hai (user order) — is liye version
    // check par update rokna nahi hai. Update button dabate hi hamesha
    // naya zip download karke apply karo, chahe version same hi kyun na ho.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidedock-update-'));
    const zipPath = path.join(tmpDir, 'update.zip');
    const extractDir = path.join(tmpDir, 'extracted');
    await downloadFile(UPDATE_ZIP_API, zipPath, token);
    await runCmd(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${extractDir}'"`, tmpDir);
    // Zipball ka folder naam owner-repo-sha hota hai, side-dock-main nahi.
    // Is liye pehla folder dhoondo jis me package.json ho.
    let srcDir = '';
    for (const entry of fs.readdirSync(extractDir)) {
      const cand = path.join(extractDir, entry);
      try { if (fs.statSync(cand).isDirectory() && fs.existsSync(path.join(cand, 'package.json'))) { srcDir = cand; break; } } catch {}
    }
    if (!srcDir) throw new Error('Update zip me app files nahi mili.');
    // node_modules, .git aur dist ko chhero mat — baqi sab nayi files se replace karo.
    for (const entry of fs.readdirSync(srcDir)) {
      if (['node_modules', '.git', 'dist'].includes(entry)) continue;
      fs.cpSync(path.join(srcDir, entry), path.join(__dirname, entry), { recursive: true, force: true });
    }
    try { await runCmd('npm install --no-audit --no-fund', __dirname); } catch (e) { console.error('npm install after update:', e.message); }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    const newVersion = remote.version || '';
    setTimeout(() => { app.relaunch(); app.quit(); }, 500);
    return { ok: true, updated: true, version: newVersion, message: 'Update done, app is restarting.' };
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('401') || msg.includes('403') || msg.includes('404')) {
      return { ok: false, message: 'Cannot reach the repo, please try Update again later.' };
    }
    return { ok: false, message: 'Update failed: ' + msg };
  }
});

app.whenReady().then(() => { setTimeout(() => { try { const lvl = loadExtraDim(); if (lvl > 0) applyExtraDim(lvl); const wl = loadWarm(); if (wl > 0) applyWarm(wl); } catch {} }, 1000); });
