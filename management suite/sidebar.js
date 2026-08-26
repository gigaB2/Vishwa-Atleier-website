(function () {
  // 1. Get rootPath from script tag src attribute to handle subdirectories
  const scriptTag = document.querySelector('script[src$="sidebar.js"]');
  const src = scriptTag ? scriptTag.getAttribute('src') : 'sidebar.js';
  const rootPath = src.substring(0, src.length - 'sidebar.js'.length);

  // Route Guard: Prevent direct URL access without active session when require_login is active
  (function enforceAuthGuard() {
    const rawPath = window.location.pathname.toLowerCase();
    const pageName = rawPath.split('/').pop().toLowerCase();
    if (!pageName || pageName === 'index.html') return;

    let config = { access_mode: 'require_login' };
    try {
      const cfgRaw = localStorage.getItem('vf_auth_config');
      if (cfgRaw) config = Object.assign(config, JSON.parse(cfgRaw));
    } catch (e) { }

    let session = null;
    try {
      const sessRaw = localStorage.getItem('vf_session');
      if (sessRaw) session = JSON.parse(sessRaw);
    } catch (e) { }

    if (config.access_mode === 'require_login') {
      if (!session) {
        try { document.documentElement.style.display = 'none'; } catch (e) { }
        try { localStorage.removeItem('vf_session'); } catch (e) { }
        const loginUrl = rootPath ? (rootPath + 'index.html') : 'index.html';
        window.location.replace(loginUrl);
        return;
      }
    }

    // Strict Admin Guard for Settings page
    if (pageName === 'settings.html' || pageName === 'settings' || rawPath.endsWith('/settings')) {
      if (!session || session.role !== 'admin') {
        try { document.documentElement.style.display = 'none'; } catch (e) { }
        const loginUrl = rootPath ? (rootPath + 'index.html') : 'index.html';
        window.location.replace(loginUrl);
      }
    }
  })();

  // Global Error Interceptor & Telemetry Boundary (Protects against unhandled script crashes)
  window.addEventListener('error', function(event) {
    try {
      console.warn('[Vishwa Suite Error Boundary Captured]:', event.message, event.filename, event.lineno);
      if (window.VishwaSupabase && typeof window.VishwaSupabase.logAuditTrail === 'function') {
        window.VishwaSupabase.logAuditTrail('error', 'client_exception', event.lineno, {
          message: event.message,
          source: event.filename,
          line: event.lineno,
          col: event.colno
        });
      }
    } catch(e) {}
  });

  window.addEventListener('unhandledrejection', function(event) {
    try {
      console.warn('[Vishwa Suite Unhandled Promise]:', event.reason);
      if (window.VishwaSupabase && typeof window.VishwaSupabase.logAuditTrail === 'function') {
        window.VishwaSupabase.logAuditTrail('error', 'unhandled_promise', null, {
          reason: String(event.reason || 'Unknown error')
        });
      }
    } catch(e) {}
  });

  // Background Token Refresh Scheduler (every 5 minutes)
  setInterval(function() {
    try {
      const sessRaw = localStorage.getItem('vf_session');
      if (sessRaw && window.VishwaSupabase && typeof window.VishwaSupabase.refreshToken === 'function') {
        const sess = JSON.parse(sessRaw);
        if (sess && sess.expires_at) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (sess.expires_at - nowSec < 600) { // Less than 10 minutes left
            window.VishwaSupabase.refreshToken();
          }
        }
      }
    } catch(e) {}
  }, 300000);

  // Auto-inject Config & Supabase adapter if not present
  if (!window.APP_CONFIG) {
    const cfgScript = document.createElement('script');
    cfgScript.src = rootPath + 'assets/config.js';
    document.head.appendChild(cfgScript);
  }

  if (!window.VishwaSupabase) {
    const sbScript = document.createElement('script');
    sbScript.src = rootPath + 'assets/supabase-client.js';
    document.head.appendChild(sbScript);
  }

  // Initialization
  if (window.VishwaSupabase && typeof window.VishwaSupabase.loadAll === 'function') {
    window.VishwaSupabase.loadAll();
  }

  // --- Global Permission Helpers ---
  window.vfHasAccess = function (permKey) {
    const sessRaw = localStorage.getItem('vf_session');
    if (!sessRaw) return true;
    try {
      const sess = JSON.parse(sessRaw);
      if (!sess || sess.role === 'admin') return true;
      const perms = sess.permissions || {};
      const val = perms[permKey];
      return val === 'edit' || val === 'full' || val === 'view';
    } catch (e) { return true; }
  };

  window.vfCanEdit = function (permKey) {
    const sessRaw = localStorage.getItem('vf_session');
    if (!sessRaw) return true;
    try {
      const sess = JSON.parse(sessRaw);
      if (!sess || sess.role === 'admin') return true;
      const perms = sess.permissions || {};
      const val = perms[permKey];
      return val === 'edit' || val === 'full';
    } catch (e) { return true; }
  };

  window.vfIsViewOnly = function (permKey) {
    const sessRaw = localStorage.getItem('vf_session');
    if (!sessRaw) return false;
    try {
      const sess = JSON.parse(sessRaw);
      if (!sess || sess.role === 'admin') return false;
      const perms = sess.permissions || {};
      const val = perms[permKey];
      return val === 'view';
    } catch (e) { return false; }
  };

  // --- Per-User Theme Management ---
  window._vfGetUserThemeKey = function () {
    let userKey = 'default';
    try {
      const sessRaw = localStorage.getItem('vf_session');
      if (sessRaw) {
        const sess = JSON.parse(sessRaw);
        if (sess && (sess.username || sess.name || sess.id)) {
          userKey = (sess.username || sess.name || sess.id).toString().toLowerCase().trim();
        }
      }
      if (userKey === 'default') {
        const savedUser = localStorage.getItem('vf_user_name');
        if (savedUser) userKey = savedUser.toString().toLowerCase().trim();
      }
    } catch (e) { }
    return 'vishwa_fashions_theme_' + userKey;
  };

  window._vfGetTheme = function () {
    const userThemeKey = window._vfGetUserThemeKey();
    const val = localStorage.getItem(userThemeKey);
    if (val !== null) return val === 'true';
    const legacyVal = localStorage.getItem('vishwa_fashions_theme');
    if (legacyVal !== null) return legacyVal === 'true';
    return true; // Default dark
  };

  window._vfSetTheme = function (isDark) {
    const userThemeKey = window._vfGetUserThemeKey();
    localStorage.setItem(userThemeKey, isDark ? 'true' : 'false');
    localStorage.setItem('vishwa_fashions_theme', isDark ? 'true' : 'false');
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
      document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      document.body.classList.remove('dark-mode');
    }
    window.dispatchEvent(new CustomEvent('themeChanged', { detail: { isDark } }));
  };

  // Immediate theme application on script load
  (function () {
    const isDark = window._vfGetTheme();
    if (isDark) {
      document.documentElement.classList.add('dark-mode');
      if (document.body) document.body.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
      if (document.body) document.body.classList.remove('dark-mode');
    }
  })();

  // 2. HTML template for sidebar
  const sidebarHtml = `
<aside class="vf-sidebar" id="vfSidebar">
  <div class="vf-sb-header">
    <a class="vf-sb-brand" href="#"><span class="brand-full">Vishwa Atelier</span><span class="brand-mini">VA</span></a>
    <span class="vf-sb-subtitle">Management Suite</span>
    <div class="vf-sb-user-badge" id="vfSbUserBadge" style="position: relative;">
      <div class="vf-sb-user-avatar" id="vfSbUserAvatar">U</div>
      <div class="vf-sb-user-info" style="flex: 1; min-width: 0;">
        <span class="vf-sb-user-name" id="vfSbUserName">Operator</span>
        <span class="vf-sb-user-role" id="vfSbUserRole" style="display: inline-block; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: rgba(139,92,246,0.15); color: var(--accent);">Operator</span>
      </div>
      <button type="button" class="vf-sb-logout-btn" onclick="_vfLogout()" title="Log Out" aria-label="Log Out" style="background: none; border: none; color: var(--muted); cursor: pointer; padding: 4px; font-size: 1rem; transition: color 0.2s;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>
    </div>
    <div class="vf-sb-fy-wrapper" style="margin-top: 0.75rem; width: 100%;">
      <select id="vfSidebarFYSelect" style="width: 100%; padding: 0.5rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); font-family: var(--font-body), sans-serif; font-size: 0.8rem; font-weight: 600; cursor: pointer; outline: none; transition: all 0.2s;">
        <!-- Dynamically populated -->
      </select>
    </div>
  </div>
  <nav class="vf-sb-nav">
    <div class="vf-sb-mode-selector">
      <button class="vf-sb-mode-btn" id="vfModeYarnBtn" onclick="_vfSetSidebarMode('yarn')">Yarn</button>
      <button class="vf-sb-mode-btn" id="vfModeWeavingBtn" onclick="_vfSetSidebarMode('weaving')">Weaving</button>
    </div>
    <span class="vf-sb-label" data-mode="common">Applications & Modules</span>
    <button class="vf-sb-folder" data-mode="common" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-green"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span>
      Costing Sheet
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="common">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-3">
        <a class="vf-sb-link child" data-mode="weaving" href="modules/weaving/weaving-costing.html?tab=fabric">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span>
          Fabric Costing Calculator
        </a>
        <a class="vf-sb-link child" data-mode="weaving" href="modules/weaving/weaving-costing.html?tab=compare-weaving">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg></span>
          Compare Costing (Weaving)
        </a>
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/yarn-costing.html?tab=tfo">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span>
          TFO Costing Calculator
        </a>
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/yarn-costing.html?tab=doubler">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span>
          Doubler/MX Costing Calculator
        </a>
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/yarn-costing.html?tab=covering">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span>
          Covering Costing Calculator
        </a>
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/yarn-costing.html?tab=compare-yarn">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg></span>
          Compare Costing (Yarn)
        </a>
      </div>
    </div>
    <button class="vf-sb-folder" data-mode="weaving" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-purple"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
      RM Order Book
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="weaving">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-0">
        <a class="vf-sb-link child" href="modules/weaving/order-book.html?view=orders">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
          RM Orders
        </a>
        <a class="vf-sb-link child" href="modules/weaving/order-book.html?view=analytics">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
          RM order analytics
        </a>
        <a class="vf-sb-link child" href="modules/weaving/order-book.html?view=heat-map">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
          RM delivery heat map
        </a>
      </div>
    </div>
    <button class="vf-sb-folder" data-mode="weaving" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-pink"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
      RM Weft Stock Book
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="weaving">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-1">
        <a class="vf-sb-link child" href="modules/weaving/rm-weft-stock-book.html?tab=item-detail">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
          Weft Stock Register
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-weft-stock-book.html?tab=item-ledger-v2">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
          Item-wise Ledger v2
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-weft-stock-book.html?tab=challan-history">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
          Challan Register
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-weft-stock-book.html?tab=low-stock">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
          Low Stock Alerts
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-weft-stock-book.html?tab=log">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
          Transaction Log
        </a>
      </div>
    </div>
    <button class="vf-sb-folder" data-mode="weaving" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-pink"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
      RM Warp Stock Book
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="weaving">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-2">
        <a class="vf-sb-link child" href="modules/weaving/rm-warp-stock-book.html?tab=register">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
          Warp Stock Register
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-warp-stock-book.html?tab=ledger">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
          Warp yarn stock
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-warp-stock-book.html?tab=dashboard">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
          Beams overview
        </a>
        <a class="vf-sb-link child" href="modules/weaving/rm-warp-stock-book.html?tab=tracker">
          <span class="vf-sb-icon vf-sb-icon-pink vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
          Beam tracker
        </a>
      </div>
    </div>
    <!-- Yarn RM Stock Book Link (below Costing Sheet) -->
    <a class="vf-sb-link" data-mode="yarn" href="modules/yarn/yarn-rm-stock.html">
      <span class="vf-sb-icon vf-sb-icon-green"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span>
      Yarn RM Stock Book
    </a>
    <a class="vf-sb-link" data-mode="yarn" href="modules/yarn/yarn-production.html?tab=production">
      <span class="vf-sb-icon vf-sb-icon-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
      Yarn Production
    </a>
    <a class="vf-sb-link" data-mode="yarn" href="modules/yarn/yarn-sales.html?tab=sales">
      <span class="vf-sb-icon vf-sb-icon-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
      Yarn Sales
    </a>
    <a class="vf-sb-link" data-mode="yarn" href="modules/yarn/yarn-stock-dashboard.html?tab=stock-dashboard">
      <span class="vf-sb-icon vf-sb-icon-purple"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span>
      Stock Dashboard
    </a>

    <button class="vf-sb-folder" data-mode="weaving" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
      Weaving Production
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="weaving">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-4">
        <a class="vf-sb-link child" href="modules/weaving/weaving-production.html?tab=analytics">
          <span class="vf-sb-icon vf-sb-icon-blue vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          Production Analytics
        </a>
        <a class="vf-sb-link child" href="modules/weaving/weaving-production.html?tab=production">
          <span class="vf-sb-icon vf-sb-icon-blue vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          Daily Production
        </a>
        <a class="vf-sb-link child" href="modules/weaving/weaving-production.html?tab=production-stock">
          <span class="vf-sb-icon vf-sb-icon-blue vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
          Fabric Stock
        </a>
      </div>
    </div>
    <button class="vf-sb-folder" data-mode="weaving" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
      Dispatch Pipeline
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="weaving">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-dispatch">
        <a class="vf-sb-link child" href="modules/weaving/dispatch.html">
          <span class="vf-sb-icon vf-sb-icon-blue vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span>
          Dispatch Pipeline
        </a>
        <a class="vf-sb-link child" href="modules/weaving/dispatch.html?tab=Outsourced">
          <span class="vf-sb-icon vf-sb-icon-blue vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 8 8 12 12 16"/><line x1="16" y1="12" x2="8" y2="12"/></svg></span>
          Outsource
        </a>
        <a class="vf-sb-link child" href="modules/weaving/dispatch.html?tab=DispatchHistory">
          <span class="vf-sb-icon vf-sb-icon-blue vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg></span>
          Dispatch History
        </a>
      </div>
    </div>
    <button class="vf-sb-folder" data-mode="common" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-green"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 010 7.75"/></svg></span>
      Salary Sheet
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="common">
      <div class="vf-sb-accordion-inner" id="vf-mod-folder-5">
        <a class="vf-sb-link child" href="modules/salary-sheet.html?tab=dashboard-tab">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 010 7.75"/></svg></span>
          Dashboard Overview
        </a>
        <a class="vf-sb-link child" href="modules/salary-sheet.html?tab=karigar-salary">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 010 7.75"/></svg></span>
          Karigar Salary
        </a>
        <a class="vf-sb-link child" href="modules/salary-sheet.html?tab=beam-loading-tab">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg></span>
          Beam Loading
        </a>
        <a class="vf-sb-link child" href="modules/salary-sheet.html?tab=tab-loans">
          <span class="vf-sb-icon vf-sb-icon-green vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
          Loans for Staff
        </a>
      </div>
    </div>

    <a class="vf-sb-link" data-mode="weaving" href="modules/weaving/design-library.html">
      <span class="vf-sb-icon vf-sb-icon-orange"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>
      Design Library
    </a>
    <button class="vf-sb-folder" id="btn-manage-folder-toggle" data-mode="common" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-purple"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
      Manage
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="common">
      <div class="vf-sb-accordion-inner" id="vf-manage-folder">
        <button class="vf-sb-folder child" id="btn-machines-folder-toggle" aria-expanded="true" onclick="_vfToggleFolder(this)">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
          Manage Machines
          <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="vf-sb-accordion-wrapper open">
          <div class="vf-sb-accordion-inner">
            <a class="vf-sb-link grandchild" href="modules/manage.html?tab=machines">
              <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
              Machines List
            </a>
            <a class="vf-sb-link grandchild" href="modules/manage.html?tab=looms">
              <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></span>
              Manage Looms
            </a>
            <a class="vf-sb-link grandchild" href="modules/manage.html?tab=jacquards">
              <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l-7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg></span>
              Manage Jacquards
            </a>
            <a class="vf-sb-link grandchild" href="modules/manage.html?tab=jalas">
              <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
              Jala Details
            </a>
            <a class="vf-sb-link grandchild" href="modules/manage.html?tab=fanis">
              <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></span>
              Fani Details
            </a>
          </div>
        </div>
        <a class="vf-sb-link child" href="modules/manage.html?tab=staff">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 010 7.75"/></svg></span>
          Manage Staff
        </a>
        <a class="vf-sb-link child" href="modules/manage.html?tab=raw-material-qualities">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l-7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg></span>
          Manage RM Qualities
        </a>
        <a class="vf-sb-link child" href="modules/manage.html?tab=raw-material-suppliers">
          <span class="vf-sb-icon vf-sb-icon-purple vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 010 7.75"/></svg></span>
          Manage RM Suppliers
        </a>
      </div>
    </div>
    <a class="vf-sb-link" data-mode="common" href="modules/settings.html">
      <span class="vf-sb-icon vf-sb-icon-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
      Settings
    </a>
    <span class="vf-sb-label" data-mode="common" style="margin-top:0.5rem">Calculators & Tools</span>
    <a class="vf-sb-link" data-mode="weaving" href="modules/weaving/tools/ep-parser.html">
      <span class="vf-sb-icon vf-sb-icon-blue"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>
      EP Parser
    </a>
    <a class="vf-sb-link" data-mode="weaving" href="modules/weaving/tools/jacquard-castout-calculator.html">
      <span class="vf-sb-icon vf-sb-icon-green"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
      Jala and loom cast out calculator
    </a>
    <button class="vf-sb-folder" data-mode="common" aria-expanded="false" onclick="_vfToggleFolder(this)">
      <span class="vf-sb-icon vf-sb-icon-red"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></span>
      Gear Charts
      <svg class="vf-sb-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <div class="vf-sb-accordion-wrapper" data-mode="common">
      <div class="vf-sb-accordion-inner" id="vf-gear-folder">
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/gear%20charts/NATIONAL%20TEXTILE%20JARI%20COVERING%20GEAR%20CALCULATOR.html">
          <span class="vf-sb-icon vf-sb-icon-red vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
          National Textile Jari
        </a>
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/gear%20charts/SHIVAM%20ENGINEERING%20TFO%20GEAR%20CALCULATOR.html">
          <span class="vf-sb-icon vf-sb-icon-red vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
          Shivam Engineering TFO
        </a>
        <a class="vf-sb-link child" data-mode="weaving" href="modules/weaving/gear%20charts/SHINKWANG%20GEAR%20COVERING%20GEAR%20CALCULATOR.html">
          <span class="vf-sb-icon vf-sb-icon-red vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
          Shinkwang Gear
        </a>
        <a class="vf-sb-link child" data-mode="yarn" href="modules/yarn/gear%20charts/DOUBLER%20GEAR%20CALCULATIONS.html">
          <span class="vf-sb-icon vf-sb-icon-red vf-sb-icon-sm"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
          Doubler Gear Calculations
        </a>
      </div>
    </div>
  </nav>
  <div class="vf-sb-footer">
    <button class="vf-sb-collapse-btn" onclick="_vfToggleSidebarCollapse()" id="vfSidebarCollapseBtn">
      <svg class="vf-sb-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="11 17 6 12 11 7"></polyline>
        <polyline points="18 17 13 12 18 7"></polyline>
      </svg>
      <span class="vf-sb-collapse-text">Collapse Sidebar</span>
    </button>
  </div>
</aside>
<button class="vf-sb-toggle" id="vfSbToggle" aria-label="Toggle navigation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
<div class="vf-sb-overlay" id="vfSbOverlay"></div>
  `;

  // 3. Inject the sidebar HTML
  function injectSidebar() {
    // If the sidebar is already present, remove it to avoid duplicates
    const existingSidebar = document.getElementById('vfSidebar');
    if (existingSidebar) existingSidebar.remove();
    const existingToggle = document.getElementById('vfSbToggle');
    if (existingToggle) existingToggle.remove();
    const existingOverlay = document.getElementById('vfSbOverlay');
    if (existingOverlay) existingOverlay.remove();

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sidebarHtml;

    // Resolve all relative paths before inserting.
    // Preserve .html extension for static files to prevent 404 errors on local web servers.
    tempDiv.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('https') && !href.startsWith('#') && !href.startsWith('javascript:')) {
        a.setAttribute('href', rootPath + href);
      }
    });

    // Move elements to document.body
    while (tempDiv.firstChild) {
      document.body.insertBefore(tempDiv.firstChild, document.body.firstChild);
    }

    // Initialize sidebar logic, event listeners, active states
    initSidebarLogic();
    injectPresenceBar();
  }

  // --- Realtime User Presence Bar (Google Sheets Style) ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function elevateAncestors(el) {
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.nodeType === 1) {
        curr.classList.add('vf-presence-elevated');
      }
      curr = curr.parentElement;
    }
  }

  function resetAncestorElevation(el) {
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.nodeType === 1) {
        curr.classList.remove('vf-presence-elevated');
      }
      curr = curr.parentElement;
    }
  }

  function positionPresencePopover(wrapEl) {
    const popover = wrapEl.querySelector('.vf-presence-popover');
    if (!popover) return;
    const rect = wrapEl.getBoundingClientRect();
    const popoverWidth = 260;

    // Reset styles
    popover.style.left = '';
    popover.style.right = '';
    popover.style.transform = '';
    popover.style.top = '';
    popover.style.bottom = '';

    // Horizontal collision handling
    const spaceRight = window.innerWidth - rect.left;
    if (spaceRight < popoverWidth + 24 && rect.right > popoverWidth) {
      popover.style.right = '0px';
      popover.style.left = 'auto';
    } else if (rect.left < 24) {
      popover.style.left = '0px';
      popover.style.right = 'auto';
    } else {
      popover.style.left = '0px';
      popover.style.right = 'auto';
    }

    // Vertical collision handling
    if (rect.bottom + 220 > window.innerHeight && rect.top > 220) {
      popover.style.top = 'auto';
      popover.style.bottom = 'calc(100% + 8px)';
    } else {
      popover.style.top = 'calc(100% + 8px)';
      popover.style.bottom = 'auto';
    }
  }

  function injectPresenceBar() {
    // Avoid injecting on login screen
    const path = window.location.pathname.toLowerCase();
    const page = path.split('/').pop() || 'index.html';
    if (page === 'index.html' && !localStorage.getItem('vf_session') && !localStorage.getItem('vf_user_name')) {
      return;
    }

    let presenceBar = document.getElementById('vfPresenceBar');
    if (!presenceBar) {
      presenceBar = document.createElement('div');
      presenceBar.id = 'vfPresenceBar';
      presenceBar.className = 'vf-presence-container';
      presenceBar.innerHTML = `
        <span class="vf-presence-label" title="Live collaborators online (Google Sheets style)">
          <span class="vf-presence-live-dot" title="Live Realtime Collab Sync Active"></span>
          <span id="vfPresenceCountText">1 Online</span>
        </span>
        <div class="vf-avatar-stack" id="vfAvatarStack"></div>
      `;

      const label = presenceBar.querySelector('.vf-presence-label');
      if (label) {
        label.style.cursor = 'pointer';
        label.addEventListener('click', (e) => {
          e.stopPropagation();
          const stack = document.getElementById('vfAvatarStack');
          if (!stack) return;
          const selfId = window.VishwaSupabase && window.VishwaSupabase.getCurrentUser ? window.VishwaSupabase.getCurrentUser().clientId : '';
          const otherWrap = stack.querySelector(`.vf-presence-avatar-wrap:not([data-client-id="${selfId}"])`) || stack.querySelector('.vf-presence-avatar-wrap');
          if (otherWrap) {
            otherWrap.click();
          }
        });
      }
    }

    // Dock directly next to the active sheet title or header across all modules
    function isCurrentlyDocked() {
      if (!presenceBar || !presenceBar.parentElement) return false;
      if (!document.body.contains(presenceBar)) return false;
      const parent = presenceBar.parentElement;
      if (parent.closest('#vfSidebar')) return false;
      return Boolean(
        parent.closest('header, .logo-section, .page-header, .salary-page-header, .dl-page-header, #vfPresenceBarSlot') ||
        parent.querySelector('h1, h2, .logo, .title, #page-header-title, #division-title')
      );
    }

    // Dock directly next to the active sheet title or header across all modules
    function dockNextToSheetTitle() {
      if (isCurrentlyDocked()) {
        presenceBar.style.display = 'inline-flex';
        return true;
      }

      // 1. Direct explicit slot in Costing modules
      const slot = document.getElementById('vfPresenceBarSlot');
      if (slot) {
        if (!slot.contains(presenceBar)) {
          slot.appendChild(presenceBar);
        }
        slot.classList.add('vf-presence-parent');
        presenceBar.style.display = 'inline-flex';
        return true;
      }

      // 2. Comprehensive sheet title selectors across all modules
      const candidates = [
        document.querySelector('.logo-section .logo'),
        document.querySelector('.logo-section'),
        document.querySelector('#page-header-title'),
        document.querySelector('#division-title'),
        document.querySelector('.salary-page-header h1'),
        document.querySelector('.salary-page-header .title'),
        document.querySelector('.salary-page-header'),
        document.querySelector('.dl-page-header h1'),
        document.querySelector('.dl-page-header'),
        document.querySelector('header .flex.items-center'),
        document.querySelector('header h1'),
        document.querySelector('header h2'),
        document.querySelector('.page-header h1'),
        document.querySelector('.page-header h2'),
        document.querySelector('.page-header'),
        document.querySelector('.sheet-title'),
        document.querySelector('.vf-sheet-title'),
        document.querySelector('.vf-page-title'),
        document.querySelector('header .logo'),
        document.querySelector('.logo'),
        document.querySelector('main h1'),
        document.querySelector('main h2'),
        document.querySelector('.main-content h1'),
        document.querySelector('.main-content h2'),
        document.querySelector('#root h1'),
        document.querySelector('#root h2'),
        document.querySelector('h1'),
        document.querySelector('h2')
      ];

      for (const t of candidates) {
        if (t && t.offsetParent !== null && !t.closest('#vfSidebar') && !t.closest('.modal') && !t.closest('.vf-modal') && !t.closest('.dialog')) {
          if (!t.contains(presenceBar) && t.parentElement) {
            t.parentElement.classList.add('vf-presence-parent');
            t.classList.add('vf-presence-parent');
            if (t.classList && (t.classList.contains('logo-section') || t.classList.contains('salary-page-header') || t.classList.contains('dl-page-header'))) {
              t.appendChild(presenceBar);
            } else if (t.nextSibling) {
              t.parentElement.insertBefore(presenceBar, t.nextSibling);
            } else {
              t.parentElement.appendChild(presenceBar);
            }
            presenceBar.style.display = 'inline-flex';
            return true;
          }
        }
      }
      return false;
    }

    if (!dockNextToSheetTitle()) {
      presenceBar.style.display = 'none';
    }

    // Continuously observe DOM updates across React routes and tab transitions with debounced guard
    let dockDebounceRaf = null;
    const mo = new MutationObserver((mutations) => {
      // If already securely docked, skip expensive search
      if (isCurrentlyDocked()) return;

      // Ignore mutations originating from within the presence bar itself
      const onlyInternalMutations = mutations.every(m => presenceBar.contains(m.target));
      if (onlyInternalMutations) return;

      if (!dockDebounceRaf) {
        dockDebounceRaf = requestAnimationFrame(() => {
          dockDebounceRaf = null;
          dockNextToSheetTitle();
        });
      }
    });
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });

    renderPresenceBarUI();
  }

  // --- Known Module File Mappings & Tab Aliases for Navigation ---
  const MODULE_PAGE_MAP = {
    'yarn-costing.html': 'modules/yarn/yarn-costing.html',
    'yarn-production.html': 'modules/yarn/yarn-production.html',
    'yarn-sales.html': 'modules/yarn/yarn-sales.html',
    'yarn-stock-dashboard.html': 'modules/yarn/yarn-stock-dashboard.html',
    'yarn-rm-stock.html': 'modules/yarn/yarn-rm-stock.html',
    'weaving-costing.html': 'modules/weaving/weaving-costing.html',
    'weaving-production.html': 'modules/weaving/weaving-production.html',
    'order-book.html': 'modules/weaving/order-book.html',
    'rm-weft-stock-book.html': 'modules/weaving/rm-weft-stock-book.html',
    'rm-warp-stock-book.html': 'modules/weaving/rm-warp-stock-book.html',
    'design-library.html': 'modules/weaving/design-library.html',
    'dispatch.html': 'modules/weaving/dispatch.html',
    'manage.html': 'modules/manage.html',
    'salary-sheet.html': 'modules/salary-sheet.html',
    'settings.html': 'modules/settings.html',
    'index.html': 'index.html',
    'jacquard-castout-calculator.html': 'modules/weaving/tools/jacquard-castout-calculator.html',
    'ep-parser.html': 'modules/weaving/tools/ep-parser.html'
  };

  const TAB_ALIASES = {
    'tfo': ['tfo', 'tfo costing', 'tfo costing calculator', 'tab-tfo', 'tab-btn-tfo'],
    'doubler': ['doubler', 'doubler/mx', 'doubler costing', 'doubler/mx costing', 'doubler/mx costing calculator', 'tab-doubler', 'tab-btn-doubler'],
    'covering': ['covering', 'covering costing', 'covering costing calculator', 'tab-covering', 'tab-btn-covering'],
    'fabric': ['fabric', 'fabric costing', 'fabric costing calculator', 'tab-fabric', 'tab-btn-fabric'],
    'compare-yarn': ['compare-yarn', 'compare yarn', 'compare yarn costing'],
    'compare-weaving': ['compare-weaving', 'compare weaving', 'compare weaving costing'],
    'production': ['production', 'daily production', 'tab-btn-production'],
    'production-stock': ['production-stock', 'fabric stock', 'stock', 'tab-btn-stock'],
    'sales': ['sales', 'yarn sales', 'tab-btn-sales'],
    'stock-dashboard': ['stock-dashboard', 'stock', 'tab-btn-stock'],
    'analytics': ['analytics', 'production analytics', 'rm order analytics', 'tab-btn-analytics'],
    'orders': ['orders', 'rm orders'],
    'heat-map': ['heat-map', 'heatmap', 'delivery heat map', 'rm delivery heat map'],
    'item-detail': ['item-detail', 'weft stock register', 'stock register'],
    'item-ledger-v2': ['item-ledger-v2', 'item-wise ledger v2', 'item-wise ledger', 'ledger'],
    'challan-history': ['challan-history', 'challan register', 'challan history'],
    'low-stock': ['low-stock', 'low stock', 'low stock alerts'],
    'log': ['log', 'transaction log', 'log issue'],
    'register': ['register', 'warp stock register'],
    'ledger': ['ledger', 'warp yarn stock'],
    'dashboard': ['dashboard', 'beams overview'],
    'tracker': ['tracker', 'beam tracker'],
    'dashboard-tab': ['dashboard-tab', 'dashboard overview', 'dashboard'],
    'karigar-salary': ['karigar-salary', 'karigar salary'],
    'beam-loading-tab': ['beam-loading-tab', 'beam loading'],
    'tab-loans': ['tab-loans', 'loans for staff', 'loans'],
    'machines': ['machines', 'machines list'],
    'looms': ['looms', 'manage looms'],
    'jacquards': ['jacquards', 'manage jacquards'],
    'jalas': ['jalas', 'jala details', 'manage jalas'],
    'fanis': ['fanis', 'manage fanis'],
    'tab-manifest': ['tab-manifest', 'manifest'],
    'tab-visualizer': ['tab-visualizer', 'visualizer'],
    'tab-jala': ['tab-jala', 'jala'],
    'tab-jacfile': ['tab-jacfile', 'jacfile'],
    'tab-schedule': ['tab-schedule', 'schedule']
  };

  function formatTabName(tab) {
    if (!tab) return '';
    const map = {
      'tfo': 'TFO Costing',
      'doubler': 'Doubler/MX Costing',
      'covering': 'Covering Costing',
      'fabric': 'Fabric Costing',
      'compare-yarn': 'Compare Yarn Costing',
      'compare-weaving': 'Compare Weaving Costing',
      'production': 'Daily Production',
      'production-stock': 'Fabric Stock',
      'analytics': 'Analytics',
      'sales': 'Yarn Sales',
      'stock-dashboard': 'Stock Dashboard',
      'orders': 'RM Orders',
      'heat-map': 'Delivery Heat Map',
      'item-detail': 'Weft Stock Register',
      'item-ledger-v2': 'Item-wise Ledger',
      'challan-history': 'Challan History',
      'low-stock': 'Low Stock Alerts',
      'log': 'Transaction Log',
      'register': 'Warp Stock Register',
      'ledger': 'Warp Yarn Stock',
      'dashboard': 'Beams Overview',
      'tracker': 'Beam Tracker',
      'dashboard-tab': 'Dashboard Overview',
      'karigar-salary': 'Karigar Salary',
      'beam-loading-tab': 'Beam Loading',
      'tab-loans': 'Staff Loans',
      'machines': 'Machines List',
      'looms': 'Manage Looms',
      'jacquards': 'Manage Jacquards',
      'jalas': 'Jala Details',
      'fanis': 'Manage Fanis'
    };
    return map[tab.toLowerCase()] || tab.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatPageName(page) {
    if (!page) return '';
    const clean = page.toLowerCase().split('?')[0].split('#')[0].replace('.html', '');
    return clean.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function showCollabJumpToast(toastData, userColor, initials) {
    let toast = document.getElementById('vfCollabJumpToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vfCollabJumpToast';
      toast.className = 'vf-collab-toast';
      document.body.appendChild(toast);
    }

    const bg = userColor && userColor.bg ? userColor.bg : '#8b5cf6';
    const fg = userColor && userColor.fg ? userColor.fg : '#ffffff';
    const init = initials || '●';

    let contentHtml = '';
    if (typeof toastData === 'string') {
      contentHtml = `<span class="vf-collab-toast-title">${escapeHtml(toastData)}</span>`;
    } else if (toastData && typeof toastData === 'object') {
      const title = toastData.title || 'Jumped to collaborator';
      const tab = toastData.tab || '';
      const quality = toastData.quality || toastData.qualityName || '';
      contentHtml = `
        <span class="vf-collab-toast-title">⚡ ${escapeHtml(title)}</span>
        ${tab ? `<span class="vf-collab-toast-tab">${escapeHtml(tab)}</span>` : ''}
        ${quality ? `<span class="vf-collab-toast-quality" title="${escapeHtml(quality)}">🧵 ${escapeHtml(quality)}</span>` : ''}
      `;
    }

    toast.innerHTML = `
      <div class="vf-collab-toast-avatar" style="background: ${bg}; color: ${fg};">${escapeHtml(init)}</div>
      <div class="vf-collab-toast-content">${contentHtml}</div>
    `;

    toast.classList.add('show');
    clearTimeout(window.__vf_toast_timer);
    window.__vf_toast_timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3800);
  }

  window.vfSwitchQuality = function(qualityIndex, qualityName, qualityId) {
    if (qualityIndex === undefined && !qualityName && !qualityId) return false;
    let switched = false;

    // 1. Call global React hook/bridge if available
    try {
      if (typeof window.__vf_set_quality === 'function') {
        window.__vf_set_quality(qualityIndex, qualityName, qualityId);
        switched = true;
      }
    } catch(e) {}

    // 2. Dispatch custom event for React components
    try {
      window.__vf_active_quality_index = qualityIndex;
      window.__vf_active_quality_name = qualityName;
      window.__vf_active_quality_id = qualityId;
      window.dispatchEvent(new CustomEvent('vf-quality-changed', {
        detail: { qualityIndex, qualityName, qualityId }
      }));
    } catch(e) {}

    // 3. Fallback: Search in DOM quality footer tabs
    try {
      const footerTabs = document.querySelectorAll('.yc-quality-footer-scroll .gs-tab, .quality-tab, .sheet-tab, [data-quality-index]');
      if (footerTabs.length > 0) {
        let targetTabEl = null;
        if (qualityIndex !== undefined && qualityIndex !== null && footerTabs[qualityIndex]) {
          targetTabEl = footerTabs[qualityIndex];
        } else if (qualityName) {
          const cleanQ = String(qualityName).toLowerCase().trim();
          for (const tabEl of footerTabs) {
            if (tabEl.textContent.toLowerCase().trim().includes(cleanQ)) {
              targetTabEl = tabEl;
              break;
            }
          }
        }
        if (targetTabEl) {
          targetTabEl.click();
          switched = true;
        }
      }
    } catch(e) {}

    return switched;
  };

  window.vfSwitchTab = function(targetTab) {
    if (!targetTab) return false;
    const cleanTarget = String(targetTab).toLowerCase().trim();
    const cleanNoDash = cleanTarget.replace(/[-_\s]+/g, '');

    let switched = false;

    // 1. Direct attribute matches
    let el = document.querySelector(`[data-tab="${CSS.escape(targetTab)}"], [data-view="${CSS.escape(targetTab)}"], [data-division="${CSS.escape(targetTab)}"], [data-target="${CSS.escape(targetTab)}"], [aria-controls="${CSS.escape(targetTab)}"]`);

    // 2. Direct ID matches
    if (!el) {
      el = document.getElementById(targetTab) || 
           document.getElementById('tab-btn-' + targetTab) || 
           document.getElementById('btn-tab-' + targetTab) || 
           document.getElementById('btn-' + targetTab) || 
           document.getElementById('tab-' + targetTab);
    }

    // 3. Check onclick attribute containing targetTab
    if (!el) {
      const onclickBtns = document.querySelectorAll('button[onclick], [role="tab"][onclick], .tab-btn[onclick], .nav-tab[onclick], .sub-tab-btn[onclick], .main-tab-btn[onclick]');
      for (const b of onclickBtns) {
        const oc = b.getAttribute('onclick') || '';
        if (oc.includes(`'${targetTab}'`) || oc.includes(`"${targetTab}"`) || oc.includes(`(${targetTab})`)) {
          el = b;
          break;
        }
      }
    }

    // 4. Check all tab buttons by text content or dataset or aliases
    if (!el) {
      const allTabCandidates = document.querySelectorAll('.tab-btn, .nav-tab, .main-tab-btn, .sub-tab-btn, [role="tab"], .salary-tabs .tab-btn, .tabs button, .main-tabs button, .sub-tabs button');
      for (const b of allTabCandidates) {
        const bTab = (b.dataset.tab || b.dataset.view || b.dataset.division || '').toLowerCase().trim();
        const bText = (b.textContent || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const bTextClean = bText.replace(/[^a-z0-9]/g, '');

        if (bTab === cleanTarget || bTab.replace(/[-_\s]+/g, '') === cleanNoDash) {
          el = b;
          break;
        }
        if (bTextClean === cleanNoDash || bText === cleanTarget) {
          el = b;
          break;
        }

        const aliases = TAB_ALIASES[cleanTarget] || [];
        for (const alias of aliases) {
          const cleanAlias = alias.replace(/[^a-z0-9]/g, '');
          if (bTab === alias || bText.includes(alias) || bTextClean === cleanAlias) {
            el = b;
            break;
          }
        }
        if (el) break;
      }
    }

    // 5. If found, invoke click
    if (el) {
      try {
        el.click();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        switched = true;
      } catch(e) {}
    }

    // 6. Invoke global page-specific tab functions if available
    try {
      if (typeof window.switchTab === 'function') {
        window.switchTab(targetTab);
        switched = true;
      }
      if (typeof window.switchSalaryTab === 'function') {
        window.switchSalaryTab(targetTab);
        switched = true;
      }
      if (typeof window.switchSubTab === 'function') {
        window.switchSubTab(targetTab);
        switched = true;
      }
      if (typeof window.switchDivision === 'function') {
        window.switchDivision(targetTab);
        switched = true;
      }
      if (typeof window.switchRosterTab === 'function') {
        window.switchRosterTab(targetTab);
        switched = true;
      }
    } catch(e) {}

    // 7. Update URL query string without reloading & broadcast custom event
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') !== targetTab && url.searchParams.get('view') !== targetTab) {
        if (url.searchParams.has('view')) {
          url.searchParams.set('view', targetTab);
        } else {
          url.searchParams.set('tab', targetTab);
        }
        window.history.pushState({}, '', url.toString());
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      window.__vf_active_tab = targetTab;
      window.dispatchEvent(new CustomEvent('vf-tab-changed', { detail: { tab: targetTab } }));
    } catch(e) {}

    return switched;
  };

  window.vfFocusCollaboratorField = function(fieldId, userData) {
    let el = null;
    if (fieldId) {
      try {
        el = document.querySelector(`[data-collab-id="${CSS.escape(fieldId)}"]`) ||
             document.getElementById(fieldId) ||
             document.querySelector(`[name="${CSS.escape(fieldId)}"]`) ||
             document.querySelector(`[data-row-id="${CSS.escape(fieldId)}"]`) ||
             document.querySelector(`[data-field="${CSS.escape(fieldId)}"]`) ||
             document.querySelector(`tr[data-id="${CSS.escape(fieldId)}"]`);
        
        if (!el && fieldId.includes('__')) {
          const [rowKey, fieldKey] = fieldId.split('__');
          const row = document.querySelector(`[data-row-id="${CSS.escape(rowKey)}"], [data-item-id="${CSS.escape(rowKey)}"], #${CSS.escape(rowKey)}`);
          if (row) {
            el = row.querySelector(`[name="${CSS.escape(fieldKey)}"], [placeholder="${CSS.escape(fieldKey)}"], [aria-label="${CSS.escape(fieldKey)}"]`);
          }
        }
      } catch(e) {}
    }

    const existingHalo = document.getElementById('vfCollabSpotlightHalo');
    if (existingHalo) existingHalo.remove();

    const user = userData ? (userData.user || userData) : {};
    const userName = user.name || 'User';
    const color = user.color || { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.45)' };

    if (el && el.offsetParent !== null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      try {
        if (typeof el.focus === 'function' && el.tagName !== 'TR' && el.tagName !== 'DIV') {
          el.focus({ preventScroll: true });
        }
      } catch(e) {}

      const rect = el.getBoundingClientRect();
      const halo = document.createElement('div');
      halo.id = 'vfCollabSpotlightHalo';
      halo.className = 'vf-collab-spotlight-halo';
      halo.style.setProperty('--vf-spotlight-color', color.bg);
      halo.style.setProperty('--vf-spotlight-glow', color.glow || 'rgba(139,92,246,0.4)');
      
      halo.style.position = 'fixed';
      halo.style.top = (rect.top - 4) + 'px';
      halo.style.left = (rect.left - 4) + 'px';
      halo.style.width = (rect.width + 8) + 'px';
      halo.style.height = (rect.height + 8) + 'px';

      const badge = document.createElement('div');
      badge.className = 'vf-collab-spotlight-badge';
      badge.style.setProperty('--vf-spotlight-color', color.bg);
      badge.innerHTML = `
        <span style="font-size: 0.6rem;">●</span>
        <span>${escapeHtml(userName)} ${userData && userData.isTyping ? 'is typing...' : 'is active here'}</span>
      `;
      halo.appendChild(badge);
      document.body.appendChild(halo);

      const onScrollReposition = () => {
        if (!document.body.contains(halo) || !document.body.contains(el)) {
          window.removeEventListener('scroll', onScrollReposition, true);
          return;
        }
        const r = el.getBoundingClientRect();
        halo.style.top = (r.top - 4) + 'px';
        halo.style.left = (r.left - 4) + 'px';
        halo.style.width = (r.width + 8) + 'px';
        halo.style.height = (r.height + 8) + 'px';
      };
      window.addEventListener('scroll', onScrollReposition, true);

      setTimeout(() => {
        if (halo && halo.parentElement) {
          halo.style.opacity = '0';
          setTimeout(() => halo.remove(), 400);
        }
        window.removeEventListener('scroll', onScrollReposition, true);
      }, 3800);
    } else {
      const mainEl = document.querySelector('main, .main-content, .app-container, .container, #root');
      if (mainEl) {
        mainEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  window.vfJumpToCollaborator = function(u) {
    if (!u) return;
    const selfId = (window.VishwaSupabase && window.VishwaSupabase.getCurrentUser && window.VishwaSupabase.getCurrentUser().clientId);
    const isSelf = u.isSelf || (u.user && u.user.clientId === selfId) || (u.clientId === selfId);
    const userObj = u.user || {};
    const userName = userObj.name || 'User';
    const userInitials = userObj.initials || userName.slice(0, 2).toUpperCase();
    const userColor = userObj.color || { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.45)' };

    if (isSelf) {
      showCollabJumpToast('📍 You are currently viewing this sheet', userColor, userInitials);
      return;
    }

    const currentPath = window.location.pathname.toLowerCase();
    const currentPageFile = currentPath.split('/').pop().split('?')[0].split('#')[0] || 'index.html';

    const targetPage = u.page ? u.page.toLowerCase().split('?')[0].split('#')[0] : currentPageFile;
    const targetTab = u.tab || '';
    const targetQualityIndex = u.qualityIndex !== undefined && u.qualityIndex !== null ? u.qualityIndex : null;
    const targetQualityName = u.qualityName || '';
    const targetQualityId = u.qualityId || '';
    const targetField = u.field || '';

    const isSamePage = !targetPage || targetPage === currentPageFile || currentPath.endsWith(targetPage);

    if (isSamePage) {
      let switched = false;
      if (targetTab) {
        switched = window.vfSwitchTab(targetTab);
      }

      if (targetQualityIndex !== null || targetQualityName || targetQualityId) {
        window.vfSwitchQuality(targetQualityIndex, targetQualityName, targetQualityId);
      }

      setTimeout(() => {
        window.vfFocusCollaboratorField(targetField, u);
      }, switched ? 160 : 30);

      showCollabJumpToast({
        title: `Jumped to ${userName}`,
        tab: targetTab ? formatTabName(targetTab) : '',
        quality: targetQualityName || (targetQualityIndex !== null ? `Quality ${Number(targetQualityIndex) + 1}` : '')
      }, userColor, userInitials);
    } else {
      let relPath = MODULE_PAGE_MAP[targetPage];
      if (!relPath) {
        if (u.fullPath && u.fullPath.includes('/modules/')) {
          const idx = u.fullPath.indexOf('/modules/');
          relPath = u.fullPath.substring(idx + 1);
        } else {
          relPath = targetPage;
        }
      }

      let destUrl = rootPath + relPath;
      const params = new URLSearchParams();
      if (targetTab) params.set('tab', targetTab);
      if (targetQualityIndex !== null) params.set('quality', targetQualityIndex);

      let queryStr = params.toString();
      if (queryStr) destUrl += '?' + queryStr;

      destUrl += '#vf-collab-jump=' + encodeURIComponent(u.clientId || '') +
                 (targetTab ? '&tab=' + encodeURIComponent(targetTab) : '') +
                 (targetQualityIndex !== null ? '&qIdx=' + encodeURIComponent(targetQualityIndex) : '') +
                 (targetQualityName ? '&qName=' + encodeURIComponent(targetQualityName) : '') +
                 (targetQualityId ? '&qId=' + encodeURIComponent(targetQualityId) : '') +
                 (targetField ? '&field=' + encodeURIComponent(targetField) : '') +
                 '&name=' + encodeURIComponent(userName);

      showCollabJumpToast({
        title: `Opening ${userName}'s sheet`,
        tab: formatPageName(targetPage),
        quality: targetQualityName || ''
      }, userColor, userInitials);

      setTimeout(() => {
        window.location.href = destUrl;
      }, 220);
    }
  };

  // Check URL hash for collaborator jump on arrival
  function handleInitialCollabJump() {
    try {
      const hash = window.location.hash;
      if (!hash || !hash.includes('vf-collab-jump=')) return;

      const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
      const jumpTab = hashParams.get('tab');
      const jumpQualityIndex = hashParams.has('qIdx') ? Number(hashParams.get('qIdx')) : null;
      const jumpQualityName = hashParams.get('qName') || '';
      const jumpQualityId = hashParams.get('qId') || '';
      const jumpField = hashParams.get('field');
      const jumpName = hashParams.get('name') || 'Collaborator';

      setTimeout(() => {
        if (jumpTab) {
          window.vfSwitchTab(jumpTab);
        }
        if (jumpQualityIndex !== null || jumpQualityName || jumpQualityId) {
          window.vfSwitchQuality(jumpQualityIndex, jumpQualityName, jumpQualityId);
        }
        setTimeout(() => {
          window.vfFocusCollaboratorField(jumpField, {
            user: { name: jumpName, color: { bg: '#8b5cf6', fg: '#ffffff' } }
          });
          showCollabJumpToast({
            title: `Jumped to ${jumpName}`,
            tab: formatTabName(jumpTab || ''),
            quality: jumpQualityName || (jumpQualityIndex !== null ? `Quality ${jumpQualityIndex + 1}` : '')
          }, { bg: '#8b5cf6', fg: '#ffffff' }, jumpName.slice(0, 2).toUpperCase());
        }, 250);
      }, 200);

      if (window.history && window.history.replaceState) {
        const cleanUrl = window.location.href.split('#')[0];
        window.history.replaceState(null, '', cleanUrl);
      }
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleInitialCollabJump);
  } else {
    handleInitialCollabJump();
  }

  let lastRenderedPresenceSignature = '';
  let presenceRenderRaf = null;

  function renderPresenceBarUI(presenceDetail) {
    const stack = document.getElementById('vfAvatarStack');
    const countText = document.getElementById('vfPresenceCountText');
    if (!stack) return;

    let users = presenceDetail && presenceDetail.users;
    if (!users && window.VishwaSupabase && typeof window.VishwaSupabase.getAllPresence === 'function') {
      users = window.VishwaSupabase.getAllPresence();
    }
    if (!users || !Array.isArray(users) || users.length === 0) {
      if (presenceDetail && presenceDetail.pageUsers) {
        users = presenceDetail.pageUsers;
      } else if (window.VishwaSupabase && typeof window.VishwaSupabase.getPresence === 'function') {
        users = window.VishwaSupabase.getPresence();
      }
    }
    if (!users || !Array.isArray(users) || users.length === 0) {
      const selfUser = window.VishwaSupabase && typeof window.VishwaSupabase.getCurrentUser === 'function' ? 
        window.VishwaSupabase.getCurrentUser() : { name: 'Operator', role: 'Operator', initials: 'OP', color: { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.45)' } };
      users = [{ user: selfUser, isSelf: true, lastPing: Date.now() }];
    }

    const selfId = (presenceDetail && presenceDetail.selfId) || (window.VishwaSupabase && window.VishwaSupabase.getCurrentUser && window.VishwaSupabase.getCurrentUser().clientId);

    // Update count text directly without triggering full avatar re-render
    const expectedCountText = users.length === 1 ? '1 Online' : `${users.length} Online`;
    if (countText && countText.textContent !== expectedCountText) {
      countText.textContent = expectedCountText;
    }

    // Compute deterministic signature to skip redundant DOM teardown/rebuild
    const currentSig = users.map(u => {
      const cid = u.clientId || (u.user && u.user.clientId) || '';
      const uname = (u.user && u.user.name) || '';
      return `${cid}:${uname}:${u.page || ''}:${u.tab || ''}:${u.qualityIndex ?? ''}:${u.isTyping ? 1 : 0}:${u.isAway ? 1 : 0}`;
    }).sort().join('|');

    if (currentSig === lastRenderedPresenceSignature) {
      return; // 0ms cost when state is unchanged!
    }
    lastRenderedPresenceSignature = currentSig;

    // If user is currently hovering or interacting inside stack, preserve DOM and update in-place
    if (stack.matches(':hover') || stack.querySelector('.vf-presence-avatar-wrap:hover') || (document.activeElement && stack.contains(document.activeElement))) {
      users.forEach(u => {
        const cid = u.clientId || (u.user && u.user.clientId);
        const wrap = stack.querySelector(`[data-client-id="${CSS.escape(cid || '')}"]`);
        if (wrap) {
          const dot = wrap.querySelector('.vf-presence-status-dot');
          if (dot) {
            dot.classList.toggle('typing', Boolean(u.isTyping));
          }
        }
      });
      return;
    }

    stack.innerHTML = '';

    const maxVisible = 4;
    const visibleUsers = users.slice(0, maxVisible);
    const overflowUsers = users.slice(maxVisible);

    if (overflowUsers.length > 0) {
      const moreWrap = document.createElement('div');
      moreWrap.className = 'vf-presence-avatar-wrap';
      moreWrap.setAttribute('tabindex', '0');
      moreWrap.innerHTML = `
        <div class="vf-presence-overflow-badge" title="View all ${users.length} online employees">+${overflowUsers.length}</div>
        <div class="vf-presence-popover">
          <div class="vf-popover-header" style="font-size: 0.78rem; font-weight: 700; color: var(--fg); margin-bottom: 8px;">
            Other Active Collaborators (${overflowUsers.length})
          </div>
          ${overflowUsers.map((u, idx) => {
            const uColor = u.user && u.user.color ? u.user.color : { bg: '#8b5cf6', fg: '#ffffff' };
            const uTab = u.tab ? formatTabName(u.tab) : (u.page ? formatPageName(u.page) : '');
            const uQuality = u.qualityName || (u.qualityIndex !== undefined && u.qualityIndex !== null ? `Quality ${Number(u.qualityIndex) + 1}` : '');
            const isAway = Boolean(u.isAway);
            const subText = [u.user ? u.user.role : 'Viewer', isAway ? 'Away' : '', uTab, uQuality].filter(Boolean).join(' • ');
            return `
            <div class="vf-popover-overflow-item" data-overflow-idx="${idx}">
              <div class="vf-popover-avatar" style="background: ${uColor.bg}; color: ${uColor.fg}; width: 24px; height: 24px; font-size: 0.65rem;">
                ${escapeHtml(u.user ? u.user.initials : 'U')}
              </div>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 0.76rem; font-weight: 700; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(u.user ? u.user.name : 'User')}
                  ${isAway ? '<span style="font-size: 0.6rem; opacity: 0.6; margin-left: 4px;">(Away)</span>' : ''}
                </div>
                <div style="font-size: 0.66rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(subText)}</div>
              </div>
              <span class="vf-overflow-jump-icon" title="Jump to view">↗</span>
            </div>
          `;}).join('')}
        </div>
      `;

      moreWrap.querySelectorAll('.vf-popover-overflow-item').forEach((itemEl, idx) => {
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          window.vfJumpToCollaborator(overflowUsers[idx]);
        });
      });

      moreWrap.addEventListener('mouseenter', () => {
        elevateAncestors(moreWrap);
        positionPresencePopover(moreWrap);
      });
      moreWrap.addEventListener('mouseleave', () => {
        resetAncestorElevation(moreWrap);
      });
      moreWrap.addEventListener('focusin', () => {
        elevateAncestors(moreWrap);
        positionPresencePopover(moreWrap);
      });
      moreWrap.addEventListener('focusout', () => {
        resetAncestorElevation(moreWrap);
      });

      stack.appendChild(moreWrap);
    }

    visibleUsers.forEach(u => {
      const isSelf = u.isSelf || (u.user && u.user.clientId === selfId) || (u.clientId === selfId);
      const color = u.user && u.user.color ? u.user.color : { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.45)' };
      const name = (u.user && u.user.name) || 'User';
      const role = (u.user && u.user.role) || 'Operator';
      const initials = (u.user && u.user.initials) || name.slice(0, 2).toUpperCase();
      const tabName = u.tab ? formatTabName(u.tab) : (u.page ? formatPageName(u.page) : '');
      const qualityName = u.qualityName || (u.qualityIndex !== undefined && u.qualityIndex !== null ? `Quality ${Number(u.qualityIndex) + 1}` : '');
      const isAway = Boolean(u.isAway);
      const actionText = u.isTyping ? 'Typing in costing sheet...' : (isAway ? 'Away (idle in other tab)' : (u.field ? 'Editing field' : 'Viewing page'));
      const statusColor = u.isTyping ? '#f59e0b' : (isAway ? '#9ca3af' : '#10b981');

      const avatarWrap = document.createElement('div');
      avatarWrap.className = 'vf-presence-avatar-wrap';
      avatarWrap.setAttribute('tabindex', '0');
      avatarWrap.setAttribute('role', 'button');
      avatarWrap.setAttribute('data-client-id', u.clientId || (u.user && u.user.clientId) || '');
      avatarWrap.setAttribute('title', isSelf ? 'Your active view' : `Click to jump to ${escapeHtml(name)}'s view`);

      avatarWrap.innerHTML = `
        <div class="vf-presence-avatar" style="background: ${color.bg}; color: ${color.fg}; box-shadow: 0 0 10px ${color.glow};">
          ${escapeHtml(initials)}
          <span class="vf-presence-status-dot ${u.isTyping ? 'typing' : ''}" style="${isAway ? 'background: #9ca3af; box-shadow: 0 0 4px #9ca3af;' : ''}"></span>
        </div>
        <div class="vf-presence-popover">
          <div class="vf-popover-header">
            <div class="vf-popover-avatar" style="background: ${color.bg}; color: ${color.fg};">
              ${escapeHtml(initials)}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div class="vf-popover-name">
                ${escapeHtml(name)}
                ${isSelf ? '<span class="vf-popover-self-chip">You</span>' : ''}
                ${isAway ? '<span class="vf-popover-self-chip" style="background: rgba(156,163,175,0.15); color: #6b7280;">Away</span>' : ''}
              </div>
              <div class="vf-popover-role">${escapeHtml(role)}</div>
            </div>
          </div>
          ${tabName || qualityName ? `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px;">
              ${tabName ? `<span class="vf-popover-tab-badge">📍 ${escapeHtml(tabName)}</span>` : ''}
              ${qualityName ? `<span class="vf-popover-tab-badge" style="background: rgba(16, 185, 129, 0.12); color: #059669; border-color: rgba(16, 185, 129, 0.25);">🧵 ${escapeHtml(qualityName)}</span>` : ''}
            </div>
          ` : ''}
          <div class="vf-popover-meta-row">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${statusColor};"></span>
            <span>${escapeHtml(actionText)}</span>
          </div>
        </div>
      `;

      avatarWrap.addEventListener('click', (e) => {
        e.stopPropagation();
        window.vfJumpToCollaborator(u);
      });

      avatarWrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.vfJumpToCollaborator(u);
        }
      });

      avatarWrap.addEventListener('mouseenter', () => {
        elevateAncestors(avatarWrap);
        positionPresencePopover(avatarWrap);
      });
      avatarWrap.addEventListener('mouseleave', () => {
        resetAncestorElevation(avatarWrap);
      });
      avatarWrap.addEventListener('focusin', () => {
        elevateAncestors(avatarWrap);
        positionPresencePopover(avatarWrap);
      });
      avatarWrap.addEventListener('focusout', () => {
        resetAncestorElevation(avatarWrap);
      });

      stack.appendChild(avatarWrap);
    });
  }

  window.addEventListener('supabase-presence', (e) => {
    if (presenceRenderRaf) cancelAnimationFrame(presenceRenderRaf);
    presenceRenderRaf = requestAnimationFrame(() => {
      presenceRenderRaf = null;
      renderPresenceBarUI(e.detail);
    });
  });

  // Automatically detect and broadcast active tab from URL params & tab clicks
  function detectActiveTab() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab') || urlParams.get('view') || '';
      if (tabParam) {
        window.__vf_active_tab = tabParam;
      }
    } catch(e) {}
  }
  detectActiveTab();

  document.addEventListener('click', (e) => {
    const tabEl = e.target.closest('[role="tab"], .tab-btn, .nav-tab, .sub-tab-btn, .main-tab-btn, button[data-tab], [data-view]');
    if (tabEl) {
      const tabVal = tabEl.dataset.tab || tabEl.dataset.view || tabEl.getAttribute('aria-controls') || tabEl.textContent.trim();
      if (tabVal && tabVal.length < 40) {
        window.__vf_active_tab = tabVal;
        if (window.VishwaSupabase && typeof window.VishwaSupabase.sendPresencePing === 'function') {
          window.VishwaSupabase.sendPresencePing(tabVal);
        }
      }
    }
  }, true);

  // 6. Global helper functions accessed by inline onclicks
  window._vfToggleFolder = function (btn) {
    if (document.documentElement.classList.contains('vf-sidebar-collapsed') && window.innerWidth > 768) {
      window._vfToggleSidebarCollapse();
      return;
    }
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    const wrapper = btn.nextElementSibling;
    if (wrapper) {
      wrapper.classList.toggle('open', !expanded);
      // Persist using the inner div's ID as key
      const inner = wrapper.querySelector('.vf-sb-accordion-inner[id]');
      if (inner && inner.id) {
        const openFolders = JSON.parse(localStorage.getItem('vf_sidebar_open_folders') || '{}');
        openFolders[inner.id] = !expanded;
        localStorage.setItem('vf_sidebar_open_folders', JSON.stringify(openFolders));
      }
    }
  };

  window._vfSetSidebarMode = function (mode) {
    localStorage.setItem('vishwa_fashions_sidebar_mode', mode);
    const yarnBtn = document.getElementById('vfModeYarnBtn');
    const weavingBtn = document.getElementById('vfModeWeavingBtn');
    if (yarnBtn && weavingBtn) {
      if (mode === 'yarn') {
        yarnBtn.classList.add('active');
        weavingBtn.classList.remove('active');
      } else {
        weavingBtn.classList.add('active');
        yarnBtn.classList.remove('active');
      }
    }
    const items = document.querySelectorAll('#vfSidebar [data-mode]');
    items.forEach(function (item) {
      if (item.classList.contains('vf-perm-hidden')) {
        item.style.setProperty('display', 'none', 'important');
        return;
      }
      const itemMode = item.getAttribute('data-mode');
      if (itemMode === 'common') {
        item.style.display = '';
      } else if (itemMode === mode) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
    updateSidebarIdentity();
  };

  window._vfToggleSidebarCollapse = function () {
    const html = document.documentElement;
    const isCollapsed = html.classList.toggle('vf-sidebar-collapsed');
    localStorage.setItem('vf_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    _vfUpdateSidebarCollapseBtn(isCollapsed);
  };

  function _vfUpdateSidebarCollapseBtn(isCollapsed) {
    const btn = document.getElementById('vfSidebarCollapseBtn');
    if (!btn) return;
    btn.setAttribute('title', isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
    const icon = btn.querySelector('.vf-sb-collapse-icon');
    if (icon) {
      if (isCollapsed) {
        icon.innerHTML = '<polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline>';
      } else {
        icon.innerHTML = '<polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline>';
      }
    }
  }

  function getFinancialYearForDate(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = date.getMonth();
    if (month >= 3) {
      return `${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `${year - 1}-${year.toString().slice(-2)}`;
    }
  }

  window._vfLogout = function () {
    try {
      if (window.VishwaSupabase && typeof window.VishwaSupabase.signOut === 'function') {
        window.VishwaSupabase.signOut();
      }
      localStorage.removeItem('vf_session');
      localStorage.removeItem('vf_user_name');
      localStorage.removeItem('vf_supabase_token');
      localStorage.removeItem('vf_supabase_session');
    } catch (e) { }
    window.location.href = rootPath ? (rootPath + 'index.html') : 'index.html';
  };

  // Precise Map of Sidebar Items & Tabs to Permission Keys
  const permKeyMap = {
    // RM Order Book
    'order-book': 'order-book.html',
    'order-book-entry': 'view=orders',
    'order-book-analytics': 'view=analytics',
    'order-book-heatmap': 'view=heat-map',

    // RM Weft Stock Book
    'rm-weft-stock-book': 'rm-weft-stock-book.html',
    'weft-ledger': 'tab=item-detail',
    'weft-beam-tracker': 'tab=item-ledger-v2',
    'weft-analytics': 'tab=challan-history',
    'weft-low-stock': 'tab=low-stock',
    'weft-log': 'tab=log',

    // RM Warp Stock Book
    'rm-warp-stock-book': 'rm-warp-stock-book.html',
    'warp-register': 'tab=register',
    'warp-ledger': 'tab=ledger',
    'warp-dashboard': 'tab=dashboard',
    'warp-tracker': 'tab=tracker',

    // Costing Sheet
    'costing-sheet': 'costing.html',
    'costing-fabric': 'weaving-costing.html?tab=fabric',
    'costing-compare-weaving': 'weaving-costing.html?tab=compare-weaving',
    'costing-tfo': 'yarn-costing.html?tab=tfo',
    'costing-doubler': 'yarn-costing.html?tab=doubler',
    'costing-covering': 'yarn-costing.html?tab=covering',
    'costing-compare-yarn': 'yarn-costing.html?tab=compare-yarn',

    // Standalone Yarn Pages
    'yarn-rm-stock': 'yarn-rm-stock.html',
    'yarn-production': 'yarn-production.html',
    'yarn-sales': 'yarn-sales.html',
    'yarn-stock-dashboard': 'yarn-stock-dashboard.html',

    // Weaving Production
    'weaving-production': 'weaving-production.html',
    'weaving-prod-analytics': 'tab=analytics',
    'weaving-prod-daily': 'tab=production',
    'weaving-prod-stock': 'tab=production-stock',

    // Dispatch Pipeline
    'dispatch': 'dispatch.html',
    'dispatch-pipeline': 'dispatch.html',
    'dispatch-outsource': 'outsourced',
    'dispatch-history': 'dispatchhistory',

    // Salary Sheet
    'salary-sheet': 'salary-sheet.html',
    'salary-overview': 'tab=dashboard-tab',
    'salary-karigar': 'tab=karigar-salary',
    'salary-beam-loading': 'tab=beam-loading-tab',
    'salary-loans': 'tab=tab-loans',

    // Standalone Pages
    'design-library': 'design-library.html',

    // Manage Masters
    'manage': 'manage.html',
    'manage-machines': 'tab=machines',
    'manage-looms': 'tab=looms',
    'manage-jacquards': 'tab=jacquards',
    'manage-jalas': 'tab=jalas',
    'manage-fanis': 'tab=fanis',
    'manage-machine-parts': 'machine-parts.html',
    'manage-staff': 'tab=staff',
    'manage-rm-qualities': 'tab=raw-material-qualities',
    'manage-rm-suppliers': 'tab=raw-material-suppliers',
    'manage-year-end': 'tab=year-end-rollover',

    // Tools & Gear Charts
    'ep-parser': 'ep-parser.html',
    'jacquard-castout-calculator': 'jacquard-castout-calculator.html',
    'gear': 'gear%20charts',
    'gear-national': 'national%20textile',
    'gear-shinkwang': 'shinkwang',
    'gear-doubler': 'doubler%20gear'
  };

  function applyViewOnlyEnforcer() {
    const sessRaw = localStorage.getItem('vf_session');
    if (!sessRaw) return;
    let activeSession = null;
    try { activeSession = JSON.parse(sessRaw); } catch (e) { }
    if (!activeSession || activeSession.role === 'admin' || !activeSession.permissions) return;

    const currentPath = window.location.pathname.toLowerCase().split('/').pop().split('?')[0];

    // Find current perm key for this page
    let currentPageKey = null;
    if (typeof permKeyMap !== 'undefined') {
      Object.keys(permKeyMap).forEach(key => {
        const target = permKeyMap[key].split('?')[0].toLowerCase();
        if (target.endsWith(currentPath) && currentPath !== '') {
          currentPageKey = key;
        }
      });
    }

    if (!currentPageKey) return;

    const isViewOnly = window.vfIsViewOnly(currentPageKey);
    if (isViewOnly) {
      document.body.classList.add('vf-view-only-mode');

      // Inject CSS for View Only mode if not already present
      if (!document.getElementById('vf-view-only-styles')) {
        const style = document.createElement('style');
        style.id = 'vf-view-only-styles';
        style.textContent = `
          .vf-view-only-mode .btn-primary:not(.vf-filter-btn):not(.vf-tab-btn):not(.btn-export):not(.search-btn),
          .vf-view-only-mode .save-btn,
          .vf-view-only-mode button[onclick*="save"]:not([onclick*="filter"]):not([onclick*="search"]),
          .vf-view-only-mode button[onclick*="create"],
          .vf-view-only-mode button[onclick*="delete"],
          .vf-view-only-mode button[onclick*="remove"],
          .vf-view-only-mode button[onclick*="add"]:not([onclick*="filter"]),
          .vf-view-only-mode button[onclick*="edit"],
          .vf-view-only-mode .action-icon-delete,
          .vf-view-only-mode .action-icon-edit,
          .vf-view-only-mode .ri-delete-bin-line,
          .vf-view-only-mode .ri-edit-line,
          .vf-view-only-mode .ri-add-line {
            display: none !important;
          }
          .vf-view-only-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 3px 10px;
            background: rgba(245, 158, 11, 0.15);
            color: #f59e0b;
            border: 1px solid rgba(245, 158, 11, 0.3);
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 700;
            margin-left: 0.75rem;
            vertical-align: middle;
          }
        `;
        document.head.appendChild(style);
      }

      // Insert View Only badge into header title if header exists
      const header = document.querySelector('.page-header, .header-title-area, .header-container, h1, h2');
      if (header && !document.querySelector('.vf-view-only-badge')) {
        const badge = document.createElement('span');
        badge.className = 'vf-view-only-badge';
        badge.innerHTML = '👁️ View Only Access';
        header.appendChild(badge);
      }
    }
  }

  function updateSidebarIdentity() {
    let activeSession = null;
    try {
      const sessRaw = localStorage.getItem('vf_session');
      if (sessRaw) activeSession = JSON.parse(sessRaw);
    } catch (e) { }

    let displayEmail = activeSession ? activeSession.email : null;
    if (!displayEmail && activeSession) {
      if (activeSession.username && activeSession.username.includes('@')) {
        displayEmail = activeSession.username;
      } else if (activeSession.name && activeSession.name.includes('@')) {
        displayEmail = activeSession.name;
      } else {
        try {
          const rawAdmins = localStorage.getItem('vf_admin_users');
          if (rawAdmins) {
            const list = JSON.parse(rawAdmins);
            if (Array.isArray(list) && list.length > 0 && list[0].email) {
              displayEmail = list[0].email;
            }
          }
        } catch (e) { }
        if (!displayEmail) {
          try {
            const cfgRaw = localStorage.getItem('vf_auth_config');
            if (cfgRaw) {
              const cfg = JSON.parse(cfgRaw);
              if (cfg.admin_email) displayEmail = cfg.admin_email;
            }
          } catch (e) { }
        }
        if (!displayEmail && activeSession.role === 'admin') {
          displayEmail = 'admin@vishwafashions.com';
        }
      }
      if (displayEmail && activeSession) {
        activeSession.email = displayEmail;
        if (activeSession.name === 'Master Admin') activeSession.name = displayEmail;
        if (activeSession.username === 'Master Admin') activeSession.username = displayEmail;
        try { localStorage.setItem('vf_session', JSON.stringify(activeSession)); } catch (e) { }
      }
    }

    let savedUser = displayEmail || (activeSession ? (activeSession.name || activeSession.username) : localStorage.getItem('vf_user_name'));
    if (savedUser === 'Master Admin') {
      savedUser = displayEmail || 'admin@vishwafashions.com';
    }

    const userNameEl = document.getElementById('vfSbUserName');
    const userAvatarEl = document.getElementById('vfSbUserAvatar');
    const userRoleEl = document.getElementById('vfSbUserRole');

    if (userNameEl) {
      userNameEl.textContent = savedUser || 'Operator';
      if (userAvatarEl) {
        userAvatarEl.textContent = (savedUser || 'O').charAt(0).toUpperCase();
      }
      if (userRoleEl) {
        const isAdmin = activeSession && activeSession.role === 'admin';
        userRoleEl.textContent = displayEmail || (isAdmin ? 'Admin' : (activeSession ? 'Employee' : 'Operator'));
        userRoleEl.style.background = isAdmin ? 'rgba(236,72,153,0.15)' : 'rgba(139,92,246,0.15)';
        userRoleEl.style.color = isAdmin ? 'var(--accent2, #ec4899)' : 'var(--accent, #8b5cf6)';
      }
    }

    // Apply active user's individual theme preference
    if (typeof window._vfGetTheme === 'function') {
      const isDark = window._vfGetTheme();
      if (isDark) {
        document.documentElement.classList.add('dark-mode');
        document.body.classList.add('dark-mode');
      } else {
        document.documentElement.classList.remove('dark-mode');
        document.body.classList.remove('dark-mode');
      }
    }

    // Strict Navigation & Page Permission Guard for Non-Admin Sessions
    if (activeSession && activeSession.role !== 'admin' && activeSession.permissions && typeof activeSession.permissions === 'object') {
      const perms = activeSession.permissions;
      const currentPath = window.location.pathname.toLowerCase();

      // 1. Hide restricted links permanently with .vf-perm-hidden
      document.querySelectorAll('.vf-sb-link').forEach(link => {
        const href = (link.getAttribute('href') || '').toLowerCase();

        Object.keys(permKeyMap).forEach(key => {
          if (perms[key] === 'none' || perms[key] === false) {
            const target = permKeyMap[key].toLowerCase();
            if (href.includes(target) ||
              (key === 'costing-sheet' && (href.includes('weaving-costing') || href.includes('yarn-costing'))) ||
              (key === 'dispatch' && href.includes('dispatch'))) {
              link.classList.add('vf-perm-hidden');
              link.style.setProperty('display', 'none', 'important');
            }
          }
        });
      });

      // 2. Hide accordion folder buttons if folder key is restricted OR if all child links inside are hidden
      document.querySelectorAll('.vf-sb-folder').forEach(folder => {
        const text = (folder.textContent || '').toLowerCase();
        let folderKey = null;

        if (text.includes('order book')) folderKey = 'order-book';
        else if (text.includes('weft stock')) folderKey = 'rm-weft-stock-book';
        else if (text.includes('warp stock')) folderKey = 'rm-warp-stock-book';
        else if (text.includes('costing sheet')) folderKey = 'costing-sheet';
        else if (text.includes('weaving production')) folderKey = 'weaving-production';
        else if (text.includes('dispatch pipeline')) folderKey = 'dispatch';
        else if (text.includes('salary sheet')) folderKey = 'salary-sheet';
        else if (text.includes('manage')) folderKey = 'manage';
        else if (text.includes('gear charts')) folderKey = 'gear';

        const accordionWrap = folder.nextElementSibling;
        const isFolderRestricted = folderKey && (perms[folderKey] === 'none' || perms[folderKey] === false);

        let allChildrenHidden = false;
        if (accordionWrap && accordionWrap.classList.contains('vf-sb-accordion-wrapper')) {
          const links = accordionWrap.querySelectorAll('.vf-sb-link');
          if (links.length > 0) {
            allChildrenHidden = Array.from(links).every(l => l.classList.contains('vf-perm-hidden') || l.style.display === 'none');
          }
        }

        if (isFolderRestricted || allChildrenHidden) {
          folder.classList.add('vf-perm-hidden');
          folder.style.setProperty('display', 'none', 'important');
          if (accordionWrap && accordionWrap.classList.contains('vf-sb-accordion-wrapper')) {
            accordionWrap.classList.add('vf-perm-hidden');
            accordionWrap.style.setProperty('display', 'none', 'important');
          }
        }
      });

      // 3. Enforce Page-Level Access Guard: Quietly redirect away from restricted pages
      Object.keys(permKeyMap).forEach(key => {
        const pageTarget = permKeyMap[key].split('?')[0].toLowerCase();
        const currentFile = currentPath.split('/').pop().split('?')[0];
        if ((perms[key] === 'none' || perms[key] === false) && pageTarget.endsWith('.html') && currentFile === pageTarget) {
          // Find first permitted page
          const firstAllowedKey = Object.keys(permKeyMap).find(k => perms[k] !== 'none' && perms[k] !== false && permKeyMap[k].endsWith('.html'));
          let redirectTarget = rootPath ? (rootPath + 'index.html') : '../../index.html';

          if (firstAllowedKey) {
            redirectTarget = rootPath ? (rootPath + permKeyMap[firstAllowedKey]) : ('../../' + permKeyMap[firstAllowedKey]);
          }

          // Quiet redirect without popup alert
          window.location.href = redirectTarget;
        }
      });
    }

    let groupName = localStorage.getItem('vf_group_name');
    if (!groupName || !groupName.trim()) {
      groupName = 'Vishwa Atelier';
    } else {
      groupName = groupName.trim();
    }
    const brandFullEl = document.querySelector('.vf-sb-brand .brand-full');
    const brandMiniEl = document.querySelector('.vf-sb-brand .brand-mini');
    const subtitleEl = document.querySelector('.vf-sb-subtitle');
    if (brandFullEl) brandFullEl.textContent = groupName;
    if (brandMiniEl) {
      const initials = groupName.split(' ').filter(Boolean).map(w => w.charAt(0)).join('').toUpperCase().slice(0, 3);
      brandMiniEl.textContent = initials || 'VA';
    }
    if (subtitleEl) subtitleEl.textContent = 'Management Suite';

    applyViewOnlyEnforcer();
    setupSidebarUserBadgeHover();
  }

  function setupSidebarUserBadgeHover() {
    const badge = document.getElementById('vfSbUserBadge');
    if (!badge) return;

    let popover = document.getElementById('vfSbFloatingUserPopover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'vfSbFloatingUserPopover';
      popover.className = 'vf-sb-floating-popover';
      document.body.appendChild(popover);
    }

    let hideTimeout = null;

    function showPopover() {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      let activeSession = null;
      try {
        const sessRaw = localStorage.getItem('vf_session');
        if (sessRaw) activeSession = JSON.parse(sessRaw);
      } catch (e) { }

      const nameEl = document.getElementById('vfSbUserName');
      const roleEl = document.getElementById('vfSbUserRole');
      const userName = (nameEl ? nameEl.textContent : '') || (activeSession ? (activeSession.name || activeSession.username) : 'Operator');
      const userRole = (roleEl ? roleEl.textContent : '') || (activeSession ? activeSession.role : 'Operator');
      const userEmail = (activeSession && activeSession.email) || (userName.includes('@') ? userName : (activeSession ? activeSession.username : ''));
      const initial = (userName || 'O').charAt(0).toUpperCase();
      const isAdmin = (activeSession && activeSession.role === 'admin') || userRole.toLowerCase().includes('admin');
      const roleBg = isAdmin ? 'rgba(236,72,153,0.15)' : 'rgba(139,92,246,0.15)';
      const roleColor = isAdmin ? 'var(--accent2, #ec4899)' : 'var(--accent, #8b5cf6)';
      const isDark = document.documentElement.classList.contains('dark-mode');

      popover.innerHTML = `
        <div class="vf-sb-popover-header">
          <div class="vf-sb-popover-avatar">${escapeHtml(initial)}</div>
          <div class="vf-sb-popover-meta">
            <div class="vf-sb-popover-name">${escapeHtml(userName)}</div>
            ${userEmail && userEmail !== userName ? `<div class="vf-sb-popover-email">${escapeHtml(userEmail)}</div>` : ''}
          </div>
        </div>
        <div class="vf-sb-popover-divider"></div>
        <div class="vf-sb-popover-row">
          <span class="vf-sb-popover-label">Access Role</span>
          <span class="vf-sb-popover-badge" style="background: ${roleBg}; color: ${roleColor}; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem;">${escapeHtml(userRole)}</span>
        </div>
        <div class="vf-sb-popover-row">
          <span class="vf-sb-popover-label">Status</span>
          <span class="vf-sb-popover-status" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; color: #10b981; font-weight: 600;">
            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px #10b981;"></span>
            Active Session
          </span>
        </div>
        <div class="vf-sb-popover-row">
          <span class="vf-sb-popover-label">Theme</span>
          <span style="font-size: 0.72rem; color: var(--muted, #64748b); font-weight: 600;">${isDark ? '🌙 Dark Mode' : '☀️ Light Mode'}</span>
        </div>
        <div class="vf-sb-popover-footer" style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.06); display: flex; justify-content: flex-end;">
          <button type="button" onclick="_vfLogout()" style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #ef4444; font-size: 0.72rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>
      `;

      const rect = badge.getBoundingClientRect();
      popover.style.display = 'block';
      popover.style.position = 'fixed';
      popover.style.zIndex = '2147483647';

      // Position to the right of sidebar or below if narrow
      if (rect.right + 260 <= window.innerWidth) {
        popover.style.left = `${rect.right + 10}px`;
        popover.style.top = `${Math.max(10, Math.min(rect.top, window.innerHeight - 240))}px`;
      } else {
        popover.style.left = `${Math.max(10, rect.left)}px`;
        popover.style.top = `${rect.bottom + 8}px`;
      }

      requestAnimationFrame(() => {
        popover.classList.add('active');
      });
    }

    function hidePopover() {
      hideTimeout = setTimeout(() => {
        popover.classList.remove('active');
        setTimeout(() => {
          if (!popover.classList.contains('active')) {
            popover.style.display = 'none';
          }
        }, 200);
      }, 150);
    }

    if (!badge.__vfHoverAttached) {
      badge.__vfHoverAttached = true;
      badge.addEventListener('mouseenter', showPopover);
      badge.addEventListener('mouseleave', hidePopover);
      badge.addEventListener('focusin', showPopover);
      badge.addEventListener('focusout', hidePopover);
      popover.addEventListener('mouseenter', () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      });
      popover.addEventListener('mouseleave', hidePopover);
    }
  }

  // Listen to storage changes and page focus to keep identity updated live
  window.addEventListener('storage', updateSidebarIdentity);
  window.addEventListener('focus', updateSidebarIdentity);

  function initSidebarLogic() {
    // Populate User Name and Company Name from localStorage
    updateSidebarIdentity();
    applyViewOnlyEnforcer();
    setupSidebarUserBadgeHover();

    // Populate Financial Year Selector
    const select = document.getElementById('vfSidebarFYSelect');
    if (select) {
      const years = new Set();
      const currentFY = getFinancialYearForDate(new Date().toISOString().slice(0, 10));
      if (currentFY) years.add(currentFY);

      try {
        const orders = JSON.parse(localStorage.getItem('yarn-orders') || '[]');
        orders.forEach(o => {
          if (o.orderDate) {
            const fy = getFinancialYearForDate(o.orderDate);
            if (fy) years.add(fy);
          }
          (o.batches || []).forEach(b => {
            if (b.receiveDate) {
              const fy = getFinancialYearForDate(b.receiveDate);
              if (fy) years.add(fy);
            }
          });
        });
      } catch (e) { console.warn('Error parsing yarn-orders for FY:', e); }

      try {
        const issues = JSON.parse(localStorage.getItem('yarn-issues') || '[]');
        issues.forEach(i => {
          if (i.date) {
            const fy = getFinancialYearForDate(i.date);
            if (fy) years.add(fy);
          }
        });
      } catch (e) { console.warn('Error parsing yarn-issues for FY:', e); }

      try {
        const warpIssues = JSON.parse(localStorage.getItem('warp-issues') || '[]');
        warpIssues.forEach(i => {
          if (i.date) {
            const fy = getFinancialYearForDate(i.date);
            if (fy) years.add(fy);
          }
        });
      } catch (e) { console.warn('Error parsing warp-issues for FY:', e); }

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('todo_book_planner_')) {
            const todoStore = JSON.parse(localStorage.getItem(key) || '{}');
            if (todoStore && typeof todoStore === 'object') {
              Object.keys(todoStore).forEach(dateStr => {
                if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                  const fy = getFinancialYearForDate(dateStr);
                  if (fy) years.add(fy);
                }
              });
            }
          }
        }
      } catch (e) { console.warn('Error parsing todo stores for FY:', e); }

      const sortedYears = Array.from(years).sort().reverse();
      select.innerHTML = '<option value="All">All Years</option>' +
        sortedYears.map(fy => `<option value="${fy}">FY ${fy}</option>`).join('');

      const defaultFY = currentFY || 'All';
      select.value = defaultFY;
      localStorage.setItem('vishwa_fashions_selected_fy', defaultFY);

      // Dispatch immediately on load so pages pick up the default FY
      if (window.FYEngine && window.FYEngine.autoCarryForward) {
        window.FYEngine.autoCarryForward(defaultFY);
      }
      window.dispatchEvent(new CustomEvent('fyChanged', { detail: { fy: defaultFY } }));

      select.addEventListener('change', function () {
        const selVal = select.value;
        localStorage.setItem('vishwa_fashions_selected_fy', selVal);
        if (window.FYEngine && window.FYEngine.autoCarryForward) {
          window.FYEngine.autoCarryForward(selVal);
        }
        window.dispatchEvent(new CustomEvent('fyChanged', { detail: { fy: selVal } }));
      });
    }

    // Mobile Sidebar controls
    const sidebar = document.getElementById('vfSidebar');
    const toggleBtn = document.getElementById('vfSbToggle');
    const overlay = document.getElementById('vfSbOverlay');
    if (toggleBtn && sidebar && overlay) {
      const setDrawerOpen = (open) => {
        sidebar.classList.toggle('open', open);
        toggleBtn.classList.toggle('open', open);
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        overlay.classList.toggle('visible', open);
        if (open && window.innerWidth <= 1024) {
          document.body.style.overflow = 'hidden';
        } else {
          document.body.style.overflow = '';
        }
      };
      toggleBtn.addEventListener('click', function () {
        setDrawerOpen(!sidebar.classList.contains('open'));
      });

      overlay.addEventListener('click', function () {
        setDrawerOpen(false);
      });

      // Swipe to close on mobile
      let touchStartX = 0;
      let touchStartY = 0;
      sidebar.addEventListener('touchstart', function (e) {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      sidebar.addEventListener('touchend', function (e) {
        if (e.changedTouches.length === 1 && sidebar.classList.contains('open')) {
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY);
          // Swipe left > 60px with minimal vertical drift closes drawer
          if (deltaX < -60 && deltaY < 80) {
            setDrawerOpen(false);
          }
        }
      }, { passive: true });

      // Clean up drawer states if window is resized above tablet breakpoint
      window.addEventListener('resize', function () {
        if (window.innerWidth > 1024) {
          if (sidebar.classList.contains('open') || toggleBtn.classList.contains('open') || overlay.classList.contains('visible')) {
            setDrawerOpen(false);
          }
        }
      });
    }

    // Set titles on links/folders for collapsed state tooltip
    document.querySelectorAll('.vf-sb-link, .vf-sb-folder').forEach(function (el) {
      let text = el.innerText || el.textContent;
      text = text.replace(/[\n\r]/g, '').trim();
      if (text && !el.getAttribute('title')) {
        el.setAttribute('title', text);
      }
    });

    // Initialize collapse toggle button state
    const isCollapsed = document.documentElement.classList.contains('vf-sidebar-collapsed');
    _vfUpdateSidebarCollapseBtn(isCollapsed);

    // Initialize Sidebar Mode
    const currentPath = window.location.pathname.toLowerCase();
    let savedMode = localStorage.getItem('vishwa_fashions_sidebar_mode');
    if (currentPath.includes('/modules/yarn/') || currentPath.includes('yarn-')) {
      savedMode = 'yarn';
      localStorage.setItem('vishwa_fashions_sidebar_mode', 'yarn');
    } else if (currentPath.includes('/modules/weaving/') || currentPath.includes('weaving-')) {
      savedMode = 'weaving';
      localStorage.setItem('vishwa_fashions_sidebar_mode', 'weaving');
    } else if (!savedMode) {
      savedMode = 'weaving';
    }
    window._vfSetSidebarMode(savedMode);

    // Restore previously open folders
    const openFolders = JSON.parse(localStorage.getItem('vf_sidebar_open_folders') || '{}');
    Object.entries(openFolders).forEach(([id, isOpen]) => {
      const inner = document.getElementById(id);
      if (!inner) return;
      const wrapper = inner.parentElement; // the vf-sb-accordion-wrapper
      if (!wrapper) return;
      wrapper.classList.toggle('open', isOpen);
      const folderBtn = wrapper.previousElementSibling;
      if (folderBtn && folderBtn.classList.contains('vf-sb-folder')) {
        folderBtn.setAttribute('aria-expanded', String(isOpen));
      }
    });

    // Highlight active navigation link and open its folders
    highlightActiveLink();

    // Hook up transitions for page switches
    initLinkTransitionListeners();
  }

  function highlightActiveLink() {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const currentSearch = window.location.search;
    let bestMatch = null;
    let bestMatchScore = -1;

    document.querySelectorAll('.vf-sb-link').forEach(link => {
      const hrefAttr = link.getAttribute('href');
      if (!hrefAttr) return;

      const [hrefPath, hrefQuery] = hrefAttr.split('?');
      const linkPathName = hrefPath.split('/').pop();

      if (linkPathName === currentPath) {
        let score = 1;
        if (hrefQuery && currentSearch) {
          const currentParams = new URLSearchParams(currentSearch);
          const linkParams = new URLSearchParams(hrefQuery);
          const exactMatch = [...linkParams.entries()].every(([k, v]) => currentParams.get(k) === v);
          if (exactMatch) score = 3;
        } else if (!hrefQuery && !currentSearch) {
          score = 2;
        }
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatch = link;
        }
      }
    });

    if (bestMatch) {
      bestMatch.classList.add('active');
      let parent = bestMatch.parentElement;
      while (parent && parent.id !== 'vfSidebar') {
        if (parent.classList.contains('vf-sb-accordion-wrapper')) {
          parent.classList.add('open');
          const folderBtn = parent.previousElementSibling;
          if (folderBtn && folderBtn.classList.contains('vf-sb-folder')) {
            folderBtn.setAttribute('aria-expanded', 'true');
          }
        }
        parent = parent.parentElement;
      }
    }
  }

  // Intercept links to trigger loading transition before page unload
  function initLinkTransitionListeners() {
    document.addEventListener('click', function (e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || link.getAttribute('target') === '_blank') {
        return;
      }

      if (e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) {
        return;
      }

      try {
        const linkUrl = new URL(link.href, window.location.href);
        if (linkUrl.origin !== window.location.origin) {
          return;
        }

        if (linkUrl.pathname === window.location.pathname && linkUrl.search === window.location.search && linkUrl.hash === window.location.hash) {
          return;
        }

        e.preventDefault();
        window.location.href = link.href;
      } catch (err) { }
    });
  }

  // Listen to bfcache restore
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      document.body.classList.add('vf-loaded');
      document.documentElement.classList.add('vf-loaded');
    }
  });

  // Inject Bootstrap Icons & Premium Toast CSS
  (function injectToastResources() {
    if (!document.querySelector('link[href*="bootstrap-icons"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css';
      document.head.appendChild(link);
    }

    const toastStyle = document.createElement('style');
    toastStyle.innerHTML = `
      .toast-container {
        position: fixed;
        top: 25px;
        right: 25px;
        left: auto;
        bottom: auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
        z-index: 999999;
        pointer-events: none;
        max-width: min(420px, calc(100vw - 2rem));
        width: max-content;
        box-sizing: border-box;
      }
      .toast-container .toast {
        pointer-events: auto;
      }
      .toast {
        position: relative;
        width: 420px;
        max-width: 100%;
        overflow: hidden;
        display: flex;
        align-items: center;
        gap: 18px;
        padding: 18px 22px;
        color: #fff !important;
        border-radius: 18px;
        backdrop-filter: blur(18px);
        animation: toastPopup .45s ease;
        box-sizing: border-box;
      }
      .toast *, .toast p, .toast span, .toast a, .toast h4 {
        color: #ffffff !important;
      }
      @media (max-width: 640px) {
        .toast-container {
          top: 16px;
          right: 16px;
          left: 16px;
          max-width: none;
          width: auto;
        }
        .toast {
          width: 100%;
        }
      }
      .toast::before {
        content: "";
        position: absolute;
        inset: -50%;
        background: radial-gradient(circle, rgba(255,255,255,.08), transparent 65%);
        animation: toastRotateGlow 8s linear infinite;
        pointer-events: none;
      }
      .toast.success {
        background: linear-gradient(135deg, #166534 0%, #15803d 50%, #16a34a 100%) !important;
        box-shadow: 0 15px 45px rgba(34,197,94,.35), inset 0 1px 0 rgba(255,255,255,.12) !important;
      }
      .toast.error {
        background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 50%, #dc2626 100%) !important;
        box-shadow: 0 15px 45px rgba(239,68,68,.35), inset 0 1px 0 rgba(255,255,255,.12) !important;
      }
      .toast.info {
        background: linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #3b82f6 100%) !important;
        box-shadow: 0 15px 45px rgba(59,130,246,.35), inset 0 1px 0 rgba(255,255,255,.12) !important;
      }
      .toast .icon {
        position: relative;
        z-index: 2;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgba(255,255,255,.14) !important;
        border: 1px solid rgba(255,255,255,.18) !important;
        flex-shrink: 0;
      }
      .toast .icon i {
        font-size: 30px;
        color: #fff !important;
      }
      .toast .content {
        position: relative;
        z-index: 2;
        flex: 1;
      }
      .toast .content h4 {
        font-size: 18px !important;
        font-weight: 700 !important;
        margin: 0 0 6px 0 !important;
        color: #fff !important;
        line-height: 1.2 !important;
      }
      .toast .content p {
        opacity: .9 !important;
        font-size: 13px !important;
        color: #fff !important;
        margin: 0 !important;
        line-height: 1.4 !important;
      }
      .toast .close {
        position: relative;
        z-index: 2;
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        cursor: pointer;
        transition: .3s;
        flex-shrink: 0;
      }
      .toast .close:hover {
        background: rgba(255,255,255,.12) !important;
        transform: rotate(90deg);
      }
      .toast .close i {
        font-size: 22px;
        color: #fff !important;
      }
      .toast .progress {
        position: absolute;
        left: 0;
        bottom: 0;
        width: 100%;
        height: 5px;
        background: rgba(255,255,255,.18) !important;
      }
      .toast .progress::after {
        content: "";
        position: absolute;
        inset: 0;
        transform-origin: left;
        transform: scaleX(0);
        animation: toastFill 5s linear forwards;
      }
      .toast.success .progress::after {
        background: #d9ffe5 !important;
      }
      .toast.error .progress::after {
        background: #fecaca !important;
      }
      .toast.info .progress::after {
        background: #dbeafe !important;
      }
      @keyframes toastFill {
        to { transform: scaleX(1); }
      }
      @keyframes toastPopup {
        from {
          opacity: 0;
          transform: translateX(50px) scale(.9);
        }
        to {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }
      @keyframes toastRotateGlow {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .toast .confirm-btn {
        background: rgba(255, 255, 255, 0.2) !important;
        border: 1px solid rgba(255, 255, 255, 0.4) !important;
        padding: 6px 16px !important;
        border-radius: 8px !important;
        color: #fff !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        font-size: 13px !important;
        transition: .2s !important;
      }
      .toast .confirm-btn:hover {
        background: rgba(255, 255, 255, 0.35) !important;
      }
      .toast .cancel-btn {
        background: transparent !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        padding: 6px 16px !important;
        border-radius: 8px !important;
        color: rgba(255, 255, 255, 0.8) !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        font-size: 13px !important;
        transition: .2s !important;
      }
      .toast .cancel-btn:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        color: #fff !important;
      }
    `;
    document.head.appendChild(toastStyle);
  })();
  window.showToast = function (message, type = 'info', title = '') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    let defaultTitle = 'Notification';
    let iconClass = 'bi bi-info-circle-fill';
    if (type === 'success') {
      defaultTitle = 'Congratulations';
      iconClass = 'bi bi-check-circle-fill';
    } else if (type === 'error') {
      defaultTitle = 'Action Failed';
      iconClass = 'bi bi-x-circle-fill';
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="icon">
        <i class="${iconClass}"></i>
      </div>
      <div class="content">
        ${title ? `<h4>${title}</h4>` : ''}
        <p>${message}</p>
      </div>
      <div class="close">
        <i class="bi bi-x-lg"></i>
      </div>
      <div class="progress"></div>
    `;

    toast.querySelector('.close').addEventListener('click', () => {
      toast.remove();
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.animation = 'toastPopup 0.45s ease reverse forwards';
        setTimeout(() => {
          toast.remove();
        }, 450);
      }
    }, 5000);
  };

  window.showConfirmToast = function (message, onConfirm, onCancel, title = 'Confirm Action') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast info';
    toast.innerHTML = `
      <div class="icon">
        <i class="bi bi-question-circle-fill"></i>
      </div>
      <div class="content">
        <h4>${title}</h4>
        <p>${message}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button class="confirm-btn">Confirm</button>
          <button class="cancel-btn">Cancel</button>
        </div>
      </div>
      <div class="close">
        <i class="bi bi-x-lg"></i>
      </div>
    `;

    const closeToast = () => {
      toast.style.animation = 'toastPopup 0.45s ease reverse forwards';
      setTimeout(() => {
        toast.remove();
      }, 450);
    };

    toast.querySelector('.confirm-btn').addEventListener('click', () => {
      closeToast();
      if (typeof onConfirm === 'function') onConfirm();
    });

    toast.querySelector('.cancel-btn').addEventListener('click', () => {
      closeToast();
      if (typeof onCancel === 'function') onCancel();
    });

    toast.querySelector('.close').addEventListener('click', () => {
      closeToast();
      if (typeof onCancel === 'function') onCancel();
    });

    container.appendChild(toast);
  };

  window.openCutBeamModal = function (options) {
    const { beamNumber, machineName, beamType, onConfirm } = options || {};
    const today = new Date().toISOString().substring(0, 10);
    const mDisp = machineName ? (String(machineName).toLowerCase().includes('machine') ? machineName : `Machine ${machineName}`) : 'Machine';

    // Calculate Max Date Limit (Tomorrow)
    const tomorrowObj = new Date();
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrowStr = tomorrowObj.toISOString().substring(0, 10);

    // Calculate Min Date Limit (Last Production Date or Load Date for this beam)
    let lastProdDate = null;
    if (beamNumber) {
      try {
        const prodLogs = JSON.parse(localStorage.getItem('production-logs') || '[]');
        prodLogs.forEach(l => {
          if (String(l.beamNumber).trim() === String(beamNumber).trim()) {
            const pDate = l.productionDate || l.pissingDate || l.date;
            if (pDate && (!lastProdDate || pDate > lastProdDate)) {
              lastProdDate = pDate;
            }
          }
        });
      } catch (e) { }

      if (!lastProdDate) {
        try {
          const allBeams = JSON.parse(localStorage.getItem('warp-beams') || '[]');
          const targetB = allBeams.find(b => String(b.beamNumber).trim() === String(beamNumber).trim());
          if (targetB && Array.isArray(targetB.history)) {
            for (let i = targetB.history.length - 1; i >= 0; i--) {
              const h = targetB.history[i];
              const e = (h.event || '').toLowerCase();
              if (e.includes('loaded') || e.includes('piecing') || e.includes('pissing')) {
                lastProdDate = h.date;
                break;
              }
            }
            if (!lastProdDate && targetB.createdAt) {
              lastProdDate = targetB.createdAt;
            }
          }
        } catch (e) { }
      }
    }

    const formatDateDDMMYYYY = (dateStr) => {
      if (!dateStr) return '—';
      const parts = dateStr.split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return dateStr;
    };

    const formattedLastProdDate = lastProdDate ? formatDateDDMMYYYY(lastProdDate) : 'None';

    const overlay = document.createElement('div');
    overlay.id = 'cut-beam-modal-overlay';
    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 2147483647; padding: 1rem;';

    overlay.innerHTML = `
      <div style="background: var(--surface, #1e293b); border: 1px solid var(--border, #334155); border-top: 4px solid #ef4444; border-radius: 16px; padding: 1.75rem; width: 100%; max-width: 440px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); color: var(--fg, #f8fafc); font-family: var(--font-body), sans-serif; position: relative;">
        <button type="button" class="cut-beam-close-btn" style="position: absolute; top: 1rem; right: 1rem; background: transparent; border: none; font-size: 1.25rem; cursor: pointer; color: var(--muted, #94a3b8);">&times;</button>
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #ef4444; font-family: var(--font-display), sans-serif; display: flex; align-items: center; gap: 0.5rem;">
          <i class="ri-scissors-cut-line" style="font-size: 1.3rem;"></i> Cut Beam #${beamNumber || ''}
        </h3>
        <p style="margin: 0 0 1.25rem 0; font-size: 0.85rem; color: var(--muted, #94a3b8); line-height: 1.4;">
          Unloading beam from <strong>${mDisp}</strong>. Please enter the cut date and reason for cut.
        </p>
          <form class="cut-beam-form">
          <div style="margin-bottom: 1rem;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: var(--muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Date of Cut</label>
            <input type="date" class="cut-beam-date-input" value="${today}" min="${lastProdDate || ''}" max="${tomorrowStr}" required style="width: 100%; padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid var(--border, #334155); background: rgba(0,0,0,0.2); color: var(--fg, #f8fafc); font-size: 0.9rem; outline: none; box-sizing: border-box; color-scheme: dark;">
            <div style="font-size: 0.75rem; color: var(--muted, #94a3b8); margin-top: 0.35rem; font-weight: 600;">
              Last Production Date: <span style="color: var(--fg, #f8fafc); font-weight: 700;">${formattedLastProdDate}</span>
            </div>
            <div class="cut-beam-date-warning" style="display: none; font-size: 0.72rem; color: #ef4444; font-weight: 700; margin-top: 0.35rem; background: rgba(239, 68, 68, 0.1); padding: 0.35rem 0.6rem; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.3);"></div>
          </div>
          
          <div style="margin-bottom: 1rem;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: var(--muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Reason for Cut</label>
            <select class="cut-beam-reason-preset" style="width: 100%; padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid var(--border, #334155); background: var(--surface, #1e293b); color: var(--fg, #f8fafc); font-size: 0.88rem; outline: none; box-sizing: border-box; cursor: pointer;">
              <option value="Beam Exhausted / Completed">Beam Exhausted / Completed</option>
              <option value="Pattern / Quality Change">Pattern / Quality Change</option>
              <option value="Yarn Tension / Defect Issue">Yarn Tension / Defect Issue</option>
              <option value="Loom Maintenance / Mechanical Damage">Loom Maintenance / Mechanical Damage</option>
              <option value="Other">Other (Specify custom reason)</option>
            </select>
            <input type="text" class="cut-beam-reason-custom" placeholder="Type custom reason..." style="display: none; margin-top: 0.5rem; width: 100%; padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid var(--border, #334155); background: rgba(0,0,0,0.2); color: var(--fg, #f8fafc); font-size: 0.88rem; outline: none; box-sizing: border-box;">
          </div>

          <div style="margin-bottom: 1.5rem;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: var(--muted, #94a3b8); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem;">Decision Made By</label>
            <input type="text" class="cut-beam-decision-by" placeholder="Enter name / person responsible" style="width: 100%; padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid var(--border, #334155); background: rgba(0,0,0,0.2); color: var(--fg, #f8fafc); font-size: 0.88rem; outline: none; box-sizing: border-box;">
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
            <button type="button" class="btn-cancel" style="padding: 0.6rem 1.1rem; border-radius: 8px; border: 1px solid var(--border, #334155); background: transparent; color: var(--fg, #f8fafc); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; cursor: pointer;">Cancel</button>
            <button type="submit" class="btn-confirm" style="padding: 0.6rem 1.25rem; border-radius: 8px; border: none; background: #ef4444; color: #ffffff; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; cursor: pointer; box-shadow: 0 4px 12px rgba(239,68,68,0.3);">Confirm Cut</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const presetSelect = overlay.querySelector('.cut-beam-reason-preset');
    const customInput = overlay.querySelector('.cut-beam-reason-custom');
    const dateInputEl = overlay.querySelector('.cut-beam-date-input');
    const warningEl = overlay.querySelector('.cut-beam-date-warning');

    const validateDateInput = () => {
      const val = dateInputEl.value;
      if (!val) return;
      const isTooEarly = lastProdDate && val < lastProdDate;
      const isTooLate = val > tomorrowStr;

      if (isTooEarly || isTooLate) {
        dateInputEl.style.background = 'rgba(148, 163, 184, 0.25)';
        dateInputEl.style.color = '#94a3b8';
        dateInputEl.style.borderColor = '#ef4444';
        if (warningEl) {
          warningEl.style.display = 'block';
          warningEl.textContent = isTooEarly 
            ? `⚠️ Date ${formatDateDDMMYYYY(val)} is before last production date (${formattedLastProdDate}) [Greyed Out / Unselectable]` 
            : `⚠️ Date ${formatDateDDMMYYYY(val)} is after tomorrow (${formatDateDDMMYYYY(tomorrowStr)}) [Greyed Out / Unselectable]`;
        }
      } else {
        dateInputEl.style.background = 'rgba(0,0,0,0.2)';
        dateInputEl.style.color = 'var(--fg, #f8fafc)';
        dateInputEl.style.borderColor = 'var(--border, #334155)';
        if (warningEl) warningEl.style.display = 'none';
      }
    };

    dateInputEl.addEventListener('input', validateDateInput);
    dateInputEl.addEventListener('change', validateDateInput);

    presetSelect.addEventListener('change', () => {
      if (presetSelect.value === 'Other') {
        customInput.style.display = 'block';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
      }
    });

    const closeModal = () => {
      overlay.remove();
    };

    overlay.querySelector('.cut-beam-close-btn').addEventListener('click', closeModal);
    overlay.querySelector('.btn-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelector('.cut-beam-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const cutDate = overlay.querySelector('.cut-beam-date-input').value || today;
      if (lastProdDate && cutDate < lastProdDate) {
        const minDisp = formatDateDDMMYYYY(lastProdDate);
        const cutDisp = formatDateDDMMYYYY(cutDate);
        if (typeof window.showToast === 'function') {
          window.showToast(`Invalid Date! Date of cut (${cutDisp}) cannot be before last production date (${minDisp}).`, 'error');
        } else {
          alert(`Invalid Date! Date of cut (${cutDisp}) cannot be before last production date (${minDisp}).`);
        }
        return;
      }
      if (cutDate > tomorrowStr) {
        const maxDisp = formatDateDDMMYYYY(tomorrowStr);
        const cutDisp = formatDateDDMMYYYY(cutDate);
        if (typeof window.showToast === 'function') {
          window.showToast(`Invalid Date! Date of cut (${cutDisp}) cannot be after tomorrow's date (${maxDisp}).`, 'error');
        } else {
          alert(`Invalid Date! Date of cut (${cutDisp}) cannot be after tomorrow's date (${maxDisp}).`);
        }
        return;
      }

      let reason = presetSelect.value;
      if (reason === 'Other') {
        reason = customInput.value.trim() || 'Unspecified';
      }
      const decisionBy = (overlay.querySelector('.cut-beam-decision-by').value || '').trim();
      closeModal();
      if (typeof onConfirm === 'function') {
        onConfirm({ date: cutDate, reason: reason, decisionBy: decisionBy });
      }
    });
  };

  // Inject style to allow selection inside tables and enforce date picker greyed-out disabled styling
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    td, th, td *, th * {
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    input[type="date"] {
      color-scheme: dark;
    }
  `;
  document.head.appendChild(styleEl);

  // Allow copying table cell text under the mouse cursor when pressing Ctrl+C
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const selection = window.getSelection().toString();
      if (!selection) {
        // No active text selection. Check if focusing on input/textarea
        if (document.activeElement && (
          document.activeElement.tagName === 'INPUT' ||
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.isContentEditable
        )) {
          return;
        }
        // Find hovered table cell
        const hoveredCell = document.querySelector('td:hover, th:hover');
        if (hoveredCell) {
          // Avoid copying text if hovering directly over a button, select, or input inside the cell
          const hoveredEl = document.querySelectorAll(':hover');
          const lastHovered = hoveredEl[hoveredEl.length - 1];
          if (lastHovered && (
            lastHovered.tagName === 'BUTTON' ||
            lastHovered.tagName === 'INPUT' ||
            lastHovered.tagName === 'SELECT' ||
            lastHovered.closest('button') ||
            lastHovered.closest('a')
          )) {
            return;
          }
          // Copy cell text to clipboard
          const text = hoveredCell.innerText || hoveredCell.textContent;
          const cleanedText = text.trim();
          if (cleanedText) {
            navigator.clipboard.writeText(cleanedText).then(() => {
              if (typeof window.showToast === 'function') {
                window.showToast('Copied: "' + cleanedText + '"', 'success');
              } else if (typeof showToast === 'function') {
                showToast('Copied: "' + cleanedText + '"', 'success');
              }
            }).catch(err => {
              console.error('Failed to copy: ', err);
            });
          }
        }
      }
    }
  });

  // Dynamic formatter for Rs and kg to 1 decimal place
  (function () {
    function formatToOneDecimal(numStr) {
      const cleanNumStr = numStr.replace(/,/g, '');
      const num = parseFloat(cleanNumStr);
      if (isNaN(num)) return numStr;
      return num.toLocaleString('en-IN', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      });
    }

    function formatText(text) {
      let changed = false;

      // Pattern 1: currency symbol / text followed by a number (including commas)
      const newText1 = text.replace(/(₹|Rs\.?|rs\.?)\s*((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?)/gi, (match, prefix, num) => {
        changed = true;
        let cleanPrefix = prefix;
        if (/Rs\.?/i.test(prefix)) cleanPrefix = 'Rs.';
        return cleanPrefix + ' ' + formatToOneDecimal(num);
      });

      // Pattern 2: number followed by weight unit (including commas)
      const newText2 = newText1.replace(/((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?)\s*(kg|Kg|KG|kgs|Kgs)\b/gi, (match, num, suffix) => {
        changed = true;
        return formatToOneDecimal(num) + ' ' + suffix;
      });

      return { text: newText2, changed: newText1 !== text || newText2 !== newText1 };
    }

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentNode;
        if (parent) {
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') {
            return;
          }
        }
        const res = formatText(node.nodeValue);
        if (res.changed) {
          node.nodeValue = res.text;
        }
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          processNode(node.childNodes[i]);
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      observer.disconnect();
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            processNode(node);
          });
        } else if (mutation.type === 'characterData') {
          processNode(mutation.target);
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    });

    function init() {
      processNode(document.body);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();

  // Inject sidebar as soon as DOM parsed
  if (document.body) {
    injectSidebar();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      injectSidebar();
    });
  }
})();

// Global Beam Card Modal Implementation
(function () {
  const styleId = 'global-beamcard-modal-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.innerHTML = `
            .gbc-modal-overlay {
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 20000;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }
            .gbc-modal {
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: 24px;
                box-shadow: var(--shadow-xl);
                width: 95%;
                max-width: 1400px;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                padding: 2.5rem;
                color: var(--fg);
            }
            .gbc-modal * {
                box-sizing: border-box;
            }
            .gbc-modal .close-btn {
                position: absolute;
                top: 1rem;
                right: 1.25rem;
                background: transparent;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: var(--muted);
                line-height: 1;
            }
            .gbc-modal .close-btn:hover {
                color: var(--fg);
            }
            .gbc-modal .timeline {
                position: relative;
                padding: 1.5rem 0;
                margin: 1.5rem 0;
            }
            .gbc-modal .timeline::before {
                content: '';
                position: absolute;
                top: 20px;
                bottom: 20px;
                left: 25px;
                width: 4px;
                background: var(--border);
                border-radius: 2px;
            }
            .gbc-modal .timeline-item {
                position: relative;
                margin: 2rem 0;
                clear: both;
            }
            .gbc-modal .timeline-item::after {
                content: '';
                display: table;
                clear: both;
            }
            .gbc-modal .timeline-item:first-child {
                margin-top: 0;
            }
            .gbc-modal .timeline-item:last-child {
                margin-bottom: 0;
            }
            .gbc-modal .timeline-dot {
                position: absolute;
                top: 10px;
                left: 12px;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                border: 4px solid var(--surface) !important;
                box-shadow: 0 0 0 1px var(--border), 0 4px 10px rgba(0, 0, 0, 0.1);
                z-index: 2;
            }
            .gbc-modal .timeline-content {
                position: relative;
                margin-left: 60px;
                background: var(--surface) !important;
                border: 1px solid var(--border) !important;
                border-radius: 12px !important;
                padding: 1.25rem !important;
                box-shadow: var(--shadow-sm);
            }
            .gbc-modal .timeline-content::before {
                content: '';
                position: absolute;
                top: 18px;
                left: -6px;
                width: 10px;
                height: 10px;
                background: var(--surface);
                border-left: 1px solid var(--border);
                border-bottom: 1px solid var(--border);
                transform: rotate(45deg);
                z-index: 1;
            }
            .gbc-modal .timeline-date {
                display: inline-block;
                color: var(--muted);
                font-size: 0.75rem;
                font-weight: 600;
                margin-bottom: 0.25rem;
                font-family: monospace;
            }
            .gbc-modal .badge {
                display: inline-block;
                padding: 0.25rem 0.5rem;
                font-size: 0.7rem;
                font-weight: 700;
                border-radius: 6px;
                text-transform: uppercase;
            }
            .gbc-modal .badge-active {
                background: rgba(139, 92, 246, 0.1);
                color: var(--accent);
                border: 1px solid rgba(139, 92, 246, 0.2);
            }
            .gbc-modal .badge-available {
                background: rgba(16, 185, 129, 0.1);
                color: var(--success);
                border: 1px solid rgba(16, 185, 129, 0.2);
            }
            .gbc-modal .badge-on-loom {
                background: rgba(139, 92, 246, 0.1);
                color: var(--accent);
                border: 1px solid rgba(139, 92, 246, 0.2);
            }
            .gbc-modal .badge-completed {
                background: rgba(139, 143, 163, 0.1);
                color: var(--muted);
                border: 1px solid rgba(139, 143, 163, 0.2);
            }
            /* End gbc-modal timeline */
        `;
    document.head.appendChild(styleEl);
  }

  // Auto-purge Beam 101 from stored data if present
  (function purgeBeam101() {
    try {
      const beams = JSON.parse(localStorage.getItem('warp-beams') || '[]');
      const newBeams = beams.filter(b => String(b.beamNumber) !== '101' && String(b.id) !== 'b101');
      if (newBeams.length !== beams.length) {
        localStorage.setItem('warp-beams', JSON.stringify(newBeams));
      }

      const loadings = JSON.parse(localStorage.getItem('warp-beam-loadings') || '[]');
      const newLoadings = loadings.filter(bl => String(bl.beamNumber) !== '101');
      if (newLoadings.length !== loadings.length) {
        localStorage.setItem('warp-beam-loadings', JSON.stringify(newLoadings));
      }

      const logs = JSON.parse(localStorage.getItem('productionLogs') || '[]');
      const newLogs = logs.filter(l => String(l.beamNumber) !== '101');
      if (newLogs.length !== logs.length) {
        localStorage.setItem('productionLogs', JSON.stringify(newLogs));
      }
    } catch (e) { }
  })();

  const sampleBeamsFallback = [
    { id: "b102", beamNumber: "102", quality: "Organza 50D", code: "OG-02", color: "Blush Pink", ends: 8400, meters: 1800, status: "On Loom", machineNumber: "2", createdAt: "2026-06-21", warpingPerson: "Mahesh Patel", history: [{ date: "2026-06-21", event: "Warped by Mahesh Patel", type: "warp" }, { date: "2026-06-26", event: "Jala Piecing by Suresh on Machine 2", type: "machine" }] },
    { id: "b103", beamNumber: "103", quality: "Brocade Jacquard", code: "BJ-03", color: "Gold White", ends: 10200, meters: 1200, status: "On Loom", machineNumber: "3", createdAt: "2026-06-22", warpingPerson: "Ramesh Kumar", history: [{ date: "2026-06-22", event: "Warped by Ramesh Kumar", type: "warp" }, { date: "2026-06-27", event: "Jala Piecing by Mahesh on Machine 3", type: "machine" }] },
    { id: "b104", beamNumber: "104", quality: "Taffeta 75D", code: "TF-04", color: "Emerald Green", ends: 9000, meters: 2000, status: "On Loom", machineNumber: "4", createdAt: "2026-06-23", warpingPerson: "Ramesh Kumar", history: [{ date: "2026-06-23", event: "Warped by Ramesh Kumar", type: "warp" }, { date: "2026-06-28", event: "Jala Piecing by Mahesh on Machine 4", type: "machine" }] },
    { id: "b105", beamNumber: "105", quality: "Cotton Satin 60S", code: "CS-05", color: "Maroon", ends: 7200, meters: 1500, status: "Available", machineNumber: null, createdAt: "2026-06-29", warpingPerson: "Ramesh Kumar", history: [{ date: "2026-06-29", event: "Warped by Ramesh Kumar", type: "warp" }] }
  ];

  const sampleBeamLoadingsFallback = [];

  function getBeamDetailsStr(beam, eventDate, productionLogs) {
    if (!beam) return '';
    const q = beam.quality || '';
    const code = beam.code || '';
    const color = beam.color || '';
    const ends = beam.ends ? `${beam.ends}E` : '';
    let usedMeters = 0;
    if (productionLogs && productionLogs.length > 0) {
      usedMeters = productionLogs
        .filter(l => String(l.beamNumber) === String(beam.beamNumber))
        .reduce((sum, l) => sum + (parseFloat(l.totalMeters) || 0), 0);
    }
    const remainingMeters = (beam.meters || 0) - usedMeters;
    const metersStr = `${Math.round(remainingMeters)}/${beam.meters || 0}m`;
    const parts = [q, (code && color) ? `${code} / ${color}` : (code || color), ends, metersStr].filter(Boolean);
    return `(${parts.join(' | ')})`;
  }

  window.revertLastBeamMove = function (beamId) {
    if (!beamId) return;
    let allBeams = [];
    try {
      const storedStr = localStorage.getItem('warp-beams');
      if (storedStr) {
        allBeams = JSON.parse(storedStr);
      }
      if (!allBeams || allBeams.length === 0) {
        if (typeof window.state !== 'undefined' && Array.isArray(window.state.beams) && window.state.beams.length > 0) {
          allBeams = window.state.beams;
        } else if (typeof sampleBeamsFallback !== 'undefined') {
          allBeams = sampleBeamsFallback;
        }
      }
    } catch (e) { }

    const bIdx = allBeams.findIndex(b => String(b.id) === String(beamId) || String(b.beamNumber) === String(beamId));
    if (bIdx === -1) {
      alert('Beam not found.');
      return;
    }

    const beam = allBeams[bIdx];
    const history = beam.history || [];
    if (history.length === 0) {
      if (typeof window.showToast === 'function') window.showToast('No moves to revert in timeline.', 'error');
      else alert('No moves to revert in timeline.');
      return;
    }

    const lastEventObj = history[history.length - 1];
    const lastEventText = (lastEventObj.event || '').toLowerCase();
    if (lastEventText.includes('manufactured') || lastEventText.includes('created') || lastEventText.includes('warped')) {
      if (typeof window.showToast === 'function') window.showToast('Cannot revert beam creation/warping origin move.', 'warning');
      else alert('Cannot revert beam creation/warping origin move.');
      return;
    }

    const confirmMsg = `Are you sure you want to cancel and revert this move?\n\n"${lastEventObj.event || 'Last Event'}"`;
    if (!confirm(confirmMsg)) return;

    // Remove the last move
    const poppedEvent = history.pop();
    beam.history = history;

    // Recalculate status and machineNumber from remaining history
    let newStatus = 'Available';
    let newMachine = null;

    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const e = (h.event || '').toLowerCase();
      if (e.includes('cut off') || e.includes('unloaded') || e.includes('removed') || e.includes('completed') || e.includes('complete')) {
        if (e.includes('completed') || e.includes('complete')) {
          newStatus = 'Completed';
          newMachine = null;
        } else {
          newStatus = 'Available';
          newMachine = null;
        }
        break;
      } else if (e.includes('loaded') || e.includes('assigned') || e.includes('jala piecing') || e.includes('pissing')) {
        newStatus = 'On Loom';
        const machObj = typeof getMachineFromEvent === 'function' ? getMachineFromEvent(h.event) : null;
        if (machObj && machObj.name) {
          newMachine = machObj.name;
        } else {
          let mMatch = (h.event || '').match(/(?:machine|loom|on|from)\s+(?:machine\s+)?([^\s\]\)]+)/i);
          if (mMatch && mMatch[1] && mMatch[1].toLowerCase() !== 'machine') {
            newMachine = mMatch[1].trim();
          } else {
            newMachine = beam.machineNumber;
          }
        }
        break;
      }
    }

    if (newStatus === 'On Loom' && (!newMachine || String(newMachine).trim() === '')) {
      // Safety fallback: if status is On Loom but machine is invalid/empty, set to Limbo to prevent beam from disappearing
      newStatus = 'Limbo';
      newMachine = null;
    }

    // Machine Occupation Collision Check:
    // If restoring a beam to a loom that ALREADY HAS another beam loaded on it,
    // safely move the currently loaded beam to Limbo so it NEVER vanishes or gets silently overwritten!
    if (newStatus === 'On Loom' && newMachine) {
      const cleanTargetMach = String(newMachine).toLowerCase().replace(/^machine\s+/i, '').replace(/^loom\s+/i, '').trim();
      const occupiedBeamIdx = allBeams.findIndex(b => {
        if (String(b.id) === String(beam.id) || String(b.beamNumber) === String(beam.beamNumber)) return false;
        const st = (b.status || '').trim().toLowerCase();
        if (st !== 'on loom' && st !== 'on machine' && st !== 'running' && st !== 'active') return false;
        const bMach = String(b.machineNumber || b.machine || b.loom || '').toLowerCase().replace(/^machine\s+/i, '').replace(/^loom\s+/i, '').trim();
        return bMach === cleanTargetMach;
      });

      if (occupiedBeamIdx !== -1) {
        const occupiedBeam = allBeams[occupiedBeamIdx];
        occupiedBeam.status = 'Limbo';
        occupiedBeam.machineNumber = null;
        if (!Array.isArray(occupiedBeam.history)) occupiedBeam.history = [];
        occupiedBeam.history.push({
          date: new Date().toISOString().substring(0, 10),
          event: `Displaced from Machine ${newMachine} (Reverted move of Beam #${beam.beamNumber})`,
          type: 'system'
        });
        allBeams[occupiedBeamIdx] = occupiedBeam;

        if (typeof window.showToast === 'function') {
          window.showToast(`Loom ${newMachine} was occupied by Beam #${occupiedBeam.beamNumber}. Beam #${occupiedBeam.beamNumber} moved to Limbo.`, 'warning');
        }
      }
    }

    beam.status = newStatus;
    beam.machineNumber = newMachine;
    if (newStatus !== 'Completed') {
      beam.completedAt = null;
    }

    allBeams[bIdx] = beam;
    localStorage.setItem('warp-beams', JSON.stringify(allBeams));

    // If popped event was a load move, clean up associated beam loadings
    const poppedText = (poppedEvent.event || '').toLowerCase();
    if (poppedText.includes('loaded') || poppedText.includes('jala piecing') || poppedText.includes('pissing')) {
      try {
        let loadings = JSON.parse(localStorage.getItem('warp-beam-loadings') || '[]');
        const cleanLoadings = loadings.filter(bl => String(bl.beamNumber) !== String(beam.beamNumber) || bl.date !== poppedEvent.date);
        localStorage.setItem('warp-beam-loadings', JSON.stringify(cleanLoadings));
      } catch (e) { }
    }

    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new Event('warp-beams-updated'));

    if (window.state && Array.isArray(window.state.beams)) {
      const sIdx = window.state.beams.findIndex(b => String(b.id) === String(beamId) || String(b.beamNumber) === String(beamId));
      if (sIdx !== -1) window.state.beams[sIdx] = beam;
    }

    if (typeof window.showToast === 'function') {
      window.showToast(`Cancelled move: "${poppedEvent.event}"`, 'info');
    } else {
      alert(`Cancelled move: "${poppedEvent.event}"`);
    }

    // Refresh UI
    if (typeof window.renderAll === 'function') {
      try { window.renderAll(); } catch (e) { }
    }
    if (typeof window.renderStock === 'function') {
      try { window.renderStock(); } catch (e) { }
    }
    if (typeof window.openBeamModal === 'function') {
      try { window.openBeamModal(beam.id || beam.beamNumber); } catch (e) { }
    }
  };

  window.showGlobalBeamCard = function (beamNumber) {
    if (!beamNumber) return;

    let beamsList = [];
    try {
      beamsList = JSON.parse(localStorage.getItem('warp-beams') || '[]');
    } catch (e) { }
    if (!beamsList) {
      beamsList = [];
    }

    const beam = beamsList.find(b => String(b.beamNumber) === String(beamNumber));
    if (!beam) {
      alert(`Beam #${beamNumber} not found in inventory.`);
      return;
    }

    let productionLogs = [];
    try {
      productionLogs = JSON.parse(localStorage.getItem('productionLogs') || '[]');
    } catch (e) { }

    let beamLoadings = [];
    try {
      beamLoadings = JSON.parse(localStorage.getItem('warp-beam-loadings') || '[]');
    } catch (e) { }
    if (!beamLoadings || !beamLoadings.length) {
      beamLoadings = sampleBeamLoadingsFallback;
    }

    let machines = [];
    try {
      machines = JSON.parse(localStorage.getItem('machines') || '[]');
    } catch (e) { }

    const beamLogs = productionLogs.filter(l => String(l.beamNumber) === String(beam.beamNumber));

    const getBeamTimeline = (beam) => {
      if (!beam) return [];

      const beamNumStr = String(beam.beamNumber);

      const beamLogs = (productionLogs || []).filter(l => String(l.beamNumber) === beamNumStr);
      const loadingsList = (beamLoadings || []).filter(bl => String(bl.beamNumber) === beamNumStr);

      // 1. Structured derived setup events from Beam Loading module
      const loadingEvents = [];
      loadingsList.forEach(bl => {
        const roles = [];
        if (bl.piecein) roles.push({ role: 'Piece In', worker: bl.piecein });
        if (bl.drawingIn) roles.push({ role: 'Drawing In', worker: bl.drawingIn });
        if (bl.fani) roles.push({ role: 'Fani (Reed)', worker: bl.fani });
        if (bl.dropPinJog) roles.push({ role: 'Drop pin/Jog', worker: bl.dropPinJog });

        if (roles.length === 0) {
          roles.push({ role: 'Beam Loading', worker: bl.workerName || 'Worker' });
        }

        const mNameStr = String(bl.machineNumber || '');
        const mDisp = mNameStr ? (mNameStr.toLowerCase().includes('machine') ? mNameStr : `Machine ${mNameStr}`) : 'Machine';

        roles.forEach(r => {
          loadingEvents.push({
            date: bl.date,
            event: `${r.role} by ${r.worker} on ${mDisp}`,
            type: 'beam-loading',
            category: 'derived',
            machineNumber: bl.machineNumber
          });
        });
      });

      // 2. Format history events (Beam Creation, Beam Loaded, Beam Cut Off)
      const historyEvents = (beam.history || [])
        .map((h, idx) => ({ ...h, historyIndex: idx, category: 'history', type: h.type || 'system' }))
        .filter(h => {
          const e = (h.event || '').toLowerCase();
          if (e.includes('sync from production sheet')) return false;
          if (e.includes('was removed') || e.includes('returned to available')) return false;
          if (e.includes('limbo') || e.includes('displaced') || e.includes('unassigned')) return false;
          return true;
        })
        .map(h => {
          let event = h.event || '';
          if (event === 'Beam Created' || event === 'Beam manufactured') {
            event = `Beam manufactured by ${beam.warpingPerson || 'Unknown'}`;
          }

          const metaParts = [];
          if (h.reason && !event.toLowerCase().includes(h.reason.toLowerCase())) {
            metaParts.push(`Reason: ${h.reason}`);
          }
          if (h.decisionBy && !event.toLowerCase().includes(h.decisionBy.toLowerCase())) {
            metaParts.push(`Decision By: ${h.decisionBy}`);
          }

          if (metaParts.length > 0) {
            const metaStr = metaParts.join(' | ');
            if (!event.includes(metaStr)) {
              if (event.includes('(')) {
                event = `${event.slice(0, -1)} | ${metaStr})`;
              } else {
                event = `${event} (${metaStr})`;
              }
            }
          }
          return { ...h, event };
        });

      const normMach = s => String(s || '').toLowerCase().replace(/^machine\s*/i, '').trim();

      const matchMachine = (mNum, mach) => {
        if (!mNum || !mach) return false;
        const target = normMach(mNum);
        const mId = normMach(mach.id);
        const mName = normMach(mach.name);
        if (target === mId || target === mName) return true;

        const allMachines = JSON.parse(localStorage.getItem('machines') || '[]');
        const found = allMachines.find(m => normMach(m.id) === target || normMach(m.name) === target);
        if (found) {
          const fId = normMach(found.id);
          const fName = normMach(found.name);
          return fId === mId || fName === mId || fId === mName || fName === mName;
        }
        return false;
      };

      // Helper to extract machine object or name from event text
      const getMachineFromEvent = (eventStr) => {
        if (!eventStr) return null;
        const lower = eventStr.toLowerCase();
        const allMachines = JSON.parse(localStorage.getItem('machines') || '[]');
        const sortedMachines = [...allMachines].sort((a, b) => (b.name || '').length - (a.name || '').length);
        for (const m of sortedMachines) {
          const mNameEscaped = String(m.name).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const mIdEscaped = String(m.id).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex1 = new RegExp(`(?:machine|loom|no\\.?|on|from|completed on|unloaded from)\\s*(?:machine\\s+)?(?:\\b${mNameEscaped}\\b|\\b${mIdEscaped}\\b)`, 'i');
          const regex2 = new RegExp(`(?:\\b${mNameEscaped}\\b|\\b${mIdEscaped}\\b)`, 'i');
          if (regex1.test(lower) || regex2.test(lower)) {
            return m;
          }
        }
        const match = lower.match(/(?:machine|loom|no\.?)\s*(\w+)/i);
        if (match) {
          const found = allMachines.find(m => normMach(m.id) === normMach(match[1]) || normMach(m.name) === normMach(match[1]));
          return found || { id: match[1], name: match[1] };
        }
        return null;
      };

      // 3. Separate history into pre-cycle events (Creation/Warping) and cycles
      const preCycleEvents = [];
      const cycles = [];

      historyEvents.forEach(item => {
        const evt = (item.event || '').toLowerCase();
        const isManufacturing = evt.includes('manufactured') || evt.includes('manufacture') || evt.includes('created') || evt.includes('warped') || evt.includes('warping') || item.type === 'warp';
        const isLoad = (evt.includes('beam loaded') || evt.includes('loaded on') || evt.includes('assigned to') || evt.includes('jala piecing') || evt.includes('pissing')) && !evt.includes('unloaded') && !evt.includes('cut off') && !evt.includes('cut from');

        if (isManufacturing) {
          preCycleEvents.push(item);
        } else if (isLoad) {
          const mach = getMachineFromEvent(item.event) || { id: 'Unknown', name: 'Unknown' };
          cycles.push({
            machine: mach,
            startEvent: item,
            startDate: item.date,
            endDate: null,
            setupEvents: [],
            logs: [],
            cutEvents: []
          });
        }
      });

      // Fallback & Auto-Discovery of Cycles for machines with loading events or production logs
      loadingEvents.forEach(le => {
        const leMNum = le.machineNumber || (le.machine ? le.machine.name : '');
        if (!leMNum) return;
        const leDate = le.date || beam.createdAt || '2026-01-01';
        const exists = cycles.some(c => matchMachine(leMNum, c.machine) && (leDate >= c.startDate && (!c.endDate || c.endDate === '9999-12-31' || leDate <= c.endDate)));
        if (!exists) {
          const mach = getMachineFromEvent(`Machine ${leMNum}`) || { id: String(leMNum), name: String(leMNum) };
          cycles.push({
            machine: mach,
            startEvent: { date: leDate, event: `Beam Assigned / Setup on Machine ${mach.name}`, type: 'machine', historyIndex: 900 },
            startDate: leDate,
            endDate: null,
            setupEvents: [],
            logs: [],
            cutEvents: []
          });
          cycles.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
        }
      });

      beamLogs.forEach(log => {
        const logMNum = log.machineNumber;
        if (!logMNum) return;
        const logDate = log.productionDate || log.pissingDate || log.date || beam.createdAt || '2026-01-01';
        const exists = cycles.some(c => matchMachine(logMNum, c.machine) && (logDate >= c.startDate && (!c.endDate || c.endDate === '9999-12-31' || logDate <= c.endDate)));
        if (!exists) {
          const mach = getMachineFromEvent(`Machine ${logMNum}`) || { id: String(logMNum), name: String(logMNum) };
          cycles.push({
            machine: mach,
            startEvent: { date: logDate, event: `Production Cycle on Machine ${mach.name}`, type: 'machine', historyIndex: 901 },
            startDate: logDate,
            endDate: null,
            setupEvents: [],
            logs: [],
            cutEvents: []
          });
          cycles.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
        }
      });

      // Ensure cycles are strictly sorted in chronological order
      cycles.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

      // Assign end dates and collect all events in each cycle (cuts, unloads, completion & setup items)
      cycles.forEach((cycle, cIdx) => {
        const nextCycle = cycles[cIdx + 1];
        const startIdx = historyEvents.indexOf(cycle.startEvent);
        const endIdx = (nextCycle && historyEvents.indexOf(nextCycle.startEvent) !== -1)
          ? historyEvents.indexOf(nextCycle.startEvent)
          : historyEvents.length;

        if (startIdx !== -1) {
          for (let i = startIdx + 1; i < endIdx; i++) {
            const hItem = historyEvents[i];
            const evt = (hItem.event || '').toLowerCase();
            const isCut = evt.includes('cut off') || evt.includes('unloaded') || evt.includes('completed') || evt.includes('complete') || evt.includes('removed');
            if (isCut) {
              cycle.cutEvents.push(hItem);
              if (!cycle.endDate) {
                cycle.endDate = hItem.date;
              }
            } else {
              cycle.setupEvents.push(hItem);
            }
          }
        }
        if (nextCycle && (!cycle.endDate || cycle.endDate === '9999-12-31' || cycle.endDate > nextCycle.startDate)) {
          cycle.endDate = nextCycle.startDate;
        }
        if (!cycle.endDate) cycle.endDate = '9999-12-31';
      });

      // Assign setup events to cycles
      loadingEvents.forEach(le => {
        const leMNum = le.machineNumber || (le.machine ? le.machine.name : '');

        let matchedCycle = [...cycles].reverse().find(cycle => {
          const sameMachine = matchMachine(leMNum, cycle.machine);
          return sameMachine && le.date >= cycle.startDate && le.date <= cycle.endDate;
        });

        if (!matchedCycle && leMNum) {
          const sameMachineCycles = cycles.filter(cycle => matchMachine(leMNum, cycle.machine));
          if (sameMachineCycles.length > 0) {
            matchedCycle = sameMachineCycles.find(c => le.date >= c.startDate) || sameMachineCycles[sameMachineCycles.length - 1];
          }
        }

        if (!matchedCycle && !leMNum) {
          matchedCycle = [...cycles].reverse().find(cycle => le.date >= cycle.startDate && le.date <= cycle.endDate);
        }

        if (matchedCycle) {
          const alreadyExists = matchedCycle.setupEvents.some(se => (se.event || '').toLowerCase() === (le.event || '').toLowerCase() && se.date === le.date);
          if (!alreadyExists) {
            matchedCycle.setupEvents.push(le);
          }
        }
      });

      // Assign production logs to cycles
      beamLogs.forEach(log => {
        let bestCycle = null;
        const logMNum = log.machineNumber;
        cycles.forEach(cycle => {
          if (matchMachine(logMNum, cycle.machine)) {
            if (log.productionDate >= cycle.startDate && log.productionDate <= cycle.endDate) {
              if (!bestCycle || cycle.startDate > bestCycle.startDate) {
                bestCycle = cycle;
              }
            }
          }
        });

        const logMeters = parseFloat(log.totalMeters || log.meters) || 0;
        const logWeight = parseFloat(log.takaWeight || log.weight) || 0;

        if (bestCycle) {
          bestCycle.logs.push({
            productionDate: log.productionDate,
            foldingDate: log.foldingDate,
            takaSerial: log.takaSerial || 'Pending',
            meters: logMeters,
            weight: logWeight
          });
        } else if (cycles.length > 0 && logMNum) {
          const sameMachineCycles = cycles.filter(itemCycle => matchMachine(logMNum, itemCycle.machine));
          if (sameMachineCycles.length > 0) {
            sameMachineCycles[sameMachineCycles.length - 1].logs.push({
              productionDate: log.productionDate,
              foldingDate: log.foldingDate,
              takaSerial: log.takaSerial || 'Pending',
              meters: logMeters,
              weight: logWeight
            });
          }
        }
      });

      // Assemble final timeline in exact chronological cycle sequence
      const finalTimeline = [];

      const processedHistoryIndices = new Set();
      preCycleEvents.forEach(item => processedHistoryIndices.add(item.historyIndex));

      // Consolidate preCycleEvents so there is ONLY 1 warping/manufacturing origin event at the top
      if (preCycleEvents.length > 0) {
        const explicitWarp = preCycleEvents.find(h => {
          const e = (h.event || '').toLowerCase();
          return e.includes('warped by') || e.includes('warping by') || e.includes('manufactured by');
        });
        const primaryOrigin = explicitWarp || preCycleEvents[0];

        const wPerson = beam.warpingPerson || 'Unknown';
        let cleanEvent = primaryOrigin.event || '';
        if (cleanEvent === 'Beam Created' || cleanEvent === 'Beam manufactured' || cleanEvent.toLowerCase() === 'beam created') {
          cleanEvent = `Warped by ${wPerson}`;
        }

        finalTimeline.push({
          ...primaryOrigin,
          event: cleanEvent
        });
      }

      cycles.forEach((cycle, cIdx) => {
        const cycleNumber = cIdx + 1;
        const mNameStr = String(cycle.machine.name || 'Machine');
        const mDisp = mNameStr.toLowerCase().includes('machine') ? mNameStr : `Machine ${mNameStr}`;
        const hasCut = cycle.cutEvents.length > 0;
        let cStatus = 'Cut Off';
        if (hasCut) {
          const lastCutText = (cycle.cutEvents[cycle.cutEvents.length - 1].event || '').toLowerCase();
          cStatus = (lastCutText.includes('completed') || lastCutText.includes('complete')) ? 'Completed' : 'Cut Off';
        } else if (cIdx === cycles.length - 1) {
          cStatus = beam.status || 'On Loom';
        }

        // 1. Cycle Start (Beam Loaded)
        finalTimeline.push({
          ...cycle.startEvent,
          cycleNumber,
          cycleMachine: mDisp,
          cycleStatus: cStatus,
          isCycleStart: true
        });
        processedHistoryIndices.add(cycle.startEvent.historyIndex);

        // 2. Setup Events
        cycle.setupEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        cycle.setupEvents.forEach(se => {
          finalTimeline.push({
            ...se,
            cycleNumber,
            cycleMachine: mDisp,
            cycleStatus: cStatus
          });
        });

        // 3. Production Details
        if (cycle.logs.length > 0) {
          cycle.logs.sort((a, b) => (a.productionDate || '').localeCompare(b.productionDate || ''));
          const subTotalMeters = cycle.logs.reduce((acc, l) => acc + l.meters, 0);
          const uniqueTakas = {};
          cycle.logs.forEach(l => {
            if (l.takaSerial && l.takaSerial !== 'Pending') {
              uniqueTakas[l.takaSerial] = l.weight;
            }
          });
          const subTotalWeight = Object.values(uniqueTakas).reduce((acc, w) => acc + w, 0);
          const prodDate = cycle.logs[0].productionDate;

          finalTimeline.push({
            date: prodDate,
            event: `Production Details for ${mDisp}`,
            type: 'production',
            category: 'derived',
            cycleNumber,
            cycleMachine: mDisp,
            cycleStatus: cStatus,
            details: {
              machineNumber: cycle.machine.name,
              logs: cycle.logs,
              subTotalMeters,
              subTotalWeight
            }
          });
        }

        // 4. Cut / Unload / Completion Events
        cycle.cutEvents.forEach(ce => {
          finalTimeline.push({
            ...ce,
            cycleNumber,
            cycleMachine: mDisp,
            cycleStatus: cStatus,
            isCycleEnd: true
          });
          processedHistoryIndices.add(ce.historyIndex);
        });
      });

      // 5. Any post-cycle or unassigned history events
      historyEvents.forEach(item => {
        const evt = (item.event || '').toLowerCase();
        const isMfg = evt.includes('manufactured') || evt.includes('manufacture') || evt.includes('created') || evt.includes('warped') || evt.includes('warping') || item.type === 'warp';
        if (!isMfg && !processedHistoryIndices.has(item.historyIndex)) {
          finalTimeline.push(item);
        }
      });

      // Guarantee: Filter finalTimeline so that ANY warping/manufacturing origin event appears ONLY ONCE at index 0!
      let originSeen = false;
      return finalTimeline.filter(item => {
        const evt = (item.event || '').toLowerCase();
        if (evt.includes('limbo') || evt.includes('displaced') || evt.includes('unassigned') || evt.includes('returned to available') || evt.includes('was removed')) return false;
        const isMfg = evt.includes('manufactured') || evt.includes('manufacture') || evt.includes('created') || evt.includes('warped') || evt.includes('warping') || item.type === 'warp';
        if (isMfg) {
          if (!originSeen) {
            originSeen = true;
            return true;
          }
          return false;
        }
        return true;
      });
    };

    const beamUsed = beamLogs.reduce((acc, log) => acc + (parseFloat(log.totalMeters) || 0), 0);
    const beamRemaining = (parseFloat(beam.meters) || 0) - beamUsed;
    const beamShortagePercent = beam.meters > 0 ? (beamRemaining / beam.meters) * 100 : 0;
    const isCompleted = beam.status === 'Completed';

    const formatDate = (dateStr) => {
      if (!dateStr || dateStr === '9999-12-31') return '';
      try {
        const parts = String(dateStr).split('T')[0].split('-');
        if (parts.length === 3) {
          const d = new Date(parts[0], parts[1] - 1, parts[2]);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[d.getMonth()];
            const year = d.getFullYear();
            return `${day} ${month} ${year}`;
          }
        }
      } catch (e) { }
      return dateStr;
    };

    let overlay = document.getElementById('global-beamcard-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'global-beamcard-overlay';
      overlay.className = 'gbc-modal-overlay';
      overlay.onclick = () => { overlay.style.display = 'none'; };
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
            <div class="gbc-modal" onclick="event.stopPropagation()">
                <button type="button" class="close-btn" onclick="document.getElementById('global-beamcard-overlay').style.display='none'">&times;</button>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                    <div>
                        <h2 style="margin: 0; font-family: var(--font-display); font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; font-size: 1.3rem;">BEAM CARD #${beam.beamNumber}</h2>
                        <p style="color: var(--muted); font-size: 0.85rem; margin: 0.25rem 0 0 0;">${beam.quality || ''} | ${beam.code || ''} / ${beam.color || ''}</p>
                    </div>
                </div>
                
                <!-- Stat Grid -->
                <div style="display: grid; grid-template-columns: repeat(${isCompleted ? 6 : 5}, 1fr); gap: 0.75rem; margin-bottom: 2rem;">
                    <div class="card" style="background: var(--bg); margin: 0; padding: 1rem; border: 1px solid var(--border); border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600;">ENDS</div>
                        <div style="font-size: 1.25rem; font-weight: 700; font-family: monospace;">${beam.ends}</div>
                    </div>
                    <div class="card" style="background: var(--bg); margin: 0; padding: 1rem; border: 1px solid var(--border); border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600;">INITIAL METERS</div>
                        <div style="font-size: 1.25rem; font-weight: 700; font-family: monospace;">${beam.meters} m</div>
                    </div>
                    <div class="card" style="background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.15); margin: 0; padding: 1rem; border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600;">USED</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--accent); font-family: monospace;">${beamUsed.toFixed(1)} m</div>
                    </div>
                    <div class="card" style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); margin: 0; padding: 1rem; border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600;">REMAINING</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--success); font-family: monospace;">${beamRemaining.toFixed(1)} m</div>
                    </div>
                    ${isCompleted ? `
                    <div class="card" style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.15); margin: 0; padding: 1rem; border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600;">SHORTAGE %</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--error); font-family: monospace;">${beamShortagePercent.toFixed(1)}%</div>
                    </div>
                    ` : ''}
                    <div class="card" style="background: var(--bg); margin: 0; padding: 1rem; position: relative; border: 1px solid var(--border); border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.25rem; font-weight: 600;">STATUS</div>
                        <div class="badge badge-${beam.status.toLowerCase().replace(' ', '-')}" style="font-size: 0.6rem;">${beam.status}</div>
                    </div>
                </div>

                <h3 class="display-font" style="font-size: 1.05rem; font-weight: 700; margin-bottom: 1rem; color: var(--fg);">Beam Timeline</h3>
                          <div style="display: flex; flex-direction: column; gap: 1.25rem; margin-top: 1rem; margin-bottom: 1rem;">
                    ${(() => {
        const timeline = getBeamTimeline(beam);
        if (timeline.length === 0) {
          return '<div style="color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 1rem 0;">No timeline events recorded.</div>';
        }

        const renderItem = (h) => {
          const dotColor = h.type === 'machine' ? 'var(--accent3)' : (h.type === 'production' ? 'var(--success)' : (h.type === 'beam-loading' ? 'var(--accent2)' : 'var(--accent)'));

          let detailsHtml = '';
          if (h.type === 'production' && h.details && h.details.logs) {
            const grouped = [];
            const takaGroups = {};
            h.details.logs.forEach(log => {
              const serial = log.takaSerial;
              if (!serial || serial === 'Pending') {
                grouped.push({
                  productionDates: [log.productionDate],
                  foldingDates: log.foldingDate ? [log.foldingDate] : [],
                  takaSerial: serial || 'Pending',
                  meters: log.meters,
                  weight: log.weight
                });
              } else {
                if (!takaGroups[serial]) {
                  takaGroups[serial] = {
                    productionDates: [],
                    foldingDates: [],
                    takaSerial: serial,
                    meters: 0,
                    weight: 0
                  };
                  grouped.push(takaGroups[serial]);
                }
                if (!takaGroups[serial].productionDates.includes(log.productionDate)) {
                  takaGroups[serial].productionDates.push(log.productionDate);
                }
                if (log.foldingDate && !takaGroups[serial].foldingDates.includes(log.foldingDate)) {
                  takaGroups[serial].foldingDates.push(log.foldingDate);
                }
                takaGroups[serial].meters += log.meters;
                takaGroups[serial].weight = Math.max(takaGroups[serial].weight, log.weight);
              }
            });

            const trs = grouped.map(g => `
                                    <tr>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">
                                            ${g.productionDates.map(d => `<div>${formatDate(d)}</div>`).join('')}
                                        </td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">
                                            ${g.foldingDates.length > 0 ? g.foldingDates.map(d => `<div>${formatDate(d)}</div>`).join('') : '—'}
                                        </td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; font-weight: 500; color: var(--fg); vertical-align: top; width: 20%;">${g.takaSerial}</td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; font-weight: 600; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">${g.meters.toFixed(1)} m</td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; font-weight: 600; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">${g.weight > 0 ? `${g.weight.toFixed(2)} kg` : '—'}</td>
                                    </tr>
                                `).join('');

            detailsHtml = `
                                    <div style="padding: 0.75rem; margin-top: 0.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; width: 100%; overflow-x: auto;">
                                        <table style="width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.8rem; text-align: center;">
                                            <thead>
                                                <tr>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Prod. Date</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Folding Date</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Taka Serial</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Meters</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Weight</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${trs}
                                                <tr style="border-top: 2px solid var(--border); font-weight: 700;">
                                                    <td colspan="3" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; text-align: center; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;">Sub Total</td>
                                                    <td style="padding: 0.4rem 0.6rem; font-size: 0.8rem; text-align: center; color: var(--accent);">${h.details.subTotalMeters.toFixed(1)} m</td>
                                                    <td style="padding: 0.4rem 0.6rem; font-size: 0.8rem; text-align: center; color: var(--accent);">${h.details.subTotalWeight > 0 ? `${h.details.subTotalWeight.toFixed(2)} kg` : '—'}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                `;
          }

          const eLower = (h.event || '').toLowerCase();
          const isOriginEvent = eLower.includes('manufactured') || eLower.includes('created') || eLower.includes('warped');
          let cancelBtnHtml = '';
          if (h.historyIndex !== undefined && beam.history && h.historyIndex === (beam.history.length - 1) && !isOriginEvent) {
            cancelBtnHtml = `
              <button onclick="event.stopPropagation(); window.revertLastBeamMove('${beam.id || beam.beamNumber}')" 
                      class="btn btn-outline" 
                      title="Cancel / Revert this move"
                      style="margin-left: 0.5rem; padding: 0.2rem 0.65rem; font-size: 0.72rem; color: #ef4444; border-color: #ef4444; border-radius: 6px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; background: rgba(239, 68, 68, 0.08);">
                  ✕ Cancel Move
              </button>
            `;
          }

          return `
            <div class="timeline-item" style="margin-bottom: 1.25rem;">
                <div class="timeline-dot" style="background: ${dotColor};"></div>
                <div class="timeline-content">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: ${h.type === 'production' ? '0.5rem' : '0'}; width: 100%;">
                        <div>
                            <div class="timeline-date">${h.hideDate ? '' : formatDate(h.date)}</div>
                            <div style="font-weight: 600; color: var(--fg);">${h.event}</div>
                        </div>
                        ${cancelBtnHtml}
                    </div>
                    ${detailsHtml}
                </div>
            </div>
          `;
        };

        const originItems = [];
        const cycleGroups = {};
        const unassignedItems = [];

        timeline.forEach(item => {
          if (item.cycleNumber) {
            if (!cycleGroups[item.cycleNumber]) {
              cycleGroups[item.cycleNumber] = [];
            }
            cycleGroups[item.cycleNumber].push(item);
          } else {
            const evt = (item.event || '').toLowerCase();
            if (evt.includes('warped') || evt.includes('manufactured') || evt.includes('created') || item.type === 'warp') {
              originItems.push(item);
            } else {
              unassignedItems.push(item);
            }
          }
        });

        let outputHtml = '';

        if (originItems.length > 0) {
          outputHtml += `
            <div style="padding: 1.1rem 1.25rem; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 2px 6px rgba(0,0,0,0.02);">
                <div style="font-size: 0.72rem; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.85rem;">
                    WARPING & MANUFACTURING ORIGIN
                </div>
                <div class="timeline" style="margin: 0;">
                    ${originItems.map(renderItem).join('')}
                </div>
            </div>
          `;
        }

        const cycleNums = Object.keys(cycleGroups).map(Number).sort((a, b) => a - b);
        cycleNums.forEach(cNum => {
          const cItems = cycleGroups[cNum];
          const firstItem = cItems[0] || {};
          const cMachine = firstItem.cycleMachine || 'Loom';
          const cStatus = firstItem.cycleStatus || 'Cut Off';
          const statusBadgeStyle = cStatus === 'On Loom' 
              ? 'background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);' 
              : (cStatus === 'Completed' 
                  ? 'background: rgba(139, 92, 246, 0.12); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3);' 
                  : 'background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);');

          outputHtml += `
            <div style="padding: 1.25rem; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border);">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 0.88rem; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em;">
                            CYCLE ${cNum}
                        </span>
                        <span style="padding: 0.2rem 0.65rem; font-size: 0.72rem; font-weight: 700; background: rgba(139, 92, 246, 0.12); color: var(--accent); border-radius: 6px; border: 1px solid rgba(139, 92, 246, 0.25);">
                            ${cMachine}
                        </span>
                    </div>
                    <span style="padding: 0.25rem 0.65rem; font-size: 0.7rem; font-weight: 700; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.03em; ${statusBadgeStyle}">
                        ${cStatus}
                    </span>
                </div>

                <div class="timeline" style="margin: 0;">
                    ${cItems.map(renderItem).join('')}
                </div>
            </div>
          `;
        });

        if (unassignedItems.length > 0) {
          outputHtml += `
            <div style="padding: 1.1rem 1.25rem; background: var(--surface); border: 1px solid var(--border); border-radius: 14px;">
                <div style="font-size: 0.72rem; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.85rem;">
                    OTHER EVENTS
                </div>
                <div class="timeline" style="margin: 0;">
                    ${unassignedItems.map(renderItem).join('')}
                </div>
            </div>
          `;
        }

        return outputHtml;
      })()}
                </div>
            </div>
        `;
    overlay.style.display = 'flex';
  };

  // Auto click listener delegation
  const gmcStyleId = 'global-machinecard-modal-styles';
  if (!document.getElementById(gmcStyleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = gmcStyleId;
    styleEl.innerHTML = `
            .gmc-modal-overlay {
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 20000;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }
            .gmc-modal {
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: 24px;
                box-shadow: var(--shadow-xl);
                width: 95%;
                max-width: 1400px;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                padding: 2.5rem;
                color: var(--fg);
            }
            .gmc-modal * {
                box-sizing: border-box;
            }
            .gmc-modal .close-btn {
                position: absolute;
                top: 1rem;
                right: 1.25rem;
                background: transparent;
                border: none;
                font-size: 1.5rem;
                cursor: pointer;
                color: var(--muted);
                line-height: 1;
            }
            .gmc-modal .close-btn:hover {
                color: var(--fg);
            }
            .gmc-modal .timeline {
                position: relative;
                padding: 1.5rem 0;
                margin: 1.5rem 0;
            }
            .gmc-modal .timeline::before {
                content: '';
                position: absolute;
                top: 20px;
                bottom: 20px;
                left: 25px;
                width: 4px;
                background: var(--border);
                border-radius: 2px;
            }
            .gmc-modal .timeline-item {
                position: relative;
                margin: 2rem 0;
                clear: both;
            }
            .gmc-modal .timeline-item::after {
                content: '';
                display: table;
                clear: both;
            }
            .gmc-modal .timeline-item:first-child {
                margin-top: 0;
            }
            .gmc-modal .timeline-item:last-child {
                margin-bottom: 0;
            }
            .gmc-modal .timeline-dot {
                position: absolute;
                top: 10px;
                left: 12px;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                border: 4px solid var(--surface) !important;
                box-shadow: 0 0 0 1px var(--border), 0 4px 10px rgba(0, 0, 0, 0.1);
                z-index: 2;
            }
            .gmc-modal .timeline-content {
                position: relative;
                margin-left: 60px;
                background: var(--surface) !important;
                border: 1px solid var(--border) !important;
                border-radius: 12px !important;
                padding: 1.25rem !important;
                box-shadow: var(--shadow-sm);
            }
            .gmc-modal .timeline-content::before {
                content: '';
                position: absolute;
                top: 18px;
                left: -6px;
                width: 10px;
                height: 10px;
                background: var(--surface);
                border-left: 1px solid var(--border);
                border-bottom: 1px solid var(--border);
                transform: rotate(45deg);
                z-index: 1;
            }
            .gmc-modal .timeline-date {
                display: inline-block;
                color: var(--muted);
                font-size: 0.75rem;
                font-weight: 600;
                margin-bottom: 0.25rem;
                font-family: monospace;
            }

        `;
    document.head.appendChild(styleEl);
  }

  function getMachineTimelineData(machine, allBeams, beamLoadings, productionLogs) {
    const machineEvents = [];
    const mNameEscaped = machine.name.toString().replace(/[-\/\^$*+?.()|[\]{}]/g, '\\$&');
    const regex1 = new RegExp('(?:machine|no\\.?|on|from|completed on|unloaded from)\\s*(?:machine\\s+)?\\b' + mNameEscaped + '\\b', 'i');
    const regex2 = new RegExp('\\b' + mNameEscaped + '\\b', 'i');

    const matchesMachine = (eventStr) => {
      if (!eventStr) return false;
      const lower = eventStr.toLowerCase();
      return regex1.test(lower) || regex2.test(lower);
    };

    (machine.history || []).forEach((h, idx) => {
      machineEvents.push({
        sourceType: 'machine_history',
        sourceIndex: idx,
        date: h.date,
        event: h.event,
        type: h.type || 'machine',
        beam: null,
        beamNumber: null,
        category: 'machine-config'
      });
    });

    allBeams.forEach(beam => {
      (beam.history || []).forEach((h, idx) => {
        if (matchesMachine(h.event)) {
          machineEvents.push({
            sourceType: 'beam_history',
            beamId: beam.id,
            sourceIndex: idx,
            date: h.date,
            event: h.event,
            type: h.type || 'system',
            beam: beam,
            beamNumber: beam.beamNumber,
            category: 'history'
          });
        }
      });
    });

    beamLoadings.forEach(bl => {
      if (String(bl.machineNumber).trim() === String(machine.id).trim() || String(bl.machineNumber).trim() === String(machine.name).trim()) {
        let roleLabel = '';
        let workerName = '';
        if (bl.piecein) { roleLabel = 'Piece In'; workerName = bl.piecein; }
        else if (bl.drawingIn) { roleLabel = 'Drawing In'; workerName = bl.drawingIn; }
        else if (bl.fani) { roleLabel = 'Fani (Reed)'; workerName = bl.fani; }
        else if (bl.dropPinJog) { roleLabel = 'Drop pin/Jog'; workerName = bl.dropPinJog; }

        const beam = allBeams.find(b => b.beamNumber === bl.beamNumber);
        machineEvents.push({
          sourceType: 'beam_loading',
          loadingId: bl.id,
          date: bl.date,
          event: roleLabel + " by " + workerName,
          type: 'beam-loading',
          beam: beam,
          beamNumber: bl.beamNumber,
          category: 'derived',
          loadingMeters: bl.meters
        });
      }
    });

    machineEvents.sort((a, b) => a.date.localeCompare(b.date));

    const configEvents = machineEvents.filter(e => e.category === 'machine-config');
    const beamEvents = machineEvents.filter(e => e.category !== 'machine-config');

    const cycles = [];
    let currentCycle = null;

    beamEvents.forEach(item => {
      const eventText = (item.event || '').toLowerCase();
      const isLoad = eventText.includes('pissing') || eventText.includes('piecing') || eventText.includes('loaded') || item.type === 'beam-loading';
      const isUnload = eventText.includes('unloaded') || eventText.includes('completed') || eventText.includes('removed');

      if (isLoad) {
        if (!currentCycle || currentCycle.beamNumber !== item.beamNumber) {
          if (currentCycle) {
            currentCycle.endDate = item.date;
          }
          currentCycle = {
            beam: item.beam,
            beamNumber: item.beamNumber,
            startDate: item.date,
            endDate: null,
            logs: [],
            events: [item]
          };
          cycles.push(currentCycle);
        } else {
          currentCycle.events.push(item);
        }
      } else if (isUnload) {
        if (currentCycle && currentCycle.beamNumber === item.beamNumber) {
          currentCycle.endDate = item.date;
          currentCycle.events.push(item);
          currentCycle = null;
        } else {
          const openCycle = cycles.find(c => c.beamNumber === item.beamNumber && !c.endDate);
          if (openCycle) {
            openCycle.endDate = item.date;
            openCycle.events.push(item);
          } else {
            cycles.push({
              beam: item.beam,
              beamNumber: item.beamNumber,
              startDate: item.date,
              endDate: item.date,
              logs: [],
              events: [item]
            });
          }
        }
      } else {
        if (currentCycle) {
          currentCycle.events.push(item);
        } else {
          const lastCycle = [...cycles].reverse().find(c => c.beamNumber === item.beamNumber);
          if (lastCycle) {
            lastCycle.events.push(item);
          } else {
            cycles.push({
              beam: item.beam,
              beamNumber: item.beamNumber,
              startDate: item.date,
              endDate: item.date,
              logs: [],
              events: [item]
            });
          }
        }
      }
    });

    cycles.forEach(c => {
      if (!c.endDate) {
        c.endDate = '9999-12-31';
      }
    });

    const machineLogs = productionLogs.filter(log =>
      String(log.machineNumber).trim() === String(machine.id).trim() ||
      String(log.machineNumber).trim() === String(machine.name).trim()
    );

    machineLogs.forEach(log => {
      let bestCycle = null;
      cycles.forEach(cycle => {
        if (cycle.beamNumber === log.beamNumber) {
          if (log.productionDate >= cycle.startDate && log.productionDate <= cycle.endDate) {
            if (!bestCycle || cycle.startDate > bestCycle.startDate) {
              bestCycle = cycle;
            }
          }
        }
      });

      if (bestCycle) {
        bestCycle.logs.push({
          productionDate: log.productionDate,
          foldingDate: log.foldingDate,
          takaSerial: log.takaSerial || 'Pending',
          meters: parseFloat(log.totalMeters) || 0,
          weight: parseFloat(log.takaWeight) || 0
        });
      } else {
        const sameBeamCycles = cycles.filter(c => c.beamNumber === log.beamNumber);
        if (sameBeamCycles.length > 0) {
          sameBeamCycles[sameBeamCycles.length - 1].logs.push({
            productionDate: log.productionDate,
            foldingDate: log.foldingDate,
            takaSerial: log.takaSerial || 'Pending',
            meters: parseFloat(log.totalMeters) || 0,
            weight: parseFloat(log.takaWeight) || 0
          });
        } else {
          const beam = allBeams.find(b => b.beamNumber === log.beamNumber);
          const newCycle = {
            beam: beam,
            beamNumber: log.beamNumber,
            startDate: log.productionDate,
            endDate: '9999-12-31',
            logs: [{
              productionDate: log.productionDate,
              foldingDate: log.foldingDate,
              takaSerial: log.takaSerial || 'Pending',
              meters: parseFloat(log.totalMeters) || 0,
              weight: parseFloat(log.takaWeight) || 0
            }],
            events: [{
              date: log.productionDate,
              event: 'Production started',
              type: 'production',
              beamNumber: log.beamNumber,
              beam: beam,
              category: 'derived'
            }]
          };
          cycles.push(newCycle);
        }
      }
    });

    const finalTimeline = [];
    cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));

    cycles.filter(c => c.logs.length > 0).forEach(cycle => {
      cycle.events.sort((a, b) => a.date.localeCompare(b.date));
      cycle.logs.sort((a, b) => a.productionDate.localeCompare(b.productionDate));

      let prodEvent = null;
      if (cycle.logs.length > 0) {
        const subTotalMeters = cycle.logs.reduce((acc, l) => acc + l.meters, 0);
        const uniqueTakas = {};
        cycle.logs.forEach(l => {
          if (l.takaSerial && l.takaSerial !== 'Pending') {
            uniqueTakas[l.takaSerial] = l.weight;
          }
        });
        const subTotalWeight = Object.values(uniqueTakas).reduce((acc, w) => acc + w, 0);
        const firstProdDate = cycle.logs[0].productionDate;

        prodEvent = {
          date: firstProdDate,
          event: 'Production Details for Beam #' + cycle.beamNumber,
          type: 'production',
          category: 'derived',
          details: {
            beamNumber: cycle.beamNumber,
            logs: cycle.logs,
            subTotalMeters,
            subTotalWeight
          }
        };
      }

      const cycleItems = [...cycle.events];
      if (prodEvent) {
        cycleItems.push(prodEvent);
      }

      const getItemRank = (item) => {
        const evt = (item.event || '').toLowerCase();
        const type = item.type;
        if (evt.includes('manufactured') || evt.includes('created')) return 1;
        if (evt.includes('beam loaded') || evt.includes('loaded on') || evt.includes('loaded')) return 2;
        if (evt.includes('piece in') || evt.includes('pissing') || evt.includes('drawing in') || evt.includes('fani') || evt.includes('drop pin')) return 3;
        if (type === 'production' || evt.includes('production details')) return 4;
        if (evt.includes('unloaded') || evt.includes('completed') || evt.includes('removed')) return 5;
        return 3;
      };

      cycleItems.sort((a, b) => {
        const dateComp = (a.date || '').localeCompare(b.date || '');
        if (dateComp !== 0) return dateComp;
        return getItemRank(a) - getItemRank(b);
      });

      cycleItems.forEach(item => {
        let displayEvent = item.event;
        const bInfo = item.beam ? (" " + getBeamDetailsStr(item.beam, item.date, productionLogs)) : '';
        if (item.type !== 'production' && item.category !== 'machine-config' && item.beamNumber) {
          displayEvent = item.event + " - Beam #" + item.beamNumber + bInfo;
        }
        finalTimeline.push({
          ...item,
          event: displayEvent
        });
      });
    });

    configEvents.forEach(item => finalTimeline.push(item));

    const getFinalItemRank = (item) => {
      const evt = (item.event || '').toLowerCase();
      const type = item.type;
      if (evt.includes('manufactured') || evt.includes('created')) return 1;
      if (evt.includes('beam loaded') || evt.includes('loaded on') || evt.includes('loaded')) return 2;
      if (evt.includes('piece in') || evt.includes('pissing') || evt.includes('drawing in') || evt.includes('fani') || evt.includes('drop pin')) return 3;
      if (type === 'production' || evt.includes('production details')) return 4;
      if (evt.includes('unloaded') || evt.includes('completed') || evt.includes('removed')) return 5;
      return 3;
    };

    finalTimeline.sort((a, b) => {
      const dateComp = (a.date || '').localeCompare(b.date || '');
      if (dateComp !== 0) return dateComp;
      return getFinalItemRank(a) - getFinalItemRank(b);
    });

    return finalTimeline;
  }

  window.deleteTimelineEvent = function (machineId, sourceType, sourceIndex, beamId, loadingId, beamNumber) {
    if (!confirm('Are you sure you want to delete/cancel this event?')) return;

    let updated = false;

    if (sourceType === 'machine_history') {
      let machinesList = [];
      try { machinesList = JSON.parse(localStorage.getItem('machines') || '[]'); } catch (e) { }
      if ((!machinesList || !machinesList.length) && window.state && Array.isArray(window.state.machines)) {
        machinesList = window.state.machines;
      }

      let machine = machinesList.find(m => String(m.id).trim() === String(machineId).trim() || String(m.name).trim() === String(machineId).trim());
      let stateMachine = null;
      if (window.state && Array.isArray(window.state.machines)) {
        stateMachine = window.state.machines.find(m => String(m.id).trim() === String(machineId).trim() || String(m.name).trim() === String(machineId).trim());
      }

      const targetMachine = machine || stateMachine;
      if (targetMachine && targetMachine.history && targetMachine.history[sourceIndex] !== undefined) {
        const deletedEvent = targetMachine.history.splice(parseInt(sourceIndex, 10), 1)[0];
        if (machine && stateMachine && machine !== stateMachine && stateMachine.history) {
          const idxInState = stateMachine.history.findIndex((h, i) => i === parseInt(sourceIndex, 10) || (h.event === deletedEvent.event && h.date === deletedEvent.date));
          if (idxInState !== -1) stateMachine.history.splice(idxInState, 1);
        }
        const delText = deletedEvent ? (deletedEvent.event || '') : '';

        const applyRevert = (m) => {
          if (!m) return;
          // Jala
          const jalaEvents = (m.history || []).filter(h => h.event && (h.event.toLowerCase().includes('jala:') || h.event.toLowerCase().includes('jala')));
          if (jalaEvents.length > 0) {
            const lastJalaEvent = jalaEvents[jalaEvents.length - 1];
            const cleanTxt = lastJalaEvent.event.replace(/<[^>]*>/g, '');
            const parts = cleanTxt.split(/→|to/i);
            if (parts.length > 1) m.jala = parts[parts.length - 1].trim();
          } else if (delText.toLowerCase().includes('jala')) {
            const parts = delText.split(/→|to/i);
            if (parts.length > 1) {
              const leftPart = parts[0].replace(/.*jala.*changed:\s*/i, '').trim();
              if (leftPart && leftPart.toLowerCase() !== 'none') m.jala = leftPart;
            }
          }

          // Fani
          const faniEvents = (m.history || []).filter(h => h.event && h.event.toLowerCase().includes('fani'));
          if (faniEvents.length > 0) {
            const lastFaniEvent = faniEvents[faniEvents.length - 1];
            const cleanTxt = lastFaniEvent.event.replace(/<[^>]*>/g, '');
            const parts = cleanTxt.split(/→|to/i);
            if (parts.length > 1) m.fani = parts[parts.length - 1].trim();
          } else if (delText.toLowerCase().includes('fani')) {
            const parts = delText.split(/→|to/i);
            if (parts.length > 1) {
              const leftPart = parts[0].replace(/.*fani.*changed:\s*/i, '').trim();
              if (leftPart && leftPart.toLowerCase() !== 'none') m.fani = leftPart;
              else m.fani = '';
            }
          }

          // Jacquard
          const jacquardEvents = (m.history || []).filter(h => h.event && h.event.toLowerCase().includes('jacquard'));
          if (jacquardEvents.length > 0) {
            const lastJacquardEvent = jacquardEvents[jacquardEvents.length - 1];
            const cleanTxt = lastJacquardEvent.event.replace(/<[^>]*>/g, '');
            const parts = cleanTxt.split(/→|to/i);
            if (parts.length > 1) {
              const val = parts[parts.length - 1].trim();
              const match = val.match(/(.*?)\s*\((.*?)\s*hooks?\)/i) || val.match(/(.*?)\s*\((.*?)\)/i);
              if (match) {
                m.jacquard = match[1].trim();
                m.hooks = match[2].replace(/\D/g, '') || m.hooks;
              } else {
                m.jacquard = val;
              }
            }
          } else if (delText.toLowerCase().includes('jacquard')) {
            const parts = delText.split(/→|to/i);
            if (parts.length > 1) {
              const leftPart = parts[0].replace(/.*jacquard.*changed:\s*/i, '').trim();
              if (leftPart && leftPart.toLowerCase() !== 'none') {
                const match = leftPart.match(/(.*?)\s*\((.*?)\s*hooks?\)/i) || leftPart.match(/(.*?)\s*\((.*?)\)/i);
                if (match) {
                  m.jacquard = match[1].trim();
                  m.hooks = match[2].replace(/\D/g, '') || m.hooks;
                } else {
                  m.jacquard = leftPart;
                }
              } else {
                m.jacquard = '';
                m.hooks = '';
              }
            }
          }
        };

        applyRevert(machine);
        applyRevert(stateMachine);

        if (machinesList && machinesList.length) {
          localStorage.setItem('machines', JSON.stringify(machinesList));
        }
        if (window.state && window.state.machines) {
          localStorage.setItem('machines', JSON.stringify(window.state.machines));
        }
        if (window.saveState && typeof window.saveState === 'function') {
          window.saveState();
        }
        window.dispatchEvent(new Event('storage'));
        updated = true;
      }
    } else if (sourceType === 'beam_history') {
      let allBeams = [];
      try { allBeams = JSON.parse(localStorage.getItem('warp-beams') || '[]'); } catch (e) { }
      if ((!allBeams || !allBeams.length) && window.state && Array.isArray(window.state.beams)) {
        allBeams = window.state.beams;
      }
      const beam = allBeams.find(b => String(b.id) === String(beamId));
      if (beam && beam.history && beam.history[sourceIndex] !== undefined) {
        beam.history.splice(parseInt(sourceIndex, 10), 1);
        localStorage.setItem('warp-beams', JSON.stringify(allBeams));
        window.dispatchEvent(new Event('storage'));
        updated = true;
      }
    } else if (sourceType === 'beam_loading') {
      let beamLoadings = [];
      try { beamLoadings = JSON.parse(localStorage.getItem('warp-beam-loadings') || '[]'); } catch (e) { }
      const newLoadings = beamLoadings.filter(bl => String(bl.id) !== String(loadingId));
      if (newLoadings.length !== beamLoadings.length) {
        localStorage.setItem('warp-beam-loadings', JSON.stringify(newLoadings));
        window.dispatchEvent(new Event('storage'));
        updated = true;
      }
    } else if (sourceType === 'production_logs') {
      let productionLogs = [];
      try { productionLogs = JSON.parse(localStorage.getItem('productionLogs') || '[]'); } catch (e) { }
      if ((!productionLogs || !productionLogs.length) && window.state && Array.isArray(window.state.productionLogs)) {
        productionLogs = window.state.productionLogs;
      }
      const newLogs = productionLogs.filter(l => !((String(l.machineNumber).trim() === String(machineId).trim()) && String(l.beamNumber).trim() === String(beamNumber).trim()));
      if (newLogs.length !== productionLogs.length) {
        localStorage.setItem('productionLogs', JSON.stringify(newLogs));
        if (window.state && window.state.productionLogs) {
          window.state.productionLogs = window.state.productionLogs.filter(l => !((String(l.machineNumber).trim() === String(machineId).trim()) && String(l.beamNumber).trim() === String(beamNumber).trim()));
        }
        window.dispatchEvent(new Event('storage'));
        updated = true;
      }
    }

    if (updated) {
      if (window.state && window.state.machines && (!machinesList || !machinesList.length)) {
        try { localStorage.setItem('machines', JSON.stringify(window.state.machines)); } catch (e) { }
      }
      if (typeof window.renderMachines === 'function') window.renderMachines();
      if (typeof window.renderAll === 'function') window.renderAll();

      if (typeof window.showGlobalMachineCard === 'function') {
        try { window.showGlobalMachineCard(machineId); } catch (e) { }
      } else if (typeof window.openMachineDetailsModal === 'function') {
        try { window.openMachineDetailsModal(machineId); } catch (e) { }
      }
    }
  };

  window.showGlobalMachineCard = function (machineId) {
    if (!machineId) return;

    let machinesList = [];
    try {
      machinesList = JSON.parse(localStorage.getItem('machines') || '[]');
    } catch (e) { }
    if ((!machinesList || !machinesList.length) && window.state && Array.isArray(window.state.machines)) {
      machinesList = window.state.machines;
    }

    let machine = machinesList.find(m => String(m.id).trim() === String(machineId).trim() || String(m.name).trim() === String(machineId).trim());
    if (!machine && window.state && Array.isArray(window.state.machines)) {
      machine = window.state.machines.find(m => String(m.id).trim() === String(machineId).trim() || String(m.name).trim() === String(machineId).trim());
    }
    if (!machine) {
      alert(`Machine #${machineId} not found.`);
      return;
    }

    let allBeams = [];
    try {
      allBeams = JSON.parse(localStorage.getItem('warp-beams') || '[]');
    } catch (e) { }
    if ((!allBeams || !allBeams.length) && window.state && Array.isArray(window.state.beams)) {
      allBeams = window.state.beams;
    }

    let productionLogs = [];
    try {
      productionLogs = JSON.parse(localStorage.getItem('productionLogs') || '[]');
    } catch (e) { }
    if ((!productionLogs || !productionLogs.length) && window.state && Array.isArray(window.state.productionLogs)) {
      productionLogs = window.state.productionLogs;
    }

    let beamLoadings = [];
    try {
      beamLoadings = JSON.parse(localStorage.getItem('warp-beam-loadings') || '[]');
    } catch (e) { }
    if ((!beamLoadings || !beamLoadings.length) && window.state && Array.isArray(window.state.beamLoadings)) {
      beamLoadings = window.state.beamLoadings;
    }

    const activeBeam = allBeams.find(b => {
      const mLower = String(machine.name).toLowerCase();
      const bmLower = String(b.machineNumber || '').toLowerCase();
      return b.status !== 'Completed' && (bmLower === mLower || bmLower === String(machine.id).toLowerCase());
    });

    const machineLogs = productionLogs.filter(l =>
      String(l.machineNumber).trim() === String(machine.id).trim() ||
      String(l.machineNumber).trim() === String(machine.name).trim()
    );
    const totalMeters = machineLogs.reduce((acc, log) => acc + (parseFloat(log.totalMeters) || 0), 0);

    const beamNumbersSet = new Set();
    machineLogs.forEach(l => { if (l.beamNumber) beamNumbersSet.add(l.beamNumber); });
    beamLoadings.forEach(bl => {
      if (String(bl.machineNumber).trim() === String(machine.id).trim() || String(bl.machineNumber).trim() === String(machine.name).trim()) {
        if (bl.beamNumber) beamNumbersSet.add(bl.beamNumber);
      }
    });
    allBeams.forEach(b => {
      const matchesMachine = (eventStr) => {
        if (!eventStr) return false;
        const lower = eventStr.toLowerCase();
        const mNameEscaped = machine.name.toString().replace(/[-\/\^$*+?.()|[\]{}]/g, '\\$&');
        const regex1 = new RegExp('(?:machine|no\\.?|on|from|completed on|unloaded from)\\s*(?:machine\\s+)?\\b' + mNameEscaped + '\\b', 'i');
        const regex2 = new RegExp('\\b' + mNameEscaped + '\\b', 'i');
        return regex1.test(lower) || regex2.test(lower);
      };
      if (b.beamNumber && (b.history || []).some(h => matchesMachine(h.event))) {
        beamNumbersSet.add(b.beamNumber);
      }
    });
    const totalBeamsRun = beamNumbersSet.size;

    const timeline = getMachineTimelineData(machine, allBeams, beamLoadings, productionLogs);

    let jalasList = [];
    try {
      jalasList = JSON.parse(localStorage.getItem('jalas') || '[]');
    } catch (e) { }
    const matchingJala = jalasList.find(j => j.name === machine.jala);
    const jalaStr = matchingJala ? (machine.jala + " (" + matchingJala.ends + " hooks)") : (machine.jala || '-');

    let activeBeamVal = 'None';
    let activeBadge = '<span style="color: var(--muted);">—</span>';
    let activeBg = 'var(--bg)';
    let activeBorder = 'var(--border)';
    if (activeBeam) {
      activeBeamVal = `<span style="cursor: pointer; color: var(--accent); font-weight: 700; text-decoration: underline;" onclick="window.showGlobalBeamCard('${activeBeam.beamNumber}')">Beam #${activeBeam.beamNumber}</span>`;
      activeBadge = '<span class="badge badge-on-loom" style="font-size: 0.6rem; padding: 1px 6px; background: rgba(139, 92, 246, 0.1); color: var(--accent); border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 6px; font-weight:700;">ON LOOM</span>';
      activeBg = 'rgba(139, 92, 246, 0.05)';
      activeBorder = 'var(--accent)';
    }

    const formatDate = (dateStr) => {
      if (!dateStr || dateStr === '9999-12-31') return '';
      try {
        const parts = String(dateStr).split('T')[0].split('-');
        if (parts.length === 3) {
          const d = new Date(parts[0], parts[1] - 1, parts[2]);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[d.getMonth()];
            const year = d.getFullYear();
            return `${day} ${month} ${year}`;
          }
        }
      } catch (e) { }
      return dateStr;
    };

    let overlay = document.getElementById('global-machinecard-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'global-machinecard-overlay';
      overlay.className = 'gmc-modal-overlay';
      overlay.onclick = () => { overlay.style.display = 'none'; };
      document.body.appendChild(overlay);
    }

    const lastMachineHistoryIndex = timeline.findLastIndex(item => item.sourceType === 'machine_history');

    overlay.innerHTML = `
            <div class="gmc-modal" onclick="event.stopPropagation()">
                <button type="button" class="close-btn" onclick="document.getElementById('global-machinecard-overlay').style.display='none'">&times;</button>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                    <div>
                        <h2 style="margin: 0; font-family: var(--font-display); font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; font-size: 1.3rem;">MACHINE CARD #${machine.name}</h2>
                        <p style="color: var(--muted); font-size: 0.85rem; margin: 0.25rem 0 0 0;">${machine.rapier || '-'} Loom Make | Jacquard: ${machine.jacquard || '-'} (${machine.hooks || '-'} hooks)</p>
                    </div>
                </div>
                
                <!-- Stats Grid -->
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 2rem;">
                    <div class="card" style="background: var(--bg); margin: 0; padding: 1rem; border: 1px solid var(--border); border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600; text-transform: uppercase;">JALA & FANI</div>
                        <div style="font-size: 1.1rem; font-weight: 700; margin-top: 0.25rem;">Jala: ${jalaStr}</div>
                        <div style="font-size: 0.85rem; color: var(--muted); margin-top: 0.25rem;">Fani (Reed): ${matchingJala ? `${matchingJala.stockportReed || 0} x ${matchingJala.fabricWidth || 0}` : (machine.fani || '-')}</div>
                    </div>
                    <div class="card" style="background: var(--bg); margin: 0; padding: 1rem; border: 1px solid var(--border); border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600; text-transform: uppercase;">TOTAL PRODUCTION</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: var(--accent); margin-top: 0.25rem;">${totalMeters.toFixed(1)} m</div>
                        <div style="font-size: 0.85rem; color: var(--muted); margin-top: 0.25rem;">Across ${machineLogs.length} logs</div>
                    </div>
                    <div class="card" style="background: var(--bg); margin: 0; padding: 1rem; border: 1px solid var(--border); border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600; text-transform: uppercase;">BEAMS RUN</div>
                        <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${totalBeamsRun}</div>
                        <div style="font-size: 0.85rem; color: var(--muted); margin-top: 0.25rem;">Unique beams loaded</div>
                    </div>
                    <div class="card" style="background: ${activeBg}; border: 1px solid ${activeBorder}; margin: 0; padding: 1rem; border-radius: 12px;">
                        <div style="font-size: 0.7rem; color: var(--muted); font-weight: 600; text-transform: uppercase;">CURRENT ACTIVE BEAM</div>
                        <div style="font-size: 1.25rem; font-weight: 700; color: ${activeBeam ? 'var(--accent)' : 'var(--muted)'}; margin-top: 0.25rem;">${activeBeamVal}</div>
                        <div style="font-size: 0.8rem; margin-top: 0.25rem;">${activeBadge}</div>
                    </div>
                </div>

                <h3 class="display-font" style="font-size: 1.05rem; font-weight: 700; margin-bottom: 1rem; color: var(--fg);">Machine History & Beam Timeline</h3>
                
                <!-- Timeline container -->
                <div class="timeline" style="margin-bottom: 1rem;">
                    ${(() => {
        if (timeline.length === 0) {
          return '<div style="color: var(--muted); font-style: italic; font-size: 0.85rem; padding: 1rem 0;">No history found for this machine.</div>';
        }
        return timeline.map((h, index) => {
          const dotBg = h.type === 'machine' ? 'var(--accent3)' : (h.type === 'production' ? 'var(--success)' : (h.type === 'beam-loading' ? 'var(--accent2)' : 'var(--accent)'));
          const isProd = h.type === 'production';
          const isCancelable = (index === timeline.length - 1 || index === lastMachineHistoryIndex);

          let deleteBtnHtml = '';
          if (isCancelable && h.sourceType === 'machine_history' && h.type !== 'production') {
            deleteBtnHtml = `<button type="button" class="btn btn-sm" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; cursor: pointer; flex-shrink: 0; font-weight: 700; display: inline-flex; align-items: center; gap: 0.25rem;" onclick="window.deleteTimelineEvent('${machine.id}', '${h.sourceType || ''}', '${h.sourceIndex !== undefined ? h.sourceIndex : ''}', '${h.beamId || ''}', '${h.loadingId || ''}', '${h.details && h.details.beamNumber ? h.details.beamNumber : ''}')">✕ Cancel Event</button>`;
          }

          let contentHtml = '';
          if (isProd && h.details && h.details.logs) {
            const grouped = [];
            const takaGroups = {};
            h.details.logs.forEach(log => {
              const serial = log.takaSerial;
              if (!serial || serial === 'Pending') {
                grouped.push({
                  productionDates: [log.productionDate],
                  foldingDates: log.foldingDate ? [log.foldingDate] : [],
                  takaSerial: serial || 'Pending',
                  meters: log.meters,
                  weight: log.weight
                });
              } else {
                if (!takaGroups[serial]) {
                  takaGroups[serial] = {
                    productionDates: [],
                    foldingDates: [],
                    takaSerial: serial,
                    meters: 0,
                    weight: 0
                  };
                  grouped.push(takaGroups[serial]);
                }
                if (!takaGroups[serial].productionDates.includes(log.productionDate)) {
                  takaGroups[serial].productionDates.push(log.productionDate);
                }
                if (log.foldingDate && !takaGroups[serial].foldingDates.includes(log.foldingDate)) {
                  takaGroups[serial].foldingDates.push(log.foldingDate);
                }
                takaGroups[serial].meters += log.meters;
                takaGroups[serial].weight = Math.max(takaGroups[serial].weight, log.weight);
              }
            });

            const rowsHtml = grouped.map((g, idx) => {
              const pDates = g.productionDates.map(d => `<div style="white-space: nowrap;">${formatDate(d)}</div>`).join('');
              const fDates = g.foldingDates.length > 0 ? g.foldingDates.map(d => `<div style="white-space: nowrap;">${formatDate(d)}</div>`).join('') : '—';
              return `<tr>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">${pDates}</td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">${fDates}</td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; border-bottom: none; font-weight: 500; color: var(--fg); vertical-align: top; width: 20%;">${g.takaSerial}</td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; font-weight: 600; border-bottom: none; color: var(--accent); vertical-align: top; width: 20%;">${g.meters.toFixed(1)} m</td>
                                        <td style="padding: 0.3rem 0.6rem; font-size: 0.8rem; text-align: center; font-weight: 600; border-bottom: none; color: var(--fg); vertical-align: top; width: 20%;">${g.weight > 0 ? g.weight.toFixed(2) + ' kg' : '—'}</td>
                                    </tr>`;
            }).join('');

            contentHtml = `
                                    <div style="padding: 0.75rem; margin-top: 0.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; width: 100%; overflow-x: auto;">
                                        <table style="width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.8rem; text-align: center;">
                                            <thead>
                                                <tr>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Prod. Date</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Folding Date</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Taka Serial</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Meters</th>
                                                    <th style="font-size: 0.7rem; padding: 0.3rem 0.6rem; text-align: center; background: transparent; border-bottom: 1px solid var(--border); color: var(--muted); width: 20%;">Weight</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${rowsHtml}
                                                <tr style="border-top: 2px solid var(--border); font-weight: 700;">
                                                    <td colspan="3" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; text-align: center; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;">Sub Total</td>
                                                    <td style="padding: 0.4rem 0.6rem; font-size: 0.8rem; text-align: center; color: var(--accent);">${h.details.subTotalMeters.toFixed(1)} m</td>
                                                    <td style="padding: 0.4rem 0.6rem; font-size: 0.8rem; text-align: center; color: var(--accent);">${h.details.subTotalWeight > 0 ? h.details.subTotalWeight.toFixed(2) + ' kg' : '—'}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                `;
          }

          return `
                                <div class="timeline-item">
                                    <div class="timeline-dot" style="background: ${dotBg};"></div>
                                    <div class="timeline-content">
                                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: ${isProd ? '0.5rem' : '0'};">
                                            <div>
                                                <div class="timeline-date">${(isProd || h.hideDate) ? '' : formatDate(h.date)}</div>
                                                <div style="font-weight: 600; color: var(--fg);">${h.event}</div>
                                            </div>
                                            ${deleteBtnHtml}
                                        </div>
                                        ${contentHtml}
                                    </div>
                                </div>
                            `;
        }).join('');
      })()}
                </div>
            </div>
        `;
    overlay.style.display = 'flex';
  };

  // Override local functions if loaded
  window.openMachineDetailsModal = window.showGlobalMachineCard;

  document.addEventListener('click', function (e) {
    // Exclude inputs, dropdowns, selects, textareas, toasts to prevent cards from opening on selection
    if (e.target.closest('select') ||
      e.target.closest('input') ||
      e.target.closest('textarea') ||
      e.target.closest('#toast-container') ||
      e.target.closest('.toast-container') ||
      e.target.closest('.toast') ||
      e.target.closest('.dropdown-list') ||
      e.target.closest('.dropdown-menu') ||
      e.target.closest('.dropdown-item') ||
      e.target.closest('.select-input-wrapper') ||
      e.target.closest('[class*="dropdown"]') ||
      e.target.closest('[class*="select"]')) {
      return;
    }

    // Exclude beam tracker tab
    const isBeamTrackerTab = window.location.pathname.includes('warp') &&
      (document.querySelector('.nav-tab.active')?.textContent.includes('Beam tracker') ||
        document.querySelector('.nav-tab.active')?.textContent.includes('tracker'));

    if (isBeamTrackerTab) return;

    // Find the actual clickable trigger target
    const trigger = e.target.closest('.clickable-trigger') || e.target.closest('#rb-beam-no');
    if (!trigger) return;

    // Match span id='rb-beam-no'
    if (trigger.id === 'rb-beam-no' && trigger.innerText.trim()) {
      let allBeams = [];
      try {
        allBeams = JSON.parse(localStorage.getItem('warp-beams') || '[]');
      } catch (e) { }
      const exists = allBeams.some(b => String(b.beamNumber).trim().toLowerCase() === String(trigger.innerText.trim()).toLowerCase());
      if (exists) {
        e.preventDefault();
        e.stopPropagation();
        window.showGlobalBeamCard(trigger.innerText.trim());
        return;
      }
    }

    // Match exact "Beam #101" patterns in text (e.g. from labels, timelines)
    let text = trigger.innerText || '';
    let match = text.match(/Beam\s*#\s*([A-Za-z0-9\-]+)/i);
    if (match && match[1]) {
      if (beamExists(match[1])) {
        e.preventDefault();
        e.stopPropagation();
        window.showGlobalBeamCard(match[1]);
        return;
      }
    }

    // Match exact "Machine #X" or "Machine X" patterns in text (e.g. "Machine 1", "Machine #1")
    let mMatch = text.match(/(?:Machine|Loom)\s*#?\s*([A-Za-z0-9\-]+)/i);
    if (mMatch && mMatch[1] && !trigger.closest('select') && !trigger.closest('input')) {
      if (machineExists(mMatch[1])) {
        e.preventDefault();
        e.stopPropagation();
        window.showGlobalMachineCard(mMatch[1]);
        return;
      }
    }

    // Match table columns under Machine/Loom header
    let cell = trigger.closest('td');
    if (cell && !trigger.closest('button') && !trigger.closest('input') && !trigger.closest('a') && !trigger.closest('select')) {
      let index = cell.cellIndex;
      let table = cell.closest('table');
      if (table) {
        let ths = table.querySelectorAll('thead tr th');
        if (ths.length > index) {
          let thText = ths[index].innerText.toLowerCase();
          if (thText.includes('machine') || thText.includes('loom')) {
            let val = cell.innerText.trim();
            let exactMatch = val.match(/(?:Machine|Loom)?\s*#?\s*([A-Za-z0-9\-]+)/i);
            if (exactMatch && exactMatch[1] && exactMatch[1] !== '-') {
              if (machineExists(exactMatch[1])) {
                e.preventDefault();
                e.stopPropagation();
                window.showGlobalMachineCard(exactMatch[1]);
                return;
              }
            }
          }
        }
      }
    }
  });

  // --- Auto-underline and highlight clickable triggers ---
  let cachedMachines = null;
  let cachedBeams = null;

  function getMachinesList() {
    if (cachedMachines) return cachedMachines;
    try {
      cachedMachines = JSON.parse(localStorage.getItem('machines') || '[]');
    } catch (e) { }
    if (!cachedMachines || !cachedMachines.length) {
      cachedMachines = [];
    }
    return cachedMachines;
  }

  function getBeamsList() {
    if (cachedBeams) return cachedBeams;
    try {
      cachedBeams = JSON.parse(localStorage.getItem('warp-beams') || '[]');
    } catch (e) { }
    return cachedBeams || [];
  }

  function machineExists(name) {
    const list = getMachinesList();
    return list.some(m => String(m.id).trim().toLowerCase() === String(name).trim().toLowerCase() || String(m.name).trim().toLowerCase() === String(name).trim().toLowerCase());
  }

  function beamExists(num) {
    const list = getBeamsList();
    return list.some(b => String(b.beamNumber).trim().toLowerCase() === String(num).trim().toLowerCase());
  }

  function enhanceClickables() {
    // 1. Scan tables for Machine/Loom headers and add clickable-trigger
    document.querySelectorAll('table').forEach(table => {
      const ths = table.querySelectorAll('thead tr th');
      ths.forEach((th, index) => {
        const thText = th.innerText.toLowerCase();
        if (thText.includes('machine') || thText.includes('loom')) {
          table.querySelectorAll(`tbody tr td:nth-child(${index + 1})`).forEach(cell => {
            if (cell.classList.contains('clickable-trigger')) return;
            if (cell.querySelector('button') || cell.querySelector('input') || cell.querySelector('select') || cell.querySelector('a')) return;

            let val = cell.innerText.trim();
            let exactMatch = val.match(/(?:Machine|Loom)?\s*#?\s*([A-Za-z0-9\-]+)/i);
            if (exactMatch && exactMatch[1] && exactMatch[1] !== '-') {
              if (machineExists(exactMatch[1])) {
                cell.classList.add('clickable-trigger');
                cell.title = "Click to view Machine details";
              }
            }
          });
        }
      });
    });

    // 2. Scan elements containing text patterns like Beam #101 or Machine #2
    const elements = document.querySelectorAll('p, span, div, td, li, label, strong, em, td a');
    elements.forEach(el => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if (el.closest('.clickable-trigger')) return;
      if (el.querySelector('.clickable-trigger')) return;
      if (el.closest('.dropdown-list') || el.closest('.dropdown-item') || el.closest('.select-input-wrapper')) return;

      let hasChanged = false;
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
          let val = node.nodeValue;
          let replaced = val;

          replaced = replaced.replace(/Beam\s*#\s*([A-Za-z0-9\-]+)/gi, (fullMatch, beamNo) => {
            if (beamExists(beamNo)) {
              hasChanged = true;
              return `<span class="clickable-trigger" title="Click to view Beam details">${fullMatch}</span>`;
            }
            return fullMatch;
          });

          replaced = replaced.replace(/(Machine|Loom)\s*#\s*([A-Za-z0-9\-]+)/gi, (fullMatch, prefix, machNo) => {
            if (machineExists(machNo)) {
              hasChanged = true;
              return `<span class="clickable-trigger" title="Click to view Machine details">${fullMatch}</span>`;
            }
            return fullMatch;
          });

          if (hasChanged) {
            const tempSpan = document.createElement('span');
            tempSpan.innerHTML = replaced;
            node.replaceWith(tempSpan);
          }
        }
      });
    });

    // 3. Highlight id="rb-beam-no"
    document.querySelectorAll('#rb-beam-no').forEach(el => {
      if (el.classList.contains('clickable-trigger')) return;
      const beamNo = el.innerText.trim();
      if (beamNo && beamExists(beamNo)) {
        el.classList.add('clickable-trigger');
        el.title = "Click to view Beam details";
      }
    });
  }

  window.escapeHtml = function (text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Upgrade native filter <select>s to contained custom menus (mobile/tablet + DevTools).
  // Keeps the original <select> in the DOM so existing onchange handlers keep working.
  function enhanceNativeFilterSelects() {
    const ids = [
      'filter-machine', 'filter-worker',
      'bl-filter-role', 'bl-filter-machine', 'bl-filter-sort',
      'catalog-machine-filter', 'log-filter-type', 'log-sort-order',
      'prod-stock-filter', 'stock-dash-group-by', 'filter-process',
      // Staff + Loans (native OS popups overflow on phone)
      'loan-emp-select', 'loan-term-select',
      'team-emp-role', 'team-emp-machine', 'team-emp-salary-style',
      'roster-role-filter-select',
      // Manage → Machines (+ related)
      'new-machine-rapier', 'new-machine-jacquard', 'new-machine-jala',
      'new-quality-type', 'new-quality-supplier',
      'edit-emp-role', 'edit-emp-machine', 'edit-emp-salary-style',
      // Machine Parts
      'console-part', 'quick-part-select', 'quick-type-select', 'modal-part-machine',
      // EP Parser
      'select-view-mode', 'select-harness-mode', 'select-matrix-view',
      // Cast-out calculator
      'jalaSelect'
    ];

    const selectSet = new Set();
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.tagName === 'SELECT') selectSet.add(el);
    });
    // Yarn/weaving costing input tables — native OS menus overflow past the card on phone
    document.querySelectorAll(
      '.sidebar .input-card select, .input-card select, main.flex .sidebar select'
    ).forEach((el) => {
      if (el && el.tagName === 'SELECT') selectSet.add(el);
    });

    const placeListInView = (btn, list) => {
      const set = (prop, value) => list.style.setProperty(prop, value, 'important');

      // Keep menu locked to the trigger width (avoids native OS popup overflow +
      // broken fixed positioning inside transformed .input-card ancestors).
      set('position', 'absolute');
      set('left', '0');
      set('right', '0');
      set('top', 'calc(100% + 4px)');
      set('bottom', 'auto');
      set('width', '100%');
      set('max-width', '100%');
      set('min-width', '0');
      set('max-height', '240px');

      if (window.innerWidth > 1024) return;

      const rect = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      if (spaceBelow < 160 && spaceAbove > spaceBelow) {
        set('top', 'auto');
        set('bottom', 'calc(100% + 4px)');
        set('max-height', `${Math.max(140, spaceAbove - 8)}px`);
      } else {
        set('max-height', `${Math.max(140, Math.min(240, spaceBelow - 8))}px`);
      }
    };

    selectSet.forEach((select) => {
      if (!select || select.tagName !== 'SELECT' || select.dataset.vfEnhanced === '1') return;
      if (select.multiple || select.size > 1) return;
      if (select.closest('.vf-filter-dd') || select.closest('.select-input-wrapper')) return;
      if (select.disabled && select.closest('.printable-offscreen-wrapper, #printable-report-content, #printable-compare-content')) return;

      select.dataset.vfEnhanced = '1';

      const wrap = document.createElement('div');
      wrap.className = 'vf-filter-dd';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vf-filter-dd-btn';
      btn.setAttribute('aria-haspopup', 'listbox');

      const list = document.createElement('div');
      list.className = 'dropdown-list vf-filter-dd-list';
      list.style.display = 'none';
      list.setAttribute('role', 'listbox');

      const syncLabel = () => {
        const opt = select.options[select.selectedIndex];
        const text = opt ? opt.textContent : (select.getAttribute('placeholder') || 'Select');
        let label = btn.querySelector('.vf-filter-dd-label');
        if (!label) {
          label = document.createElement('span');
          label.className = 'vf-filter-dd-label';
          btn.textContent = '';
          btn.appendChild(label);
        }
        label.textContent = text;
        btn.disabled = !!select.disabled;
      };

      const rebuildList = () => {
        list.innerHTML = '';
        Array.from(select.options).forEach((opt) => {
          if (opt.hidden || (opt.style && opt.style.display === 'none')) return;
          const item = document.createElement('div');
          item.className = 'dropdown-item' + (opt.selected ? ' selected' : '');
          item.setAttribute('role', 'option');
          item.textContent = opt.textContent;
          if (opt.disabled) {
            item.classList.add('is-disabled');
            item.setAttribute('aria-disabled', 'true');
          } else {
            item.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              syncLabel();
              list.style.display = 'none';
              btn.setAttribute('aria-expanded', 'false');
            });
          }
          list.appendChild(item);
        });
      };

      select.classList.add('vf-filter-dd-native');
      select.style.cssText += ';position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;';

      const parent = select.parentNode;
      parent.insertBefore(wrap, select);
      wrap.appendChild(btn);
      wrap.appendChild(list);
      wrap.appendChild(select);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (select.disabled) return;
        const willOpen = list.style.display === 'none';
        document.querySelectorAll('.vf-filter-dd-list').forEach((el) => {
          el.style.display = 'none';
        });
        document.querySelectorAll('.vf-filter-dd-btn').forEach((el) => {
          el.setAttribute('aria-expanded', 'false');
        });
        if (willOpen) {
          rebuildList();
          list.style.display = 'block';
          placeListInView(btn, list);
          btn.setAttribute('aria-expanded', 'true');
        }
      });

      const mo = new MutationObserver(() => syncLabel());
      mo.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
      select.addEventListener('change', syncLabel);

      syncLabel();
    });
  }

  function enhanceNativeMonthInputs() {
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    document.querySelectorAll('input[type="month"]').forEach((input) => {
      if (input.dataset.vfMonthReady === '1' || input.closest('.vf-month-picker')) return;
      input.dataset.vfMonthReady = '1';

      const wrap = document.createElement('div');
      wrap.className = 'vf-month-picker';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vf-month-btn';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      const label = document.createElement('span');
      label.className = 'vf-month-btn-label';
      btn.appendChild(label);

      const panel = document.createElement('div');
      panel.className = 'vf-month-panel';
      panel.innerHTML = `
          <div class="vf-month-year-row">
            <button type="button" data-vf-year="-1" aria-label="Previous year">‹</button>
            <div class="vf-month-year-label"></div>
            <button type="button" data-vf-year="1" aria-label="Next year">›</button>
          </div>
          <div class="vf-month-grid"></div>
          <div class="vf-month-actions">
            <button type="button" data-vf-clear>Clear</button>
            <button type="button" data-vf-today>This month</button>
          </div>
        `;

      const parent = input.parentNode;
      parent.insertBefore(wrap, input);
      wrap.appendChild(btn);
      wrap.appendChild(panel);
      wrap.appendChild(input);

      let viewYear = new Date().getFullYear();

      const parseValue = () => {
        const v = input.value || '';
        const m = /^(\d{4})-(\d{2})$/.exec(v);
        if (!m) return null;
        return { year: Number(m[1]), month: Number(m[2]) };
      };

      const formatLabel = () => {
        const parsed = parseValue();
        if (!parsed) {
          label.textContent = input.placeholder || 'Select month';
          label.style.opacity = '0.55';
          return;
        }
        label.style.opacity = '1';
        label.textContent = `${MONTH_FULL[parsed.month - 1]} ${parsed.year}`;
      };

      const setValue = (yyyyMm) => {
        const prev = input.value;
        input.value = yyyyMm || '';
        formatLabel();
        if (prev !== input.value) {
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      const renderPanel = () => {
        const yearLabel = panel.querySelector('.vf-month-year-label');
        const grid = panel.querySelector('.vf-month-grid');
        const selected = parseValue();
        yearLabel.textContent = String(viewYear);
        grid.innerHTML = '';
        MONTH_NAMES.forEach((name, idx) => {
          const m = idx + 1;
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.textContent = name;
          if (selected && selected.year === viewYear && selected.month === m) {
            cell.classList.add('is-selected');
          }
          cell.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mm = String(m).padStart(2, '0');
            setValue(`${viewYear}-${mm}`);
            wrap.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
          });
          grid.appendChild(cell);
        });
      };

      const openPanel = () => {
        document.querySelectorAll('.vf-month-picker.open').forEach((el) => {
          if (el !== wrap) {
            el.classList.remove('open');
            const b = el.querySelector('.vf-month-btn');
            if (b) b.setAttribute('aria-expanded', 'false');
          }
        });
        document.querySelectorAll('.vf-date-picker.open').forEach((el) => {
          el.classList.remove('open');
          const b = el.querySelector('.vf-date-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.vf-filter-dd-list').forEach((el) => {
          el.style.display = 'none';
        });
        const selected = parseValue();
        viewYear = selected ? selected.year : new Date().getFullYear();
        renderPanel();
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      };

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (input.disabled) return;
        if (wrap.classList.contains('open')) {
          wrap.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        } else {
          openPanel();
        }
      });

      panel.querySelector('[data-vf-year="-1"]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewYear -= 1;
        renderPanel();
      });
      panel.querySelector('[data-vf-year="1"]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewYear += 1;
        renderPanel();
      });
      panel.querySelector('[data-vf-clear]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setValue('');
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
      panel.querySelector('[data-vf-today]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = new Date();
        viewYear = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        setValue(`${viewYear}-${mm}`);
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });

      // Keep label in sync when other code sets input.value
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (desc && desc.set) {
        Object.defineProperty(input, 'value', {
          configurable: true,
          enumerable: true,
          get() { return desc.get.call(this); },
          set(v) {
            desc.set.call(this, v);
            formatLabel();
          }
        });
      }
      input.addEventListener('change', formatLabel);

      formatLabel();
    });
  }

  function enhanceNativeDateInputs() {
    const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const pad = (n) => String(n).padStart(2, '0');
    const toKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
    const parseKey = (v) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
      if (!m) return null;
      return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    };
    const formatDisplay = (v) => {
      const p = parseKey(v);
      if (!p) return null;
      return `${MONTH_FULL[p.month - 1].slice(0, 3)} ${p.day}, ${p.year}`;
    };

    document.querySelectorAll('input[type="date"]').forEach((input) => {
      if (input.dataset.vfDateReady === '1' || input.closest('.vf-date-picker')) return;
      input.dataset.vfDateReady = '1';

      const wrap = document.createElement('div');
      wrap.className = 'vf-date-picker';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vf-date-btn';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      const label = document.createElement('span');
      label.className = 'vf-date-btn-label';
      btn.appendChild(label);

      const panel = document.createElement('div');
      panel.className = 'vf-date-panel';
      panel.innerHTML = `
          <div class="vf-date-nav">
            <button type="button" data-vf-nav="-1" aria-label="Previous month">‹</button>
            <div class="vf-date-nav-label"></div>
            <button type="button" data-vf-nav="1" aria-label="Next month">›</button>
          </div>
          <div class="vf-date-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}</div>
          <div class="vf-date-grid"></div>
          <div class="vf-date-actions">
            <button type="button" data-vf-clear>Clear</button>
            <button type="button" data-vf-today>Today</button>
          </div>
        `;

      const parent = input.parentNode;
      parent.insertBefore(wrap, input);
      wrap.appendChild(btn);
      wrap.appendChild(panel);
      wrap.appendChild(input);

      let viewYear = new Date().getFullYear();
      let viewMonth = new Date().getMonth() + 1; // 1-12

      const formatLabel = () => {
        const text = formatDisplay(input.value);
        if (!text) {
          label.textContent = input.getAttribute('placeholder') || 'mm/dd/yyyy';
          label.style.opacity = '0.55';
          return;
        }
        label.style.opacity = '1';
        label.textContent = text;
      };

      const setValue = (yyyyMmDd) => {
        const prev = input.value;
        input.value = yyyyMmDd || '';
        formatLabel();
        if (prev !== input.value) {
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };

      const renderPanel = () => {
        const navLabel = panel.querySelector('.vf-date-nav-label');
        const grid = panel.querySelector('.vf-date-grid');
        const selected = parseKey(input.value);
        const today = new Date();
        const todayKey = toKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

        navLabel.textContent = `${MONTH_FULL[viewMonth - 1]} ${viewYear}`;
        grid.innerHTML = '';

        const first = new Date(viewYear, viewMonth - 1, 1);
        const startPad = first.getDay(); // 0=Sun
        const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
        const prevDays = new Date(viewYear, viewMonth - 1, 0).getDate();

        const cells = [];
        for (let i = 0; i < startPad; i++) {
          const day = prevDays - startPad + i + 1;
          const y = viewMonth === 1 ? viewYear - 1 : viewYear;
          const m = viewMonth === 1 ? 12 : viewMonth - 1;
          cells.push({ y, m, d: day, other: true });
        }
        for (let d = 1; d <= daysInMonth; d++) {
          cells.push({ y: viewYear, m: viewMonth, d, other: false });
        }
        while (cells.length % 7 !== 0 || cells.length < 42) {
          const idx = cells.length - (startPad + daysInMonth);
          const d = idx + 1;
          const y = viewMonth === 12 ? viewYear + 1 : viewYear;
          const m = viewMonth === 12 ? 1 : viewMonth + 1;
          cells.push({ y, m, d, other: true });
          if (cells.length >= 42) break;
        }

        cells.forEach((cell) => {
          const key = toKey(cell.y, cell.m, cell.d);
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = String(cell.d);
          if (cell.other) b.classList.add('is-other');
          if (key === todayKey) b.classList.add('is-today');
          if (selected && key === toKey(selected.year, selected.month, selected.day)) {
            b.classList.add('is-selected');
          }
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Respect min/max if present
            if (input.min && key < input.min) return;
            if (input.max && key > input.max) return;
            setValue(key);
            wrap.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
          });
          grid.appendChild(b);
        });
      };

      const closeOthers = () => {
        document.querySelectorAll('.vf-date-picker.open').forEach((el) => {
          if (el !== wrap) {
            el.classList.remove('open');
            const b = el.querySelector('.vf-date-btn');
            if (b) b.setAttribute('aria-expanded', 'false');
          }
        });
        document.querySelectorAll('.vf-month-picker.open').forEach((el) => {
          el.classList.remove('open');
          const b = el.querySelector('.vf-month-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.vf-filter-dd-list').forEach((el) => {
          el.style.display = 'none';
        });
      };

      const openPanel = () => {
        closeOthers();
        const selected = parseKey(input.value);
        if (selected) {
          viewYear = selected.year;
          viewMonth = selected.month;
        } else {
          const now = new Date();
          viewYear = now.getFullYear();
          viewMonth = now.getMonth() + 1;
        }
        renderPanel();
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      };

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (input.disabled || input.readOnly) return;
        if (wrap.classList.contains('open')) {
          wrap.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
        } else {
          openPanel();
        }
      });

      panel.querySelector('[data-vf-nav="-1"]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewMonth -= 1;
        if (viewMonth < 1) {
          viewMonth = 12;
          viewYear -= 1;
        }
        renderPanel();
      });
      panel.querySelector('[data-vf-nav="1"]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewMonth += 1;
        if (viewMonth > 12) {
          viewMonth = 1;
          viewYear += 1;
        }
        renderPanel();
      });
      panel.querySelector('[data-vf-clear]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setValue('');
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
      panel.querySelector('[data-vf-today]').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = new Date();
        viewYear = now.getFullYear();
        viewMonth = now.getMonth() + 1;
        const key = toKey(viewYear, viewMonth, now.getDate());
        if (input.min && key < input.min) return;
        if (input.max && key > input.max) return;
        setValue(key);
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });

      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (desc && desc.set) {
        Object.defineProperty(input, 'value', {
          configurable: true,
          enumerable: true,
          get() { return desc.get.call(this); },
          set(v) {
            desc.set.call(this, v);
            formatLabel();
          }
        });
      }
      input.addEventListener('change', formatLabel);

      formatLabel();
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.vf-filter-dd')) return;
    document.querySelectorAll('.vf-filter-dd-list').forEach((el) => {
      el.style.display = 'none';
    });
    document.querySelectorAll('.vf-filter-dd-btn').forEach((el) => {
      el.setAttribute('aria-expanded', 'false');
    });
    if (!e.target.closest('.vf-month-picker')) {
      document.querySelectorAll('.vf-month-picker.open').forEach((el) => {
        el.classList.remove('open');
        const b = el.querySelector('.vf-month-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    }
    if (!e.target.closest('.vf-date-picker')) {
      document.querySelectorAll('.vf-date-picker.open').forEach((el) => {
        el.classList.remove('open');
        const b = el.querySelector('.vf-date-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    }
  });

  function startPickerEnhancers() {
    if (document.documentElement.dataset.vfNoEnhance === 'true' ||
      (document.body && document.body.dataset.vfNoEnhance === 'true')) {
      return;
    }
    enhanceClickables();
    enhanceNativeFilterSelects();
    enhanceNativeMonthInputs();
    enhanceNativeDateInputs();

    // Catch dynamically injected elements / modals via debounced MutationObserver
    try {
      let moTimer = null;
      const mo = new MutationObserver(() => {
        if (document.documentElement.dataset.vfNoEnhance === 'true' ||
          (document.body && document.body.dataset.vfNoEnhance === 'true')) {
          return;
        }
        if (moTimer) return;
        moTimer = requestAnimationFrame(() => {
          moTimer = null;
          enhanceClickables();
          enhanceNativeMonthInputs();
          enhanceNativeDateInputs();
          enhanceNativeFilterSelects();
        });
      });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (_) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPickerEnhancers);
  } else {
    startPickerEnhancers();
  }
})();






