// Supabase Cloud Sync Engine for Side Dock (Desktop & Mobile)
(function() {
  const SUPABASE_URL = 'https://pmyroxekhsummcbxbfxk.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_rGLl0RmoZH8jd-2OHFmlgw_Af8aAix9';

  let client = null;
  let currentUser = null;
  let syncInProgress = false;

  function getClient() {
    if (!client && window.supabase) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }
    return client;
  }

  const SyncEngine = {
    async init() {
      const sb = getClient();
      if (!sb) return;

      try {
        const { data: { session } } = await sb.auth.getSession();
        if (session && session.user) {
          currentUser = session.user;
          this.updateSyncUI();
          await this.pullFromCloud();
        }

        sb.auth.onAuthStateChange(async (event, session) => {
          currentUser = session ? session.user : null;
          this.updateSyncUI();
          if (event === 'SIGNED_IN' && currentUser) {
            await this.pullFromCloud();
          }
        });
      } catch (err) {
        console.warn('Sync init error:', err);
      }
    },

    getUser() {
      return currentUser;
    },

    async signInWithGoogle() {
      const sb = getClient();
      if (!sb) throw new Error('Supabase not loaded');
      const isMobileApp = window.location.protocol === 'file:' || !!window.SideDockAndroid;
      if (isMobileApp) {
        // Google blocks OAuth inside an embedded WebView (disallowed_useragent),
        // and file:// can never be a valid OAuth redirect (its origin is "null").
        // So: get the sign-in URL without redirecting, open it in the system
        // browser, and come back via the sidedock://auth-callback deep link
        // (registered in AndroidManifest.xml). The Supabase project must have
        // sidedock://auth-callback in Auth > URL Configuration > Redirect URLs.
        const { data, error } = await sb.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: 'sidedock://auth-callback',
            skipBrowserRedirect: true,
            queryParams: { access_type: 'offline', prompt: 'consent' }
          }
        });
        if (error) throw error;
        if (!data || !data.url) throw new Error('Google login did not return a sign-in URL');
        if (window.SideDockAndroid && window.SideDockAndroid.openExternal) {
          window.SideDockAndroid.openExternal(data.url);
        } else {
          window.open(data.url, '_blank');
        }
        return data;
      }
      

    // Called when the app is reopened via sidedock://auth-callback after
    // Google login in the system browser. Exchanges the returned code (PKCE)
    // or tokens for a session.
    const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'sidedock://auth-callback', skipBrowserRedirect: true, queryParams: { access_type: 'offline', prompt: 'consent' } } }); if (error) throw error; if (!data || !data.url) throw new Error('Google login did not return a sign-in URL'); if (window.sideDock && window.sideDock.openExternal) { await window.sideDock.openExternal(data.url); } else { window.open(data.url, '_blank'); } return data; }, async handleAuthCallback(url) {
      const sb = getClient();
      if (!sb || !url) return false;
      try {
        const hash = (url.split('#')[1] || '');
        const query = (url.split('?')[1] || '').split('#')[0];
        const params = new URLSearchParams(hash || query);
        const code = params.get('code');
        if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) throw error;
          return true;
        }
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          const { error } = await sb.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          return true;
        }
        return false;
      } catch (e) {
        console.warn('Auth callback failed:', e);
        return false;
      }
    },

    async signInWithEmail(email, password) {
      const sb = getClient();
      if (!sb) throw new Error('Supabase not loaded');
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      this.updateSyncUI();
      await this.pullFromCloud();
      return data;
    },

    async signUpWithEmail(email, password) {
      const sb = getClient();
      if (!sb) throw new Error('Supabase not loaded');
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user) {
        currentUser = data.user;
        this.updateSyncUI();
        await this.pushToCloud();
      }
      return data;
    },

    async signOut() {
      const sb = getClient();
      if (!sb) return;
      await sb.auth.signOut();
      currentUser = null;
      this.updateSyncUI();
    },

    // Pull cloud data into local storage / app
    async pullFromCloud() {
      if (!currentUser || syncInProgress) return;
      const sb = getClient();
      if (!sb) return;
      syncInProgress = true;
      this.setSyncingIcon(true);

      try {
        const userId = currentUser.id || currentUser.email;
        const { data, error } = await sb
          .from('sidedock_sync')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) {
          console.warn('Pull error:', error.message);
          return;
        }

        if (data && data.data) {
          const cloudData = data.data;
          
          // Merge / update local data
          if (window.sideDock) {
            // Desktop mode: update via IPC if available
            // Cloud data has: todos, notes, habits
            if (cloudData.todos) {
              const currentTodos = await window.sideDock.getTodos();
              // Cloud overrides or merges
              for (const t of cloudData.todos) {
                if (!currentTodos.some(x => x.id === t.id)) {
                  await window.sideDock.restoreTodo(t);
                }
              }
            }
            if (cloudData.notes) {
              const currentNotes = await window.sideDock.getNotes();
              for (const n of cloudData.notes) {
                if (!currentNotes.some(x => x.id === n.id)) {
                  await window.sideDock.restoreNote(n);
                }
              }
            }
            if (cloudData.habits) {
              const currentHabits = await window.sideDock.getHabits();
              for (const h of cloudData.habits) {
                if (!currentHabits.some(x => x.id === h.id)) {
                  await window.sideDock.restoreHabit(h);
                }
              }
            }
          } else {
            // Mobile mode: localStorage
            if (cloudData.todos) localStorage.setItem('sidedock_todos', JSON.stringify(cloudData.todos));
            if (cloudData.notes) localStorage.setItem('sidedock_notes', JSON.stringify(cloudData.notes));
            if (cloudData.habits) localStorage.setItem('sidedock_habits', JSON.stringify(cloudData.habits));
          }

          if (window.onSyncCompleted) {
            window.onSyncCompleted();
          }
        } else {
          // No cloud data yet, push local to cloud
          await this.pushToCloud();
        }
      } catch (e) {
        console.error('Sync pull exception:', e);
      } finally {
        syncInProgress = false;
        this.setSyncingIcon(false);
      }
    },

    // Push local data to cloud
    async pushToCloud() {
      if (!currentUser || syncInProgress) return;
      const sb = getClient();
      if (!sb) return;
      syncInProgress = true;
      this.setSyncingIcon(true);

      try {
        let todos = [];
        let notes = [];
        let habits = [];

        if (window.sideDock) {
          todos = await window.sideDock.getTodos();
          notes = await window.sideDock.getNotes();
          habits = await window.sideDock.getHabits();
        } else {
          try { todos = JSON.parse(localStorage.getItem('sidedock_todos') || '[]'); } catch {}
          try { notes = JSON.parse(localStorage.getItem('sidedock_notes') || '[]'); } catch {}
          try { habits = JSON.parse(localStorage.getItem('sidedock_habits') || '[]'); } catch {}
        }

        const userId = currentUser.id || currentUser.email;
        const payload = {
          user_id: userId,
          data: { todos, notes, habits, updatedAt: Date.now() },
          updated_at: new Date().toISOString()
        };

        const { error } = await sb
          .from('sidedock_sync')
          .upsert(payload, { onConflict: 'user_id' });

        if (error) {
          console.warn('Push error:', error.message);
        }
      } catch (e) {
        console.error('Sync push exception:', e);
      } finally {
        syncInProgress = false;
        this.setSyncingIcon(false);
      }
    },

    setSyncingIcon(isSyncing) {
      const syncBtn = document.getElementById('syncIndicatorBtn');
      if (syncBtn) {
        if (isSyncing) {
          syncBtn.classList.add('syncing');
          syncBtn.title = 'Syncing...';
        } else {
          syncBtn.classList.remove('syncing');
          syncBtn.title = currentUser ? 'Synced (' + (currentUser.email || 'Logged In') + ')' : 'Click to Login & Sync';
        }
      }
    },

    updateSyncUI() {
      const syncBtn = document.getElementById('syncIndicatorBtn');
      const accountEmail = document.getElementById('accountUserEmail');
      const loginSection = document.getElementById('syncLoginSection');
      const loggedInSection = document.getElementById('syncLoggedInSection');

      if (syncBtn) {
        if (currentUser) {
          syncBtn.style.color = 'var(--accent, #00d4ff)';
          syncBtn.classList.add('authenticated');
        } else {
          syncBtn.style.color = 'var(--muted, #8a9bb8)';
          syncBtn.classList.remove('authenticated');
        }
      }

      if (accountEmail) {
        accountEmail.textContent = currentUser ? (currentUser.email || 'Google User') : 'Not logged in';
      }
      if (loginSection && loggedInSection) {
        if (currentUser) {
          loginSection.style.display = 'none';
          loggedInSection.style.display = 'flex';
        } else {
          loginSection.style.display = 'flex';
          loggedInSection.style.display = 'none';
        }
      }
    }
  };

  window.SyncEngine = SyncEngine;

  // Deep-link return from the system-browser Google login (MainActivity
  // dispatches a 'sidedock-auth' event with the callback URL).
  window.addEventListener('sidedock-auth', (e) => {
    SyncEngine.handleAuthCallback(e.detail);
  });
  if (window.sideDock && window.sideDock.onAuthCallback) { window.sideDock.onAuthCallback((url) => SyncEngine.handleAuthCallback(url)); } window.__sidedockAuthCallback = (url) => SyncEngine.handleAuthCallback(url);

  // Auto-init on page load
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      SyncEngine.init();
    }, 500);
  });
})();
