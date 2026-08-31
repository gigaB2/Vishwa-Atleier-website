(function() {
  // Native browser localStorage reference before overriding
  const nativeLocalStorage = window.localStorage;

  // Resolve Supabase configuration dynamically:
  // 1. LocalStorage overrides (configured via Admin Settings in UI)
  // 2. Global window.APP_CONFIG (from assets/config.js)
  // 3. Fallback to unconfigured state
  function resolveConfig() {
    let url = '';
    let key = '';
    let source = 'none';

    try {
      const customUrl = nativeLocalStorage.getItem('vf_supabase_url');
      const customKey = nativeLocalStorage.getItem('vf_supabase_anon_key');
      if (customUrl && customKey && customUrl.trim() && customKey.trim()) {
        url = customUrl.trim();
        key = customKey.trim();
        source = 'localStorage';
      }
    } catch(e) {}

    if (!url && typeof window !== 'undefined' && window.APP_CONFIG) {
      if (window.APP_CONFIG.SUPABASE_URL && window.APP_CONFIG.SUPABASE_ANON_KEY) {
        url = (window.APP_CONFIG.SUPABASE_URL || '').trim();
        key = (window.APP_CONFIG.SUPABASE_ANON_KEY || '').trim();
        source = 'config.js';
      }
    }

    if (url && url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }

    const isPlaceholder = !url || !key || url.includes('your-project') || key.includes('your-anon');

    return {
      url: isPlaceholder ? '' : url,
      anonKey: isPlaceholder ? '' : key,
      isConfigured: !isPlaceholder && Boolean(url && key),
      source: source
    };
  }

  let activeConfig = resolveConfig();
  let SUPABASE_URL = activeConfig.url;
  let SUPABASE_ANON_KEY = activeConfig.anonKey;

  // Local-only keys that must NEVER sync across different computers/users in the cloud database
  const LOCAL_ONLY_KEYS = new Set([
    'vf_session',
    'vf_user_name',
    'vf_supabase_token',
    'vf_supabase_session',
    'vf_supabase_url',
    'vf_supabase_anon_key',
    'vf_sidebar_open_folders',
    'vf_sidebar_collapsed',
    'vishwa_fashions_sidebar_mode',
    'vishwa_fashions_theme'
  ]);

  function isLocalOnlyKey(key) {
    if (!key || typeof key !== 'string') return true;
    if (LOCAL_ONLY_KEYS.has(key)) return true;
    if (key.startsWith('user_theme_') || key.startsWith('vf_device_') || key.startsWith('vf_local_')) {
      return true;
    }
    return false;
  }

  // --- IndexedDB Safe Storage Fallback (Protects against 5MB QuotaExceededError crashes) ---
  const IDB_NAME = 'vf_management_suite_db';
  const IDB_STORE = 'vf_keyval';
  let idbInstance = null;

  function getIDB() {
    if (idbInstance) return Promise.resolve(idbInstance);
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = (e) => {
          idbInstance = e.target.result;
          resolve(idbInstance);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  function idbSet(key, val) {
    getIDB().then(db => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
      } catch (e) {}
    });
  }

  function idbDelete(key) {
    getIDB().then(db => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
      } catch (e) {}
    });
  }

  function safeLocalStorageSet(key, valStr) {
    try {
      nativeLocalStorage.setItem(key, valStr);
    } catch (err) {
      // If QuotaExceededError or security storage limit hit, fall back safely to IndexedDB
      idbSet(key, valStr);
    }
  }

  // Unique client session instance ID (Unique per window/tab lifecycle to prevent multi-tab collision)
  const CLIENT_ID = 'vf_client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000);

  // In-memory cache for instant synchronous reading across device sessions
  const cache = {};
  window.__vf_supabase_cache = cache;

  // Seed cache synchronously from native localStorage so page scripts have data instantly on page load (excluding local session keys)
  try {
    for (let i = 0; i < nativeLocalStorage.length; i++) {
      const k = nativeLocalStorage.key(i);
      if (k && !isLocalOnlyKey(k)) {
        cache[k] = nativeLocalStorage.getItem(k);
      }
    }
  } catch (e) {}

  // Hydrate additional large keys from IndexedDB asynchronously into in-memory cache
  getIDB().then(db => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (!cache[cursor.key] && !isLocalOnlyKey(cursor.key)) {
            cache[cursor.key] = cursor.value;
          }
          cursor.continue();
        }
      };
    } catch(e) {}
  });

  // Track last local writes to prevent race conditions from overwriting active user edits
  const lastLocalWrites = {};
  const lastSavedHashes = {};
  const debouncedWriteTimers = {};
  const pendingRemoteUpdates = {};
  const deferredApplyTimers = {};

  const COSTING_KEYS = [
    'costing-products-v4',
    'costing-tfo-products-v1',
    'costing-doubler-products-v1',
    'costing-covering-products-v1'
  ];

  let isHydrated = false;

  // Track connection status
  let currentStatus = activeConfig.isConfigured ? 'connecting' : 'unconfigured'; // 'connecting' | 'connected' | 'syncing' | 'offline' | 'unconfigured'

  function setSyncStatus(status) {
    if (currentStatus !== status) {
      currentStatus = status;
      try {
        window.dispatchEvent(new CustomEvent('supabase-status', { detail: { status: status, config: activeConfig } }));
      } catch (e) {}
    }
  }

  // BroadcastChannel for instant real-time sync across open windows in the SAME browser
  const syncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('vf_supabase_sync') : null;

  // --- Universal Intelligent Merge Engine (Eliminates Concurrent Multi-User Overwrites) ---
  function getItemIdentifier(item) {
    if (!item) return null;
    if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
    if (typeof item !== 'object') return null;
    if (item.id !== undefined && item.id !== null && String(item.id).trim() !== '') {
      return String(item.id).trim();
    }
    if (item._id !== undefined && item._id !== null && String(item._id).trim() !== '') {
      return String(item._id).trim();
    }
    if (item.uuid !== undefined && item.uuid !== null && String(item.uuid).trim() !== '') {
      return String(item.uuid).trim();
    }
    if (item.loanId !== undefined && item.loanId !== null && String(item.loanId).trim() !== '') {
      return String(item.loanId).trim();
    }
    if (item.empId !== undefined && item.empId !== null && String(item.empId).trim() !== '') {
      return String(item.empId).trim();
    }
    if (item.orderId || item.orderNo) {
      return 'ord_' + String(item.orderId || item.orderNo).trim();
    }
    if (item.billNo || item.invoiceNo) {
      return 'inv_' + String(item.billNo || item.invoiceNo).trim();
    }
    if (item.lotNo || item.lot) {
      return 'lot_' + String(item.lotNo || item.lot).trim() + '_' + (item.date || '');
    }
    // Composite log key for shift entries without explicit ID
    if (item.date && (item.shift || item.machine || item.machineNo || item.loom || item.loomNo || item.worker)) {
      return `log_${item.date}_${item.shift || ''}_${item.machine || item.machineNo || item.loom || item.loomNo || ''}_${item.productName || item.worker || ''}`;
    }
    if (item.name !== undefined && item.name !== null && String(item.name).trim() !== '') {
      return String(item.name).trim();
    }
    if (item.code !== undefined && item.code !== null && String(item.code).trim() !== '') {
      return String(item.code).trim();
    }
    return null;
  }

  function getDeletedTombstones() {
    let deleted = [];
    try {
      const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
      if (raw) deleted = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch(e) {}
    return Array.isArray(deleted) ? deleted.map(String) : [];
  }

  function filterDeletedEntities(arr) {
    if (!Array.isArray(arr)) return arr;
    const tombstones = getDeletedTombstones();
    if (tombstones.length === 0) return arr;
    const tombstoneSet = new Set(tombstones);
    return arr.filter(item => {
      if (!item) return false;
      try {
        const id = getItemIdentifier(item);
        if (id && tombstoneSet.has(String(id))) return false;
        if (item.id && tombstoneSet.has(String(item.id))) return false;
        if (item._id && tombstoneSet.has(String(item._id))) return false;
        if (item.name && tombstoneSet.has(String(item.name))) return false;
        if (item.loanId && tombstoneSet.has(String(item.loanId))) return false;
        if (item.empId && tombstoneSet.has(String(item.empId))) return false;
      } catch(e) {}
      return true;
    });
  }

  function mergeDatasets(key, localVal, remoteVal) {
    if (localVal === undefined || localVal === null) {
      if (typeof remoteVal === 'string' && (remoteVal.startsWith('[') || remoteVal.startsWith('{'))) {
        try {
          const parsed = JSON.parse(remoteVal);
          if (Array.isArray(parsed)) return filterDeletedEntities(parsed);
          if (parsed && typeof parsed === 'object') {
            const cloned = { ...parsed };
            if (Array.isArray(cloned.employees)) cloned.employees = filterDeletedEntities(cloned.employees);
            if (Array.isArray(cloned.machines)) cloned.machines = filterDeletedEntities(cloned.machines);
            if (Array.isArray(cloned.loans)) cloned.loans = filterDeletedEntities(cloned.loans);
            return cloned;
          }
        } catch(e) {}
      }
      return remoteVal;
    }
    if (remoteVal === undefined || remoteVal === null) return localVal;

    let parsedLocal = localVal;
    let parsedRemote = remoteVal;

    try {
      if (typeof localVal === 'string' && (localVal.startsWith('[') || localVal.startsWith('{'))) {
        parsedLocal = JSON.parse(localVal);
      }
    } catch(e) {}

    try {
      if (typeof remoteVal === 'string' && (remoteVal.startsWith('[') || remoteVal.startsWith('{'))) {
        parsedRemote = JSON.parse(remoteVal);
      }
    } catch(e) {}

    // Case 1: Both are Arrays -> Strictly filter deletions on both and prioritize latest authority
    if (Array.isArray(parsedLocal) && Array.isArray(parsedRemote)) {
      const cleanLocal = filterDeletedEntities(parsedLocal);
      const cleanRemote = filterDeletedEntities(parsedRemote);
      const lastWrite = lastLocalWrites[key] || 0;
      return (Date.now() - lastWrite < 3000) ? cleanLocal : cleanRemote;
    }

    if (Array.isArray(parsedRemote)) {
      return filterDeletedEntities(parsedRemote);
    }
    if (Array.isArray(parsedLocal)) {
      return filterDeletedEntities(parsedLocal);
    }

    // Case 2: Both are Plain Objects (Dictionaries / Settings / State Objects)
    if (parsedLocal && typeof parsedLocal === 'object' && !Array.isArray(parsedLocal) &&
        parsedRemote && typeof parsedRemote === 'object' && !Array.isArray(parsedRemote)) {
      const lastWrite = lastLocalWrites[key] || 0;
      const targetObj = (Date.now() - lastWrite < 3000) ? parsedLocal : parsedRemote;
      // If object has employees/machines/loans arrays (like STATE_KEY aethertasks_db_state_v7)
      if (targetObj && (Array.isArray(targetObj.employees) || Array.isArray(targetObj.machines) || Array.isArray(targetObj.loans))) {
        const cloned = { ...targetObj };
        if (Array.isArray(cloned.employees)) cloned.employees = filterDeletedEntities(cloned.employees);
        if (Array.isArray(cloned.machines)) cloned.machines = filterDeletedEntities(cloned.machines);
        if (Array.isArray(cloned.loans)) cloned.loans = filterDeletedEntities(cloned.loans);
        return cloned;
      }
      return targetObj;
    }

    // Case 3: Primitive values -> Prefer remote server value unless locally edited within 3s
    const lastWrite = lastLocalWrites[key] || 0;
    if (Date.now() - lastWrite < 3000) {
      return localVal;
    }
    return remoteVal;
  }

  function applyRemoteKeyUpdate(key, valStr) {
    if (isLocalOnlyKey(key)) return;
    const currentVal = cache[key] || nativeLocalStorage.getItem(key);
    const finalVal = mergeDatasets(key, currentVal, valStr);
    const finalValSerialized = typeof finalVal === 'string' ? finalVal : JSON.stringify(finalVal);

    if (cache[key] !== finalValSerialized) {
      cache[key] = finalValSerialized;
      safeLocalStorageSet(key, finalValSerialized);
      lastSavedHashes[key] = computeHash(finalValSerialized);
      lastKnownTimestamps[key] = new Date().toISOString();

      window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value: finalValSerialized, isRemote: true } }));
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: finalValSerialized }));
      } catch(e) {
        window.dispatchEvent(new Event('storage'));
      }
    }
  }

  function handleIncomingRemoteUpdate(key, valStr, isDelete = false) {
    if (isLocalOnlyKey(key)) return;
    if (isDelete) {
      delete cache[key];
      delete lastKnownTimestamps[key];
      delete lastSavedHashes[key];
      delete pendingRemoteUpdates[key];
      try { nativeLocalStorage.removeItem(key); } catch(e) {}
      window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key, value: null, isRemote: true } }));
      try {
        window.dispatchEvent(new StorageEvent('storage', { key: key, newValue: null }));
      } catch(e) {
        window.dispatchEvent(new Event('storage'));
      }
      return;
    }

    const lastWrite = lastLocalWrites[key] || 0;
    const timeSinceLastWrite = Date.now() - lastWrite;

    if (timeSinceLastWrite < 3000) {
      // User is actively editing this key locally. Defer application instead of dropping!
      pendingRemoteUpdates[key] = valStr;
      clearTimeout(deferredApplyTimers[key]);
      deferredApplyTimers[key] = setTimeout(() => {
        const currentElapsed = Date.now() - (lastLocalWrites[key] || 0);
        if (currentElapsed >= 3000 && pendingRemoteUpdates[key]) {
          const deferredVal = pendingRemoteUpdates[key];
          delete pendingRemoteUpdates[key];
          applyRemoteKeyUpdate(key, deferredVal);
        }
      }, (3000 - timeSinceLastWrite) + 150);
      return;
    }

    applyRemoteKeyUpdate(key, valStr);
  }

  // --- Realtime WebSocket & Presence Synchronization Engine (Google Sheets Style) ---
  // Zero Database Egress: Uses Phoenix Broadcast channel in Supabase server RAM
  let ws = null;
  let wsHeartbeatTimer = null;
  let wsReconnectTimer = null;
  let wsReconnectAttempts = 0;
  const WS_CHANNEL_TOPIC = 'realtime:vf_costing_sync';

  // --- Realtime Presence & Avatar Palette Engine ---
  const AVATAR_COLORS = [
    { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139, 92, 246, 0.45)', border: '#7c3aed', name: 'Purple' },
    { bg: '#3b82f6', fg: '#ffffff', glow: 'rgba(59, 130, 246, 0.45)', border: '#2563eb', name: 'Blue' },
    { bg: '#10b981', fg: '#ffffff', glow: 'rgba(16, 185, 129, 0.45)', border: '#059669', name: 'Emerald' },
    { bg: '#f59e0b', fg: '#ffffff', glow: 'rgba(245, 158, 11, 0.45)', border: '#d97706', name: 'Amber' },
    { bg: '#ec4899', fg: '#ffffff', glow: 'rgba(236, 72, 153, 0.45)', border: '#db2777', name: 'Pink' },
    { bg: '#06b6d4', fg: '#ffffff', glow: 'rgba(6, 182, 212, 0.45)', border: '#0891b2', name: 'Cyan' },
    { bg: '#f43f5e', fg: '#ffffff', glow: 'rgba(244, 63, 94, 0.45)', border: '#e11d48', name: 'Rose' },
    { bg: '#14b8a6', fg: '#ffffff', glow: 'rgba(20, 184, 166, 0.45)', border: '#0d9488', name: 'Teal' },
    { bg: '#84cc16', fg: '#ffffff', glow: 'rgba(132, 204, 22, 0.45)', border: '#65a30d', name: 'Lime' },
    { bg: '#6366f1', fg: '#ffffff', glow: 'rgba(99, 102, 241, 0.45)', border: '#4f46e5', name: 'Indigo' }
  ];

  function getLocalUserInfo() {
    let name = 'Operator';
    let role = 'Operator';
    let userId = CLIENT_ID;
    let email = '';
    
    try {
      const sessRaw = nativeLocalStorage.getItem('vf_session');
      if (sessRaw) {
        const sess = JSON.parse(sessRaw);
        if (sess.name) name = sess.name;
        else if (sess.username) name = sess.username;
        else if (sess.email) name = sess.email.split('@')[0];
        if (sess.role) role = sess.role.charAt(0).toUpperCase() + sess.role.slice(1);
        if (sess.id) userId = sess.id;
        if (sess.email) email = sess.email;
      } else {
        const savedUser = nativeLocalStorage.getItem('vf_user_name');
        if (savedUser) {
          name = savedUser;
          role = 'Operator';
        }
      }
    } catch(e) {}
    
    // Deterministic color assignment based on userId or email or name
    let hash = 0;
    const strForHash = (email || userId || name || CLIENT_ID).toLowerCase();
    for (let i = 0; i < strForHash.length; i++) {
      hash = (hash << 5) - hash + strForHash.charCodeAt(i);
      hash |= 0;
    }
    const colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
    const userColor = AVATAR_COLORS[colorIndex];
    
    // Compute user initials cleanly (e.g., vishwa@vishwafashions -> VI, rajiv@vishwafashions.com -> RA)
    let cleanName = name;
    if (cleanName.includes('@')) {
      cleanName = cleanName.split('@')[0];
    }
    cleanName = cleanName.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    const parts = cleanName ? cleanName.split(/\s+/).filter(Boolean) : ['U'];
    let initials = 'U';
    if (parts.length >= 2 && parts[0] && parts[1]) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (parts[0] && parts[0].length >= 2) {
      initials = parts[0].slice(0, 2).toUpperCase();
    } else if (parts[0]) {
      initials = parts[0][0].toUpperCase();
    }

    return {
      id: userId,
      clientId: CLIENT_ID,
      name: name,
      email: email,
      initials: initials,
      role: role,
      color: userColor
    };
  }

  function getCurrentPageKey() {
    try {
      const path = window.location.pathname.toLowerCase();
      const page = path.split('/').pop() || 'index.html';
      return page.split('?')[0].split('#')[0];
    } catch(e) {
      return 'index.html';
    }
  }

  // Active in-memory presence store: clientId -> { user, page, tab, field, isTyping, lastPing, isSelf }
  const presenceStore = {};
  window.__vf_presence_store = presenceStore;

  function deduplicateUsers(users) {
    if (!Array.isArray(users)) return [];
    const userMap = new Map();
    users.forEach(u => {
      if (!u) return;
      // Key by user id or email or name (or fallback to clientId)
      const userKey = (u.user && (u.user.id || u.user.email || u.user.name)) || u.clientId;
      if (!userKey) return;
      const existing = userMap.get(userKey);
      if (!existing) {
        userMap.set(userKey, u);
      } else {
        // Prioritize active over away, typing over non-typing, and newer ping
        const preferCurrent = (!u.isAway && existing.isAway) ||
                              (u.isTyping && !existing.isTyping) ||
                              ((u.lastPing || 0) > (existing.lastPing || 0));
        if (preferCurrent) {
          userMap.set(userKey, {
            ...existing,
            ...u,
            isSelf: Boolean(existing.isSelf || u.isSelf)
          });
        }
      }
    });
    return Array.from(userMap.values());
  }

  function purgeStaleClientsForUser(userKey, currentClientId) {
    if (!userKey) return;
    Object.keys(presenceStore).forEach(cid => {
      if (cid !== currentClientId && cid !== CLIENT_ID) {
        const u = presenceStore[cid];
        const existingKey = (u.user && (u.user.id || u.user.email || u.user.name));
        if (existingKey === userKey) {
          delete presenceStore[cid];
        }
      }
    });
  }

  let presenceNotifyRaf = null;
  function notifyPresenceListeners() {
    if (presenceNotifyRaf) return;
    const schedule = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn => setTimeout(fn, 16));
    presenceNotifyRaf = schedule(() => {
      presenceNotifyRaf = null;
      const currentPage = getCurrentPageKey();
      const rawUsers = Object.values(presenceStore);
      const allUsers = deduplicateUsers(rawUsers);
      const pageUsers = deduplicateUsers(rawUsers.filter(u => !u.page || u.page === currentPage));
      try {
        window.dispatchEvent(new CustomEvent('supabase-presence', {
          detail: {
            users: allUsers,
            pageUsers: pageUsers,
            currentPage: currentPage,
            selfId: CLIENT_ID
          }
        }));
      } catch (e) {}
    });
  }

  function broadcastPresenceEvent(eventType, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: eventType,
            payload: payload
          },
          ref: 'pres_' + Date.now()
        }));
      } catch(e) {}
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: eventType,
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }
  }

  function sendPresenceHello() {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const isAway = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

    presenceStore[CLIENT_ID] = {
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: window.__vf_active_tab || '',
      field: window.__vf_active_field || '',
      qualityIndex: window.__vf_active_quality_index !== undefined ? window.__vf_active_quality_index : null,
      qualityName: window.__vf_active_quality_name || '',
      qualityId: window.__vf_active_quality_id || null,
      isTyping: false,
      isAway: isAway,
      lastPing: Date.now(),
      isSelf: true
    };

    const payload = {
      type: 'presence_hello',
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: window.__vf_active_tab || '',
      field: window.__vf_active_field || '',
      qualityIndex: window.__vf_active_quality_index !== undefined ? window.__vf_active_quality_index : null,
      qualityName: window.__vf_active_quality_name || '',
      qualityId: window.__vf_active_quality_id || null,
      isTyping: false,
      isAway: isAway,
      timestamp: Date.now()
    };

    broadcastPresenceEvent('presence_hello', payload);
    notifyPresenceListeners();
  }

  let announceJitterTimer = null;
  function sendPresenceAnnounce(immediate = false) {
    if (announceJitterTimer) return;
    const delay = immediate ? 0 : Math.floor(Math.random() * 35) + 10;
    announceJitterTimer = setTimeout(() => {
      announceJitterTimer = null;
      const self = presenceStore[CLIENT_ID];
      if (!self) return;
      self.lastPing = Date.now();
      const payload = {
        type: 'presence_announce',
        clientId: CLIENT_ID,
        user: self.user,
        page: self.page,
        fullPath: self.fullPath,
        href: self.href,
        tab: self.tab,
        field: self.field,
        qualityIndex: self.qualityIndex,
        qualityName: self.qualityName,
        qualityId: self.qualityId,
        isTyping: Boolean(self.isTyping),
        isAway: Boolean(self.isAway),
        timestamp: Date.now()
      };
      broadcastPresenceEvent('presence_announce', payload);
    }, delay);
  }

  function sendPresencePing(tab, field, isTyping = false, qualityIndex = undefined, qualityName = undefined, qualityId = undefined, isAway = undefined) {
    if (typeof qualityIndex === 'object' && qualityIndex !== null) {
      qualityName = qualityIndex.qualityName || qualityIndex.name;
      qualityId = qualityIndex.qualityId || qualityIndex.id;
      qualityIndex = qualityIndex.qualityIndex ?? qualityIndex.index;
    }

    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const currentTab = (tab !== undefined && tab !== null) ? tab : (window.__vf_active_tab || '');
    const currentField = (field !== undefined && field !== null) ? field : (window.__vf_active_field || '');
    const qIdx = qualityIndex !== undefined ? qualityIndex : (window.__vf_active_quality_index !== undefined ? window.__vf_active_quality_index : null);
    const qName = qualityName !== undefined ? qualityName : (window.__vf_active_quality_name || '');
    const qId = qualityId !== undefined ? qualityId : (window.__vf_active_quality_id || null);
    const awayStatus = isAway !== undefined ? Boolean(isAway) : (typeof document !== 'undefined' ? Boolean(document.hidden) : false);

    const payload = {
      type: 'presence_ping',
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: currentTab,
      field: currentField,
      qualityIndex: qIdx,
      qualityName: qName,
      qualityId: qId,
      isTyping: Boolean(isTyping),
      isAway: awayStatus,
      timestamp: Date.now()
    };

    presenceStore[CLIENT_ID] = {
      clientId: CLIENT_ID,
      user: user,
      page: page,
      fullPath: window.location.pathname,
      href: window.location.href,
      tab: currentTab,
      field: currentField,
      qualityIndex: qIdx,
      qualityName: qName,
      qualityId: qId,
      isTyping: Boolean(isTyping),
      isAway: awayStatus,
      lastPing: Date.now(),
      isSelf: true
    };

    broadcastPresenceEvent('presence_ping', payload);
    notifyPresenceListeners();
  }

  function sendPresenceLeave() {
    delete presenceStore[CLIENT_ID];
    const payload = {
      type: 'presence_leave',
      clientId: CLIENT_ID,
      page: getCurrentPageKey(),
      timestamp: Date.now()
    };

    broadcastPresenceEvent('presence_leave', payload);
    notifyPresenceListeners();
  }

  function handleIncomingPresenceHello(payload) {
    if (!payload || !payload.clientId || payload.clientId === CLIENT_ID) return;
    const userKey = (payload.user && (payload.user.id || payload.user.email || payload.user.name));
    purgeStaleClientsForUser(userKey, payload.clientId);
    presenceStore[payload.clientId] = {
      clientId: payload.clientId,
      user: payload.user || { name: 'User', role: 'Viewer', color: AVATAR_COLORS[0], initials: 'U' },
      page: payload.page || '',
      fullPath: payload.fullPath || '',
      href: payload.href || '',
      tab: payload.tab || '',
      field: payload.field || '',
      qualityIndex: payload.qualityIndex !== undefined ? payload.qualityIndex : null,
      qualityName: payload.qualityName || '',
      qualityId: payload.qualityId || null,
      isTyping: false,
      isAway: Boolean(payload.isAway),
      lastPing: Date.now(),
      isSelf: false
    };
    notifyPresenceListeners();
    // Mutual Discovery: Immediately announce self so the newcomer discovers us
    sendPresenceAnnounce();
    if (typeof window !== 'undefined' && typeof window.__vf_broadcastActiveFormSnapshot === 'function') {
      setTimeout(() => {
        try { window.__vf_broadcastActiveFormSnapshot(); } catch(e) {}
      }, 300);
    }
  }

  function handleIncomingPresenceAnnounce(payload) {
    if (!payload || !payload.clientId || payload.clientId === CLIENT_ID) return;
    const userKey = (payload.user && (payload.user.id || payload.user.email || payload.user.name));
    purgeStaleClientsForUser(userKey, payload.clientId);
    presenceStore[payload.clientId] = {
      clientId: payload.clientId,
      user: payload.user || { name: 'User', role: 'Viewer', color: AVATAR_COLORS[0], initials: 'U' },
      page: payload.page || '',
      fullPath: payload.fullPath || '',
      href: payload.href || '',
      tab: payload.tab || '',
      field: payload.field || '',
      qualityIndex: payload.qualityIndex !== undefined ? payload.qualityIndex : null,
      qualityName: payload.qualityName || '',
      qualityId: payload.qualityId || null,
      isTyping: Boolean(payload.isTyping),
      isAway: Boolean(payload.isAway),
      lastPing: Date.now(),
      isSelf: false
    };
    notifyPresenceListeners();
    if (typeof window !== 'undefined' && typeof window.__vf_broadcastActiveFormSnapshot === 'function') {
      setTimeout(() => {
        try { window.__vf_broadcastActiveFormSnapshot(); } catch(e) {}
      }, 400);
    }
  }

  function handleIncomingPresencePing(payload) {
    if (!payload || !payload.clientId || payload.clientId === CLIENT_ID) return;
    const userKey = (payload.user && (payload.user.id || payload.user.email || payload.user.name));
    purgeStaleClientsForUser(userKey, payload.clientId);
    const isNewPeer = !presenceStore[payload.clientId];
    presenceStore[payload.clientId] = {
      clientId: payload.clientId,
      user: payload.user || { name: 'User', role: 'Viewer', color: AVATAR_COLORS[0], initials: 'U' },
      page: payload.page || '',
      fullPath: payload.fullPath || '',
      href: payload.href || '',
      tab: payload.tab || '',
      field: payload.field || '',
      qualityIndex: payload.qualityIndex !== undefined ? payload.qualityIndex : null,
      qualityName: payload.qualityName || '',
      qualityId: payload.qualityId || null,
      isTyping: Boolean(payload.isTyping),
      isAway: Boolean(payload.isAway),
      lastPing: Date.now(),
      isSelf: false
    };
    notifyPresenceListeners();
    // If we receive a ping from someone not yet registered in our store, send back an announce
    if (isNewPeer) {
      sendPresenceAnnounce();
    }
  }

  function handleIncomingPresenceLeave(payload) {
    if (!payload || !payload.clientId) return;
    delete presenceStore[payload.clientId];
    notifyPresenceListeners();
  }

  function handleIncomingFieldFocus(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-field-focus', { detail: payload }));
    } catch(e) {}
  }

  function handleIncomingFieldChange(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-field-change', { detail: payload }));
    } catch(e) {}
  }

  // Purge disconnected users who haven't pinged in > 22 seconds (2 missed 10s heartbeats)
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    Object.keys(presenceStore).forEach(cid => {
      if (cid !== CLIENT_ID && now - (presenceStore[cid].lastPing || 0) > 22000) {
        delete presenceStore[cid];
        changed = true;
      }
    });
    if (changed) {
      notifyPresenceListeners();
    }
  }, 4000);

  // Send periodic presence ping every 10 seconds to keep presence fresh
  setInterval(() => {
    sendPresencePing();
  }, 10000);

  // Hook tab visibility & page unload
  // Note: Tab visibility change sets 'away' state instead of abruptly dropping user offline
  window.addEventListener('beforeunload', sendPresenceLeave);
  window.addEventListener('pagehide', sendPresenceLeave);
  document.addEventListener('visibilitychange', () => {
    const isAway = Boolean(document.hidden);
    if (presenceStore[CLIENT_ID]) {
      presenceStore[CLIENT_ID].isAway = isAway;
      presenceStore[CLIENT_ID].lastPing = Date.now();
    }
    sendPresencePing(null, null, false, undefined, undefined, undefined, isAway);
  });

  // Collaborative input & cell broadcasters with intelligent typing throttling
  let lastTypingBroadcastTime = 0;
  let typingResetTimer = null;
  let lastBroadcastFieldId = null;

  function handleLocalUserTyping(fieldId, tab) {
    if (presenceStore[CLIENT_ID]) {
      presenceStore[CLIENT_ID].isTyping = true;
      presenceStore[CLIENT_ID].lastPing = Date.now();
    }
    clearTimeout(typingResetTimer);
    typingResetTimer = setTimeout(() => {
      if (presenceStore[CLIENT_ID]) {
        presenceStore[CLIENT_ID].isTyping = false;
        presenceStore[CLIENT_ID].lastPing = Date.now();
      }
      sendPresencePing(tab, fieldId, false);
    }, 2500);

    const now = Date.now();
    if (now - lastTypingBroadcastTime > 1500) {
      lastTypingBroadcastTime = now;
      sendPresencePing(tab, fieldId, true);
    }
  }

  function broadcastFieldFocus(fieldId, isFocused, meta = {}) {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const payload = {
      type: 'field_focus',
      senderId: CLIENT_ID,
      user: user,
      page: page,
      tab: meta.tab || window.__vf_active_tab || '',
      fieldId: fieldId,
      isFocused: Boolean(isFocused),
      meta: meta,
      timestamp: Date.now()
    };

    if (isFocused) {
      window.__vf_active_field = fieldId;
    } else if (window.__vf_active_field === fieldId) {
      window.__vf_active_field = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'field_focus',
            payload: payload
          },
          ref: 'foc_' + Date.now()
        }));
      } catch(e) {}
    } else if (activeConfig.isConfigured && (!ws || ws.readyState === WebSocket.CLOSED)) {
      initRealtimeWebSocket();
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'field_focus',
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }

    if (fieldId !== lastBroadcastFieldId) {
      lastBroadcastFieldId = fieldId;
      sendPresencePing(payload.tab, window.__vf_active_field, false);
    }
  }

  function broadcastFieldChange(fieldId, value, meta = {}) {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const payload = {
      type: 'field_change',
      senderId: CLIENT_ID,
      user: user,
      page: page,
      tab: meta.tab || window.__vf_active_tab || '',
      fieldId: fieldId,
      value: value,
      meta: meta,
      timestamp: Date.now()
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'field_change',
            payload: payload
          },
          ref: 'fchg_' + Date.now()
        }));
      } catch(e) {}
    } else if (activeConfig.isConfigured && (!ws || ws.readyState === WebSocket.CLOSED)) {
      initRealtimeWebSocket();
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'field_change',
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }

    handleLocalUserTyping(fieldId, payload.tab);
  }

  function broadcastFormClear(fieldIds = []) {
    const user = getLocalUserInfo();
    const page = getCurrentPageKey();
    const payload = {
      type: 'form_clear',
      senderId: CLIENT_ID,
      user: user,
      page: page,
      tab: window.__vf_active_tab || '',
      fieldIds: Array.isArray(fieldIds) ? fieldIds : (fieldIds ? [fieldIds] : []),
      timestamp: Date.now()
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'form_clear',
            payload: payload
          },
          ref: 'fclr_' + Date.now()
        }));
      } catch(e) {}
    } else if (activeConfig.isConfigured && (!ws || ws.readyState === WebSocket.CLOSED)) {
      initRealtimeWebSocket();
    }

    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'form_clear',
          senderId: CLIENT_ID,
          payload: payload
        });
      } catch(e) {}
    }
  }

  // --- Realtime Collaborative Form & Input Field Synchronizer (Google Sheets Style with Live Field Locking) ---
  function initCollaborativeDOMSync() {
    const activeRemoteLocks = new Map(); // fieldId -> { tagEl, inputEl, user, timer, origReadOnly, origPointerEvents }
    const fieldDebounceTimers = new Map();
    const lastLocalFieldWrites = new Map();

    function getFieldIdentifier(el) {
      if (!el || !el.tagName) return null;
      const tag = el.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return null;
      if (el.type === 'password' || el.type === 'hidden' || el.type === 'file') return null;
      
      if (el.dataset && el.dataset.collabId) return el.dataset.collabId;
      if (el.id && !el.id.startsWith('__')) return el.id;
      if (el.name) return el.name;

      const rowEl = el.closest('[data-row-id], [data-item-id], [data-id], tr, li, .card, .product-card');
      const rowKey = rowEl ? (rowEl.dataset.rowId || rowEl.dataset.itemId || rowEl.dataset.id || rowEl.id || Array.from(rowEl.parentElement ? rowEl.parentElement.children : []).indexOf(rowEl)) : 'form';
      const fieldKey = el.getAttribute('aria-label') || el.placeholder || el.type || 'inp';
      return `${rowKey}__${fieldKey}`.replace(/\s+/g, '_');
    }

    function findElementByFieldId(fieldId) {
      if (!fieldId) return null;
      try {
        let el = document.getElementById(fieldId);
        if (el) return el;

        const safeEscape = (str) => {
          try {
            return (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(str) : String(str).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
          } catch(e) {
            return String(str);
          }
        };

        el = document.querySelector(`[data-collab-id="${safeEscape(fieldId)}"]`);
        if (el) return el;

        el = document.querySelector(`[name="${safeEscape(fieldId)}"]`);
        if (el) return el;

        if (fieldId.includes('__')) {
          const [rowKey, fieldKey] = fieldId.split('__');
          const row = document.getElementById(rowKey) || document.querySelector(`[data-row-id="${safeEscape(rowKey)}"], [data-item-id="${safeEscape(rowKey)}"], [data-id="${safeEscape(rowKey)}"]`);
          if (row) {
            el = row.querySelector(`[name="${safeEscape(fieldKey)}"], [placeholder="${safeEscape(fieldKey)}"], [aria-label="${safeEscape(fieldKey)}"]`);
            if (el) return el;
          }
        }
      } catch(e) {}
      return null;
    }

    function escapeHtmlStr(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function unlockField(fieldId) {
      if (!activeRemoteLocks.has(fieldId)) return;
      const info = activeRemoteLocks.get(fieldId);
      clearTimeout(info.timer);
      if (info.tagEl && info.tagEl.parentElement) {
        info.tagEl.style.opacity = '0';
        info.tagEl.style.transform = 'translateY(4px)';
        setTimeout(() => { try { info.tagEl.remove(); } catch(e) {} }, 180);
      }
      if (info.inputEl) {
        info.inputEl.classList.remove('vf-collab-focus-ring', 'vf-collab-locked-field');
        info.inputEl.style.removeProperty('--vf-collab-color');
        info.inputEl.style.removeProperty('--vf-collab-glow');
        info.inputEl.removeAttribute('data-vf-locked-by');
        info.inputEl.removeAttribute('title');
        
        // Restore interaction
        if (info.origReadOnly !== undefined) {
          info.inputEl.readOnly = info.origReadOnly;
        } else {
          info.inputEl.readOnly = false;
        }
        if (info.origPointerEvents !== undefined) {
          info.inputEl.style.pointerEvents = info.origPointerEvents;
        } else {
          info.inputEl.style.removeProperty('pointer-events');
        }
      }
      activeRemoteLocks.delete(fieldId);
    }

    function lockFieldForRemoteUser(fieldId, user) {
      const el = findElementByFieldId(fieldId);
      if (!el) return;

      // If local user is currently on this element, yield focus to the remote editor
      if (document.activeElement === el) {
        try { el.blur(); } catch(e) {}
      }

      // Clean up previous lock if any
      unlockField(fieldId);

      const color = user.color || { bg: '#8b5cf6', fg: '#ffffff', glow: 'rgba(139,92,246,0.35)' };
      const origReadOnly = el.readOnly;
      const origPointerEvents = el.style.pointerEvents;

      el.classList.add('vf-collab-focus-ring', 'vf-collab-locked-field');
      el.style.setProperty('--vf-collab-color', color.bg);
      el.style.setProperty('--vf-collab-glow', color.glow || 'rgba(139,92,246,0.35)');
      el.setAttribute('data-vf-locked-by', user.name || 'User');
      el.setAttribute('title', `🔒 Locked: ${user.name || 'User'} is entering data...`);

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (tag === 'select') {
        el.style.pointerEvents = 'none';
      } else {
        el.readOnly = true;
      }

      const tagEl = document.createElement('div');
      tagEl.className = 'vf-collab-editor-tag';
      tagEl.style.setProperty('--vf-collab-color', color.bg);
      tagEl.innerHTML = `
        <span style="font-size:0.7rem; line-height: 1;">🔒</span>
        <span style="font-weight: 700;">${escapeHtmlStr(user.name || 'User')}</span>
        <span style="opacity: 0.85; font-size: 0.65rem;">is editing</span>
      `;

      const parent = el.parentElement;
      if (parent) {
        const computedPos = window.getComputedStyle(parent).position;
        if (computedPos === 'static') {
          parent.style.position = 'relative';
        }
        parent.appendChild(tagEl);
      }

      // Safety timeout: auto-unlock after 2.5 seconds of inactivity if blur was missed
      const timer = setTimeout(() => {
        unlockField(fieldId);
      }, 2500);

      activeRemoteLocks.set(fieldId, {
        tagEl: tagEl,
        inputEl: el,
        user: user,
        timer: timer,
        origReadOnly: origReadOnly,
        origPointerEvents: origPointerEvents
      });
    }

    // Local user focus & typing broadcasters (ONLY triggers on genuine trusted user interactions)
    document.addEventListener('focusin', (e) => {
      const fid = getFieldIdentifier(e.target);
      if (fid) {
        unlockField(fid); // Immediately clear any stale remote lock for local user
      }
      if (!e.isTrusted) return;
      if (!fid) return;
      broadcastFieldFocus(fid, true, {
        label: e.target.placeholder || e.target.name || ''
      });
    }, true);

    document.addEventListener('focusout', (e) => {
      if (!e.isTrusted) return;
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      broadcastFieldFocus(fid, false);
    }, true);

    document.addEventListener('input', (e) => {
      if (!e.isTrusted) return; // Prevent synthetic events from echoing into broadcast loop
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      const val = e.target.value;
      lastLocalFieldWrites.set(fid, Date.now());

      if (fieldDebounceTimers.has(fid)) {
        clearTimeout(fieldDebounceTimers.get(fid));
      }

      // Fast-flush (0ms for empty/cleared, 10ms on typing) for instantaneous live peer reflection
      const delay = (val === '') ? 0 : 10;
      const timer = setTimeout(() => {
        broadcastFieldChange(fid, val, {
          label: e.target.placeholder || e.target.name || ''
        });
        fieldDebounceTimers.delete(fid);
      }, delay);
      fieldDebounceTimers.set(fid, timer);
    }, true);

    document.addEventListener('change', (e) => {
      if (!e.isTrusted) return;
      const fid = getFieldIdentifier(e.target);
      if (!fid) return;
      const val = e.target.value;
      lastLocalFieldWrites.set(fid, Date.now());

      if (fieldDebounceTimers.has(fid)) {
        clearTimeout(fieldDebounceTimers.get(fid));
        fieldDebounceTimers.delete(fid);
      }
      broadcastFieldChange(fid, val, {
        label: e.target.placeholder || e.target.name || ''
      });
    }, true);

    // Incoming Remote Field Focus Handler (Google Sheets Style Single-Field Locking)
    window.addEventListener('supabase-field-focus', (e) => {
      const { fieldId, isFocused, user, senderId } = e.detail || {};
      if (!fieldId || senderId === CLIENT_ID) return;

      if (isFocused && user) {
        lockFieldForRemoteUser(fieldId, user);
      } else {
        unlockField(fieldId);
      }
    });

    // Incoming Remote Field Change Handler (Live Keystrokes & Live Values)
    window.addEventListener('supabase-field-change', (e) => {
      const { fieldId, value, user, senderId, meta } = e.detail || {};
      if (!fieldId || value === undefined || value === null || senderId === CLIENT_ID) return;

      const el = findElementByFieldId(fieldId);
      if (!el) return;

      // If incoming remote change is for this element and local user had cursor, yield focus to remote editor
      if (document.activeElement === el && !meta?.isSnapshot) {
        try { el.blur(); } catch(e) {}
      }

      // Refresh auto-unlock timeout only if this field is already actively locked by focus
      if (activeRemoteLocks.has(fieldId)) {
        const lockInfo = activeRemoteLocks.get(fieldId);
        clearTimeout(lockInfo.timer);
        lockInfo.timer = setTimeout(() => {
          unlockField(fieldId);
        }, 2500);
      }

      if (String(el.value) !== String(value)) {
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ? 
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set : null;
        const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ?
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set : null;
        const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value') ?
          Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set : null;
        
        try {
          if (tag === 'input' && nativeInputValueSetter) {
            nativeInputValueSetter.call(el, value);
          } else if (tag === 'textarea' && nativeTextAreaValueSetter) {
            nativeTextAreaValueSetter.call(el, value);
          } else if (tag === 'select' && nativeSelectValueSetter) {
            nativeSelectValueSetter.call(el, value);
          } else {
            el.value = value;
          }
        } catch(err) {
          el.value = value;
        }

        // Direct guarantee
        el.value = value;

        // Trigger local UI reactivity (calculations, previews, dropdown dependents) without echoing back
        try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
      }
    });

    // Incoming Remote Form Clear Handler
    window.addEventListener('supabase-form-clear', (e) => {
      const { fieldIds, senderId } = e.detail || {};
      if (senderId === CLIENT_ID) return;

      if (Array.isArray(fieldIds) && fieldIds.length > 0) {
        fieldIds.forEach(fid => {
          unlockField(fid);
          const el = findElementByFieldId(fid);
          if (el && el !== document.activeElement) {
            el.value = '';
            try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e) {}
            try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
          }
        });
      } else {
        // Unlock all active locks if broad form clear
        Array.from(activeRemoteLocks.keys()).forEach(fid => unlockField(fid));
      }
    });

    // Function to broadcast all currently filled input fields so new/joining users immediately see active entry data
    function broadcastActiveFormSnapshot(container) {
      try {
        const root = (container && typeof container.querySelectorAll === 'function') ? container : document;
        const inputs = root.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="file"]), textarea, select');
        inputs.forEach(el => {
          const fid = getFieldIdentifier(el);
          // CRITICAL: Only broadcast NON-EMPTY values during snapshot catchup so blank/fresh forms never overwrite active peer data
          if (fid && el.value !== undefined && el.value !== null && String(el.value).trim() !== '') {
            broadcastFieldChange(fid, el.value, {
              label: el.placeholder || el.name || '',
              isSnapshot: true
            });
          }
        });
        if (document.activeElement && (!container || container.contains(document.activeElement))) {
          const fid = getFieldIdentifier(document.activeElement);
          if (fid && document.activeElement.value && String(document.activeElement.value).trim() !== '') {
            broadcastFieldFocus(fid, true, {
              label: document.activeElement.placeholder || document.activeElement.name || ''
            });
          }
        }
      } catch(e) {}
    }
    window.__vf_broadcastActiveFormSnapshot = broadcastActiveFormSnapshot;
  }

  function handleIncomingFieldFocus(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-field-focus', { detail: payload }));
    } catch(e) {}
  }

  function handleIncomingFieldChange(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-field-change', { detail: payload }));
    } catch(e) {}
  }

  function handleIncomingFormClear(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      window.dispatchEvent(new CustomEvent('supabase-form-clear', { detail: payload }));
    } catch(e) {}
  }

  function handleIncomingItemDeleted(payload) {
    if (!payload || payload.senderId === CLIENT_ID) return;
    try {
      const { key, itemId } = payload;
      if (itemId) {
        const idStr = String(itemId).trim();
        let deletedIds = getDeletedTombstones();
        if (!deletedIds.includes(idStr)) {
          deletedIds.push(idStr);
          cache['vf_deleted_entity_ids'] = JSON.stringify(deletedIds);
          safeLocalStorageSet('vf_deleted_entity_ids', JSON.stringify(deletedIds));
        }

        // Clean from all known entity keys in cache immediately
        const entityKeys = ['yarn-qualities', 'yarn-suppliers', 'manage-looms', 'manage-jacquards', 'manage-jalas', 'manage-fanis', 'machines'];
        if (key && !entityKeys.includes(key)) entityKeys.push(key);

        entityKeys.forEach(k => {
          if (cache[k]) {
            try {
              const parsed = JSON.parse(cache[k]);
              if (Array.isArray(parsed)) {
                const filtered = filterDeletedEntities(parsed);
                const newStr = JSON.stringify(filtered);
                cache[k] = newStr;
                safeLocalStorageSet(k, newStr);
              }
            } catch(e) {}
          }
        });

        // Clean from state object (e.g. aethertasks_db_state_v7)
        if (cache['aethertasks_db_state_v7']) {
          try {
            const parsed = JSON.parse(cache['aethertasks_db_state_v7']);
            if (parsed && typeof parsed === 'object') {
              if (Array.isArray(parsed.employees)) parsed.employees = filterDeletedEntities(parsed.employees);
              if (Array.isArray(parsed.machines)) parsed.machines = filterDeletedEntities(parsed.machines);
              if (Array.isArray(parsed.loans)) parsed.loans = filterDeletedEntities(parsed.loans);
              const newStr = JSON.stringify(parsed);
              cache['aethertasks_db_state_v7'] = newStr;
              safeLocalStorageSet('aethertasks_db_state_v7', newStr);
            }
          } catch(e) {}
        }
      }
      window.dispatchEvent(new CustomEvent('supabase-item-deleted', { detail: payload }));
      window.dispatchEvent(new Event('storage'));
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCollaborativeDOMSync);
  } else {
    initCollaborativeDOMSync();
  }

  if (syncChannel) {
    syncChannel.onmessage = (msg) => {
      if (msg && msg.data) {
        const { key, value, type, senderId, payload } = msg.data;
        if (senderId === CLIENT_ID) return; // Skip own messages

        if (type === 'presence_hello' && payload) {
          handleIncomingPresenceHello(payload);
        } else if (type === 'presence_announce' && payload) {
          handleIncomingPresenceAnnounce(payload);
        } else if (type === 'presence_ping' && payload) {
          handleIncomingPresencePing(payload);
        } else if (type === 'presence_leave' && payload) {
          handleIncomingPresenceLeave(payload);
        } else if (type === 'field_focus' && payload) {
          handleIncomingFieldFocus(payload);
        } else if (type === 'field_change' && payload) {
          handleIncomingFieldChange(payload);
        } else if (type === 'form_clear' && payload) {
          handleIncomingFormClear(payload);
        } else if (type === 'item_deleted' && payload) {
          handleIncomingItemDeleted(payload);
        } else if (key) {
          if (type === 'removeItem') {
            handleIncomingRemoteUpdate(key, null, true);
          } else {
            handleIncomingRemoteUpdate(key, value, false);
          }
        }
      }
    };
  }

  function initRealtimeWebSocket() {
    if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setSyncStatus('unconfigured');
      return;
    }
    if (typeof WebSocket === 'undefined') return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      const cleanHost = SUPABASE_URL.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      const wsUrl = `wss://${cleanHost}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsReconnectAttempts = 0;
        setSyncStatus('connected');

        // Join the Realtime Broadcast channel
        const joinMsg = {
          topic: WS_CHANNEL_TOPIC,
          event: 'phx_join',
          payload: { config: { broadcast: { ack: false, self: false } } },
          ref: 'join_' + Date.now()
        };
        ws.send(JSON.stringify(joinMsg));

        // Start heartbeat ping every 25 seconds
        clearInterval(wsHeartbeatTimer);
        wsHeartbeatTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 'hb_' + Date.now() }));
          }
        }, 25000);

        // Immediate presence announcement on socket connect with peer discovery
        sendPresenceHello();
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.event === 'broadcast' && data.payload) {
            const rawPayload = data.payload;
            const inner = (rawPayload && rawPayload.payload && typeof rawPayload.payload === 'object') ? rawPayload.payload : rawPayload;
            
            const sender = inner.senderId || inner.clientId || rawPayload.senderId || rawPayload.clientId;
            if (sender && sender === CLIENT_ID) return; // Skip own messages

            const eventType = inner.type || rawPayload.event || rawPayload.type || data.event;

            if (eventType === 'presence_hello') {
              handleIncomingPresenceHello(inner);
            } else if (eventType === 'presence_announce') {
              handleIncomingPresenceAnnounce(inner);
            } else if (eventType === 'presence_ping') {
              handleIncomingPresencePing(inner);
            } else if (eventType === 'presence_leave') {
              handleIncomingPresenceLeave(inner);
            } else if (eventType === 'field_focus') {
              handleIncomingFieldFocus(inner);
            } else if (eventType === 'field_change') {
              handleIncomingFieldChange(inner);
            } else if (eventType === 'form_clear') {
              handleIncomingFormClear(inner);
            } else if (eventType === 'item_deleted') {
              handleIncomingItemDeleted(inner);
            } else if (inner.key || rawPayload.key) {
              const targetKey = inner.key || rawPayload.key;
              const targetVal = inner.value !== undefined ? inner.value : rawPayload.value;
              const valStr = typeof targetVal === 'string' ? targetVal : JSON.stringify(targetVal);
              handleIncomingRemoteUpdate(targetKey, valStr, false);
            }
          }
        } catch (err) {}
      };

      ws.onclose = () => {
        if (activeConfig.isConfigured) {
          setSyncStatus('offline');
          clearInterval(wsHeartbeatTimer);
          scheduleWsReconnect();
        }
      };

      ws.onerror = () => {
        if (activeConfig.isConfigured) {
          setSyncStatus('offline');
          try { ws.close(); } catch(e) {}
        }
      };
    } catch (e) {
      if (activeConfig.isConfigured) {
        scheduleWsReconnect();
      }
    }
  }

  function scheduleWsReconnect() {
    clearTimeout(wsReconnectTimer);
    const delay = Math.min(30000, 1000 * Math.pow(1.5, wsReconnectAttempts++));
    wsReconnectTimer = setTimeout(() => {
      if (!document.hidden) {
        initRealtimeWebSocket();
      }
    }, delay);
  }

  function broadcastRealtimeUpdate(key, value) {
    if (isLocalOnlyKey(key)) return;
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const broadcastMsg = {
          topic: WS_CHANNEL_TOPIC,
          event: 'broadcast',
          payload: {
            type: 'broadcast',
            event: 'costing_sync',
            payload: {
              key: key,
              value: value,
              senderId: CLIENT_ID,
              timestamp: Date.now()
            }
          },
          ref: 'bc_' + Date.now()
        };
        ws.send(JSON.stringify(broadcastMsg));
      } catch (e) {}
    }
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          key: key,
          value: valStr,
          type: 'setItem',
          senderId: CLIENT_ID
        });
      } catch(e) {}
    }
  }

  // Track last known server timestamps to avoid re-downloading unchanged payloads
  const lastKnownTimestamps = {};

  // Simple string hash function for quick payload equality check
  function computeHash(str) {
    if (!str) return '0';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }

  // --- Infinite Scale Paginated PostgREST Fetcher ---
  // Chunked batch queries bypass default 1,000-row PostgREST limits for arbitrary dataset sizes
  async function fetchAllRowsPaginated(tableOrPath, select = '*', extraParams = '') {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
    const pageSize = 1000;
    let offset = 0;
    let allRows = [];
    let hasMore = true;

    while (hasMore) {
      try {
        const separator = tableOrPath.includes('?') ? '&' : '?';
        const url = `${SUPABASE_URL}/rest/v1/${tableOrPath}${separator}select=${encodeURIComponent(select)}&limit=${pageSize}&offset=${offset}${extraParams ? ('&' + extraParams) : ''}`;
        const res = await fetch(url, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!res.ok) break;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        allRows = allRows.concat(rows);
        if (rows.length < pageSize) {
          hasMore = false;
        } else {
          offset += pageSize;
        }
      } catch (e) {
        console.warn('Pagination fetch notice:', e);
        break;
      }
    }
    return allRows;
  }

  // Supabase REST API Client
  const supabaseApi = {
    isHydrated: () => isHydrated,
    getStatus: () => currentStatus,
    async get(key) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=eq.${encodeURIComponent(key)}&select=value`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data && data.length > 0 ? data[0].value : null;
      } catch (e) {
        console.error('Supabase fetch error:', e);
        return null;
      }
    },
    // Debounced and Hash-Guarded Persistent Database Write (Zero Wasted POST Quota)
    set(key, value, isImmediate = false) {
      if (isLocalOnlyKey(key)) return false;
      try {
        lastLocalWrites[key] = Date.now();

        const nowIso = new Date().toISOString();
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        const payloadHash = computeHash(valStr);

        // Always clear pending debounced write timer for this key immediately
        clearTimeout(debouncedWriteTimers[key]);

        // Check if unchanged to avoid redundant database writes
        if (lastSavedHashes[key] === payloadHash) {
          return true;
        }

        // Broadcast immediately over Realtime WebSocket & BroadcastChannel (instant sub-50ms sync, 0 DB queries)
        broadcastRealtimeUpdate(key, value);

        const executeDbWrite = async () => {
          if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
          try {
            setSyncStatus('syncing');
            lastKnownTimestamps[key] = nowIso;
            lastSavedHashes[key] = payloadHash;
            cache[key] = valStr;

            // Master Key-Value table sync
            await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?on_conflict=key`, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
              },
              body: JSON.stringify({
                key: key,
                value: value,
                updated_at: nowIso
              })
            });

            // Dedicated table writes if costing key
            let table = null;
            if (key === 'costing-products-v4') table = 'vf_costing_products';
            else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
            else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
            else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

            if (table && Array.isArray(value) && value.length > 0) {
              const rows = value.filter(item => item && item.id).map(item => ({
                id: String(item.id),
                data: item,
                updated_at: nowIso
              }));

              if (rows.length > 0) {
                // Batch in chunks of 500 for safety against large payloads
                const chunkSize = 500;
                for (let i = 0; i < rows.length; i += chunkSize) {
                  const chunk = rows.slice(i, i + chunkSize);
                  await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
                    method: 'POST',
                    headers: {
                      'apikey': SUPABASE_ANON_KEY,
                      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                      'Content-Type': 'application/json',
                      'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(chunk)
                  }).catch(() => {});
                }
              }
            }

            // Dedicated Relational Synchronization for Yarn RM Stock Book
            if (key === 'vishwa_yarn_rm_stock_data' && Array.isArray(value) && value.length > 0) {
              try {
                const lotRows = [];
                const boxRows = [];

                value.forEach(lot => {
                  if (!lot || !lot.id) return;
                  const lotId = String(lot.id);
                  const boxes = Array.isArray(lot.boxes) ? lot.boxes : [];
                  const grossWt = boxes.reduce((sum, b) => sum + (parseFloat(b.grossWeight) || parseFloat(b.weight) || 0), 0);

                  lotRows.push({
                    id: lotId,
                    batch_id: lot.batchId || null,
                    lot_number: String(lot.lotNumber || lot.id || 'LOT-AUTO'),
                    challan_number: String(lot.challanNo || lot.challanNumber || ''),
                    receive_date: (lot.receiveDate || lot.date || new Date().toISOString().split('T')[0]).split('T')[0],
                    supplier: String(lot.supplier || ''),
                    quality: String(lot.quality || ''),
                    item_type: String(lot.itemType || lot.category || 'Polyester'),
                    code: String(lot.code || ''),
                    color: String(lot.color || ''),
                    rate: parseFloat(lot.rate || lot.price) || 0,
                    order_ref: String(lot.orderRef || ''),
                    total_boxes: boxes.length,
                    gross_weight: parseFloat(grossWt.toFixed(2)),
                    notes: lot.notes || '',
                    updated_at: nowIso
                  });

                  boxes.forEach((b, bIdx) => {
                    const boxId = String(b.id || b.boxNumber || `B${bIdx + 1}`).trim();
                    const bUid = `${lotId}__${boxId}`;
                    const bGross = parseFloat(b.grossWeight) || parseFloat(b.weight) || 0;
                    const bGr = parseFloat(b.grWeight || b.returnedWeight) || 0;
                    const bRem = b.remainingWeight !== undefined ? parseFloat(b.remainingWeight) : Math.max(0, bGross - bGr);
                    const bActive = parseFloat(b.weight) || (b.status === 'gr' ? bGross : bRem);

                    boxRows.push({
                      id: bUid,
                      lot_id: lotId,
                      box_number: boxId,
                      cones: parseInt(b.cones, 10) || 0,
                      gross_weight: parseFloat(bGross.toFixed(2)),
                      remaining_weight: parseFloat(bRem.toFixed(2)),
                      active_weight: parseFloat(bActive.toFixed(2)),
                      status: b.status === 'issued' ? 'issued' : (b.status === 'gr' ? 'gr' : 'available'),
                      issue_date: b.issueDate ? String(b.issueDate).split('T')[0] : null,
                      issued_to: b.issuedTo || null,
                      gr_date: b.grDate ? String(b.grDate).split('T')[0] : null,
                      gr_weight: parseFloat(bGr.toFixed(2)),
                      gr_remarks: b.grRemarks || null,
                      updated_at: nowIso
                    });
                  });
                });

                if (lotRows.length > 0) {
                  for (let i = 0; i < lotRows.length; i += 200) {
                    const chunk = lotRows.slice(i, i + 200);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }

                if (boxRows.length > 0) {
                  for (let i = 0; i < boxRows.length; i += 500) {
                    const chunk = boxRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_boxes?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Yarn RM Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn RM Orders
            if (key === 'yarn-rm-orders' && Array.isArray(value) && value.length > 0) {
              try {
                const orderRows = [];
                const batchRows = [];
                const boxRows = [];

                value.forEach(order => {
                  if (!order || !order.id) return;
                  const orderId = String(order.id);
                  const orderNum = String(order.orderNumber || order.id || 'YRN-AUTO');
                  const orderDate = (order.orderDate || order.createdAt || new Date().toISOString().split('T')[0]).split('T')[0];

                  orderRows.push({
                    id: orderId,
                    order_number: orderNum,
                    order_date: orderDate,
                    supplier: String(order.supplier || ''),
                    category: String(order.category || order.type || 'Polyester'),
                    quality: String(order.quality || ''),
                    code: String(order.code || ''),
                    color: String(order.color || ''),
                    ordered_weight: parseFloat(order.orderedWeight) || 0,
                    price: parseFloat(order.price) || 0,
                    status: order.status === 'Completed' ? 'Completed' : (order.status === 'Cancelled' ? 'Cancelled' : 'Active'),
                    remarks: order.remarks || order.notes || '',
                    updated_at: nowIso
                  });

                  (order.batches || []).forEach((batch, bIdx) => {
                    if (!batch) return;
                    const batchId = String(batch.id || `${orderId}__BATCH-${bIdx}`);
                    const bChallan = String(batch.challanNumber || '').trim();
                    const bLot = String(batch.lotNumber || '').trim();
                    const bDate = (batch.receiveDate || orderDate).split('T')[0];
                    const bBoxes = Array.isArray(batch.boxes) ? batch.boxes : [];
                    const bTotalWeight = parseFloat(batch.totalWeight) || bBoxes.reduce((sum, bx) => sum + (parseFloat(bx.weight) || 0), 0);

                    batchRows.push({
                      id: batchId,
                      order_id: orderId,
                      challan_number: bChallan,
                      lot_number: bLot,
                      receive_date: bDate,
                      total_weight: parseFloat(bTotalWeight.toFixed(2)),
                      notes: batch.notes || '',
                      updated_at: nowIso
                    });

                    bBoxes.forEach((bx, bxIdx) => {
                      const boxNum = String(bx.boxNumber || `B${bxIdx + 1}`).trim();
                      const boxUid = `${batchId}__${boxNum}`;
                      boxRows.push({
                        id: boxUid,
                        batch_id: batchId,
                        order_id: orderId,
                        box_number: boxNum,
                        weight: parseFloat(bx.weight) || 0,
                        cones: parseInt(bx.cones, 10) || 0,
                        returned_weight: parseFloat(bx.returnedWeight) || 0,
                        returned_date: bx.returnedDate ? String(bx.returnedDate).split('T')[0] : null,
                        return_reason: bx.returnReason || null,
                        updated_at: nowIso
                      });
                    });
                  });
                });

                if (orderRows.length > 0) {
                  for (let i = 0; i < orderRows.length; i += 200) {
                    const chunk = orderRows.slice(i, i + 200);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_orders?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }

                if (batchRows.length > 0) {
                  for (let i = 0; i < batchRows.length; i += 300) {
                    const chunk = batchRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_batches?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }

                if (boxRows.length > 0) {
                  for (let i = 0; i < boxRows.length; i += 500) {
                    const chunk = boxRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_order_boxes?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Yarn RM Orders Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Weft Yarn Issues
            if (key === 'yarn-issues' && Array.isArray(value) && value.length > 0) {
              try {
                const issueRows = value.map(iss => {
                  if (!iss) return null;
                  const issId = String(iss.id || `ISS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const issDate = (iss.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: issId,
                    date: issDate,
                    quality: String(iss.quality || ''),
                    supplier: String(iss.supplier || iss.company || ''),
                    code: iss.code ? String(iss.code) : null,
                    color: iss.color ? String(iss.color) : null,
                    box: String(iss.box || ''),
                    challan: iss.challan ? String(iss.challan) : null,
                    lot: iss.lot ? String(iss.lot) : null,
                    cones: parseFloat(iss.cones) || 0,
                    net: parseFloat(iss.net) || 0,
                    details: iss.details || null,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (issueRows.length > 0) {
                  for (let i = 0; i < issueRows.length; i += 500) {
                    const chunk = issueRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_weft_issues?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Weft Issues Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Warp Beams
            if (key === 'warp-beams' && Array.isArray(value) && value.length > 0) {
              try {
                const beamRows = value.map(b => {
                  if (!b || !b.beamNumber) return null;
                  const bId = String(b.id || `BEAM-${b.beamNumber}`);
                  const bCreated = (b.createdAt || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: bId,
                    beam_number: String(b.beamNumber).trim(),
                    quality: String(b.quality || ''),
                    code: b.code ? String(b.code) : null,
                    color: b.color ? String(b.color) : null,
                    meters: parseFloat(b.meters) || 0,
                    ends: parseInt(b.ends, 10) || 0,
                    status: String(b.status || 'Available'),
                    machine_number: b.machineNumber ? String(b.machineNumber) : null,
                    warping_person: b.warpingPerson || null,
                    created_at: bCreated,
                    history: Array.isArray(b.history) ? b.history : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (beamRows.length > 0) {
                  for (let i = 0; i < beamRows.length; i += 300) {
                    const chunk = beamRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beams?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Warp Beams Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Warp Yarn Issues
            if (key === 'warp-issues' && Array.isArray(value) && value.length > 0) {
              try {
                const warpIssRows = value.map(iss => {
                  if (!iss) return null;
                  const issId = String(iss.id || `WARP-ISS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const issDate = (iss.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: issId,
                    date: issDate,
                    quality: String(iss.quality || ''),
                    code: iss.code ? String(iss.code) : null,
                    color: iss.color ? String(iss.color) : null,
                    issued_weight: parseFloat(iss.issuedWeight || iss.net) || 0,
                    details: iss.details || null,
                    supplier: iss.supplier ? String(iss.supplier) : null,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (warpIssRows.length > 0) {
                  for (let i = 0; i < warpIssRows.length; i += 500) {
                    const chunk = warpIssRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_issues?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Warp Issues Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Warp Beam Loadings
            if (key === 'warp-beam-loadings' && Array.isArray(value) && value.length > 0) {
              try {
                const loadingRows = value.map(bl => {
                  if (!bl) return null;
                  const blId = String(bl.id || `BL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const blDate = (bl.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: blId,
                    date: blDate,
                    piecein: bl.piecein || null,
                    drawing_in: bl.drawingIn || null,
                    fani: bl.fani || null,
                    drop_pin_jog: bl.dropPinJog || null,
                    machine_number: bl.machineNumber ? String(bl.machineNumber) : null,
                    beam_number: bl.beamNumber ? String(bl.beamNumber) : null,
                    item_color: bl.itemColor || null,
                    meters: parseFloat(bl.meters) || 0,
                    ends: parseInt(bl.ends, 10) || 0,
                    rate: parseFloat(bl.rate) || 0,
                    payment_amount: parseFloat(bl.paymentAmount) || 0,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (loadingRows.length > 0) {
                  for (let i = 0; i < loadingRows.length; i += 500) {
                    const chunk = loadingRows.slice(i, i + 500);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beam_loadings?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Warp Beam Loadings Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Weaving Loom Production Logs
            if (key === 'productionLogs' && Array.isArray(value) && value.length > 0) {
              try {
                const prodRows = value.map(l => {
                  if (!l || !l.productionDate || !l.machineNumber) return null;
                  const logId = String(l.id || `PROD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const prodDate = (l.productionDate || new Date().toISOString().split('T')[0]).split('T')[0];
                  const pissDate = l.pissingDate ? String(l.pissingDate).split('T')[0] : null;
                  const foldDate = l.foldingDate ? String(l.foldingDate).split('T')[0] : null;
                  return {
                    id: logId,
                    production_date: prodDate,
                    machine_number: String(l.machineNumber).trim(),
                    beam_number: l.beamNumber ? String(l.beamNumber).trim() : null,
                    secondary_beam_number: l.secondaryBeamNumber ? String(l.secondaryBeamNumber).trim() : null,
                    pissing_date: pissDate,
                    pissing_person: l.pissingPerson || null,
                    day_worker: l.dayWorker || null,
                    day_shift_hours: parseFloat(l.dayShiftHours) || 0,
                    day_meters: parseFloat(l.dayMeters) || 0,
                    night_worker: l.nightWorker || null,
                    night_shift_hours: parseFloat(l.nightShiftHours) || 0,
                    night_meters: parseFloat(l.nightMeters) || 0,
                    picks: parseInt(l.picks, 10) || 0,
                    product: l.product || null,
                    total_meters: parseFloat(l.totalMeters) || 0,
                    taka_serial: l.takaSerial ? String(l.takaSerial).trim() : null,
                    folding_date: foldDate,
                    taka_weight: l.takaWeight !== null && l.takaWeight !== undefined ? parseFloat(l.takaWeight) : null,
                    taka_assign_id: l.takaAssignId || null,
                    is_tp_roll: Boolean(l.isTpRoll),
                    tp_source_serials: Array.isArray(l.tpSourceSerials) ? l.tpSourceSerials : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (prodRows.length > 0) {
                  for (let i = 0; i < prodRows.length; i += 300) {
                    const chunk = prodRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_weaving_production_logs?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Weaving Production Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn Production Logs (Covering, TFO, Doubler)
            if (key.startsWith('yarn_') && key.endsWith('_production_logs') && Array.isArray(value) && value.length > 0) {
              try {
                const division = key.replace('yarn_', '').replace('_production_logs', '');
                const yarnProdRows = value.map(yp => {
                  if (!yp || !yp.boriNo) return null;
                  const ypId = String(yp.id || `YP-${division}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const ypDate = (yp.date || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: ypId,
                    division: division,
                    date: ypDate,
                    bori_no: String(yp.boriNo).trim(),
                    product_name: String(yp.productName || '').trim(),
                    product_id: yp.productId || null,
                    lot_no: yp.lotNo ? String(yp.lotNo).trim() : null,
                    color: yp.color || null,
                    denier: parseFloat(yp.denier) || null,
                    tpm: parseInt(yp.tpm, 10) || null,
                    twist: yp.twist || null,
                    rolls: parseInt(yp.rolls, 10) || 0,
                    qty: parseFloat(yp.qty) || 0,
                    config_type: yp.configType || null,
                    ply: yp.ply ? String(yp.ply) : null,
                    yarns: Array.isArray(yp.yarns) ? yp.yarns : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (yarnProdRows.length > 0) {
                  for (let i = 0; i < yarnProdRows.length; i += 300) {
                    const chunk = yarnProdRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Yarn Production Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Yarn Sales Logs (Covering, TFO, Doubler)
            if (key.startsWith('yarn_') && key.endsWith('_sales_logs') && Array.isArray(value) && value.length > 0) {
              try {
                const division = key.replace('yarn_', '').replace('_sales_logs', '');
                const yarnSaleRows = value.map(ys => {
                  if (!ys) return null;
                  const ysId = String(ys.id || `YS-${division}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                  const ysDate = (ys.date || ys.saleDate || new Date().toISOString().split('T')[0]).split('T')[0];
                  return {
                    id: ysId,
                    division: division,
                    sale_date: ysDate,
                    challan_no: ys.challanNo ? String(ys.challanNo).trim() : null,
                    customer_name: String(ys.customerName || ys.customer || 'Unknown').trim(),
                    items: Array.isArray(ys.items) ? ys.items : [],
                    total_qty: parseFloat(ys.totalQty || ys.saleQty || ys.qty) || 0,
                    total_amount: parseFloat(ys.totalAmount || ys.amount) || 0,
                    gst_amount: parseFloat(ys.gstAmount || ys.gst) || 0,
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (yarnSaleRows.length > 0) {
                  for (let i = 0; i < yarnSaleRows.length; i += 300) {
                    const chunk = yarnSaleRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Yarn Sales Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Fabric Dispatches & Outsource Pipeline
            if (key === 'takaDispatchStates' && typeof value === 'object' && value !== null) {
              try {
                const dispatchEntries = Object.entries(value);
                const dispatchRows = dispatchEntries.map(([serial, data]) => {
                  if (!serial || !data) return null;
                  const s = String(serial).trim();
                  return {
                    id: s,
                    taka_serial: s,
                    status: String(data.status || 'Warehouse').trim(),
                    current_stage: String(data.currentStage || data.stage || 'Warehouse').trim(),
                    vendor: data.vendor ? String(data.vendor).trim() : null,
                    customer: data.customer ? String(data.customer).trim() : null,
                    invoice_no: (data.invoice || data.invoiceNumber || data.invoiceNo) ? String(data.invoice || data.invoiceNumber || data.invoiceNo).trim() : null,
                    challan_no: (data.challan || data.challanNumber || data.challanNo) ? String(data.challan || data.challanNumber || data.challanNo).trim() : null,
                    dispatch_date: (data.dispatchDate || data.date) ? String(data.dispatchDate || data.date).split('T')[0] : null,
                    selling_rate: (data.rate !== undefined && data.rate !== null && data.rate !== '') ? parseFloat(data.rate) : null,
                    is_partial_piece: Boolean(data.isPartialPiece),
                    history: Array.isArray(data.history) ? data.history : [],
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (dispatchRows.length > 0) {
                  for (let i = 0; i < dispatchRows.length; i += 300) {
                    const chunk = dispatchRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_dispatches?on_conflict=taka_serial`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Fabric Dispatches Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Fabric Cut Relations
            if (key === 'takaCutRelations' && typeof value === 'object' && value !== null) {
              try {
                const cutEntries = Object.entries(value);
                const cutRows = cutEntries.map(([parentSerial, cutData]) => {
                  if (!parentSerial || !cutData) return null;
                  const ps = String(parentSerial).trim();
                  const children = Array.isArray(cutData) ? cutData : (Array.isArray(cutData.children) ? cutData.children : []);
                  return {
                    id: ps,
                    parent_serial: ps,
                    children: children,
                    metadata: typeof cutData === 'object' && !Array.isArray(cutData) ? cutData : {},
                    updated_at: nowIso
                  };
                }).filter(Boolean);

                if (cutRows.length > 0) {
                  for (let i = 0; i < cutRows.length; i += 300) {
                    const chunk = cutRows.slice(i, i + 300);
                    await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_cut_relations?on_conflict=id`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                      },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
              } catch(e) {
                console.warn('Fabric Cut Relations Relational Sync notice:', e);
              }
            }

            // Dedicated Relational Synchronization for Salary Sheet & Staff Attendance
            if ((key === 'aethertasks_db_state_v7' || key === 'staff-salary-state') && typeof value === 'object' && value !== null) {
              try {
                // 1. Sync Employees Master
                if (Array.isArray(value.employees) && value.employees.length > 0) {
                  const empRows = value.employees.map(emp => {
                    if (!emp || !emp.id) return null;
                    return {
                      id: String(emp.id).trim(),
                      name: String(emp.name || 'Unnamed Employee').trim(),
                      role: String(emp.role || 'Staff').trim(),
                      department: emp.department ? String(emp.department).trim() : null,
                      salary_style: String(emp.salaryStyle || 'Per Day Fixed').trim(),
                      salary_rate: parseFloat(emp.salaryRate) || 0,
                      base_salary: parseFloat(emp.baseSalary) || 0,
                      phone: emp.phone ? String(emp.phone).trim() : null,
                      email: emp.email ? String(emp.email).trim() : null,
                      joining_date: emp.joiningDate ? String(emp.joiningDate).split('T')[0] : null,
                      assigned_machines: Array.isArray(emp.assignedMachines) ? emp.assignedMachines : [],
                      avatar_gradient: emp.avatarGradient || null,
                      active: emp.active !== false,
                      metadata: typeof emp.metadata === 'object' && emp.metadata !== null ? emp.metadata : {},
                      updated_at: nowIso
                    };
                  }).filter(Boolean);

                  if (empRows.length > 0) {
                    for (let i = 0; i < empRows.length; i += 300) {
                      const chunk = empRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_employees?on_conflict=id`, {
                        method: 'POST',
                        headers: {
                          'apikey': SUPABASE_ANON_KEY,
                          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                          'Content-Type': 'application/json',
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(chunk)
                      }).catch(() => {});
                    }
                  }
                }

                // 2. Sync Attendance Records
                if (value.attendance && typeof value.attendance === 'object') {
                  const attRows = [];
                  Object.entries(value.attendance).forEach(([dateStr, empAttMap]) => {
                    if (!dateStr || typeof empAttMap !== 'object' || empAttMap === null) return;
                    const cleanDate = String(dateStr).split('T')[0];
                    Object.entries(empAttMap).forEach(([empId, att]) => {
                      if (!empId || !att) return;
                      const attId = `${cleanDate}_${empId}`;
                      attRows.push({
                        id: attId,
                        attendance_date: cleanDate,
                        employee_id: String(empId).trim(),
                        status: String(att.status || 'Present').trim(),
                        shift: String(att.shift || 'Day').trim(),
                        hours: parseFloat(att.hours) || 0,
                        overtime_hours: parseFloat(att.overtime || att.otHours) || 0,
                        meters: parseFloat(att.meters) || 0,
                        rate: parseFloat(att.rate) || 0,
                        total_earned: parseFloat(att.earned || att.totalEarned) || 0,
                        notes: att.notes ? String(att.notes).trim() : null,
                        metadata: typeof att.metadata === 'object' && att.metadata !== null ? att.metadata : {},
                        updated_at: nowIso
                      });
                    });
                  });

                  if (attRows.length > 0) {
                    for (let i = 0; i < attRows.length; i += 300) {
                      const chunk = attRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?on_conflict=id`, {
                        method: 'POST',
                        headers: {
                          'apikey': SUPABASE_ANON_KEY,
                          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                          'Content-Type': 'application/json',
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(chunk)
                      }).catch(() => {});
                    }
                  }
                }

                // 3. Sync Employee Loans & Advances
                if (Array.isArray(value.loans) && value.loans.length > 0) {
                  const loanRows = value.loans.map(ln => {
                    if (!ln || !ln.empId) return null;
                    const lnId = String(ln.id || `LN-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`);
                    return {
                      id: lnId,
                      employee_id: String(ln.empId).trim(),
                      loan_date: (ln.date || new Date().toISOString().split('T')[0]).split('T')[0],
                      amount: parseFloat(ln.amount) || 0,
                      type: String(ln.type || 'Advance').trim(),
                      reason: ln.reason ? String(ln.reason).trim() : null,
                      cleared: Boolean(ln.cleared),
                      updated_at: nowIso
                    };
                  }).filter(Boolean);

                  if (loanRows.length > 0) {
                    for (let i = 0; i < loanRows.length; i += 300) {
                      const chunk = loanRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?on_conflict=id`, {
                        method: 'POST',
                        headers: {
                          'apikey': SUPABASE_ANON_KEY,
                          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                          'Content-Type': 'application/json',
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(chunk)
                      }).catch(() => {});
                    }
                  }
                }

                // 4. Sync Salary Settlements
                if (value.salaryPayments && typeof value.salaryPayments === 'object') {
                  const settlementRows = [];
                  Object.entries(value.salaryPayments).forEach(([monthYear, empPayMap]) => {
                    if (!monthYear || typeof empPayMap !== 'object' || empPayMap === null) return;
                    Object.entries(empPayMap).forEach(([empId, pay]) => {
                      if (!empId || !pay) return;
                      const setlId = `${monthYear}_${empId}`;
                      settlementRows.push({
                        id: setlId,
                        month_year: String(monthYear).trim(),
                        employee_id: String(empId).trim(),
                        paid_amount: parseFloat(pay.paidAmount || pay.paid) || 0,
                        net_payable: parseFloat(pay.netPayable || pay.payable) || 0,
                        paid_date: pay.paidDate ? String(pay.paidDate).split('T')[0] : null,
                        payment_mode: pay.paymentMode || pay.mode || null,
                        status: String(pay.status || 'Paid').trim(),
                        details: typeof pay === 'object' ? pay : {},
                        updated_at: nowIso
                      });
                    });
                  });

                  if (settlementRows.length > 0) {
                    for (let i = 0; i < settlementRows.length; i += 300) {
                      const chunk = settlementRows.slice(i, i + 300);
                      await fetch(`${SUPABASE_URL}/rest/v1/vf_salary_settlements?on_conflict=id`, {
                        method: 'POST',
                        headers: {
                          'apikey': SUPABASE_ANON_KEY,
                          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                          'Content-Type': 'application/json',
                          'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify(chunk)
                      }).catch(() => {});
                    }
                  }
                }
              } catch(e) {
                console.warn('Salary Sheet Relational Sync notice:', e);
              }
            }

            setSyncStatus(ws && ws.readyState === WebSocket.OPEN ? 'connected' : 'offline');
          } catch (err) {
            console.error('Supabase set error:', err);
            setSyncStatus('offline');
          }
        };

        if (isImmediate) {
          executeDbWrite();
        } else {
          debouncedWriteTimers[key] = setTimeout(executeDbWrite, 1200);
        }
        return true;
      } catch (e) {
        console.error('Supabase set error:', e);
        return false;
      }
    },
    async delete(key) {
      if (isLocalOnlyKey(key)) return;
      try {
        delete lastKnownTimestamps[key];
        delete lastSavedHashes[key];
        delete pendingRemoteUpdates[key];
        if (activeConfig.isConfigured && SUPABASE_URL) {
          await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=eq.${encodeURIComponent(key)}`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          });
        }
      } catch(e) {}
    },
    // Explicit Universal Item Deletion Tombstone Tracking
    async recordDeletion(key, itemId) {
      try {
        const idStr = String(itemId).trim();
        let deletedIds = [];
        try {
          const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
          if (raw) deletedIds = JSON.parse(raw);
        } catch (e) {}
        deletedIds = Array.isArray(deletedIds) ? deletedIds.map(String) : [];

        if (!deletedIds.includes(idStr)) {
          deletedIds.push(idStr);
          // Prune tombstone array to most recent 5000 items to avoid memory leaks
          if (deletedIds.length > 5000) {
            deletedIds = deletedIds.slice(-5000);
          }
          const valStr = JSON.stringify(deletedIds);
          cache['vf_deleted_entity_ids'] = valStr;
          cache['vf_deleted_costing_ids'] = valStr;
          safeLocalStorageSet('vf_deleted_entity_ids', valStr);
          safeLocalStorageSet('vf_deleted_costing_ids', valStr);
          this.set('vf_deleted_entity_ids', deletedIds, true);
        }

        const deletePayload = {
          type: 'item_deleted',
          senderId: CLIENT_ID,
          key: key,
          itemId: idStr,
          timestamp: Date.now()
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({
              topic: WS_CHANNEL_TOPIC,
              event: 'broadcast',
              payload: {
                type: 'broadcast',
                event: 'item_deleted',
                payload: deletePayload
              },
              ref: 'del_' + Date.now()
            }));
          } catch(e) {}
        }

        if (syncChannel) {
          try {
            syncChannel.postMessage({
              type: 'item_deleted',
              senderId: CLIENT_ID,
              payload: deletePayload
            });
          } catch(e) {}
        }

        // Delete from dedicated table if costing key
        let table = null;
        if (key === 'costing-products-v4') table = 'vf_costing_products';
        else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
        else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
        else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

        if (table && activeConfig.isConfigured && SUPABASE_URL) {
          fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(idStr)}`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          }).catch(() => {});
        }
      } catch (e) {}
    },
    async recordCostingDeletion(key, itemId) {
      return this.recordDeletion(key, itemId);
    },
    // Explicit Universal Item Undeletion / Restore Tracking (for Ctrl+Z Undo)
    async unrecordDeletion(key, itemId, itemData = null) {
      try {
        const idStr = String(itemId);
        let deletedIds = [];
        try {
          const raw = cache['vf_deleted_entity_ids'] || cache['vf_deleted_costing_ids'] || nativeLocalStorage.getItem('vf_deleted_entity_ids') || nativeLocalStorage.getItem('vf_deleted_costing_ids');
          if (raw) deletedIds = JSON.parse(raw);
        } catch (e) {}
        deletedIds = Array.isArray(deletedIds) ? deletedIds.map(String) : [];

        if (deletedIds.includes(idStr)) {
          deletedIds = deletedIds.filter(id => id !== idStr);
          const valStr = JSON.stringify(deletedIds);
          cache['vf_deleted_entity_ids'] = valStr;
          cache['vf_deleted_costing_ids'] = valStr;
          safeLocalStorageSet('vf_deleted_entity_ids', valStr);
          safeLocalStorageSet('vf_deleted_costing_ids', valStr);
          this.set('vf_deleted_entity_ids', deletedIds, true);
        }

        // Immediate re-insertion to dedicated Supabase table if itemData exists
        let table = null;
        if (key === 'costing-products-v4') table = 'vf_costing_products';
        else if (key === 'costing-tfo-products-v1') table = 'vf_costing_tfo_products';
        else if (key === 'costing-doubler-products-v1') table = 'vf_costing_doubler_products';
        else if (key === 'costing-covering-products-v1') table = 'vf_costing_covering_products';

        if (table && activeConfig.isConfigured && SUPABASE_URL && itemData) {
          fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([{
              id: idStr,
              data: itemData,
              updated_at: new Date().toISOString()
            }])
          }).catch(() => {});
        }
      } catch (e) {}
    },
    async unrecordCostingDeletion(key, itemId, itemData = null) {
      return this.unrecordDeletion(key, itemId, itemData);
    },
    async clearAll() {
      try {
        Object.keys(lastKnownTimestamps).forEach(k => delete lastKnownTimestamps[k]);
        if (activeConfig.isConfigured && SUPABASE_URL) {
          await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=neq.null`, {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          });
          const tables = ['vf_costing_products', 'vf_costing_tfo_products', 'vf_costing_doubler_products', 'vf_costing_covering_products'];
          for (const t of tables) {
            fetch(`${SUPABASE_URL}/rest/v1/${t}?id=neq.null`, {
              method: 'DELETE',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
              }
            }).catch(() => {});
          }
        }
      } catch(e) {}
    },
    // --- Supabase Authentication API Integration ---
    getAuthHeaders(extraHeaders = {}) {
      let token = null;
      try { token = nativeLocalStorage.getItem('vf_supabase_token'); } catch(e) {}
      const bearer = token || SUPABASE_ANON_KEY;
      return Object.assign({
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      }, extraHeaders);
    },
    async signUp(email, password, metadata = {}) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            password: password,
            data: metadata
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: new Error(data.error_description || data.msg || data.message || 'Sign up failed') };
        }
        this.logAuditTrail('signup', 'auth', email, { role: metadata.role || 'employee' });
        return { data: data, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },
    async signIn(email, password) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: email,
            password: password
          })
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: new Error(data.error_description || data.msg || data.message || 'Invalid login credentials') };
        }
        
        // Save session locally
        if (data.access_token) {
          const user = data.user || {};
          const sessionPayload = {
            id: user.id || ('sp-' + Date.now()),
            email: user.email || email,
            username: (user.user_metadata && user.user_metadata.full_name) || (user.email ? user.email.split('@')[0] : email),
            name: (user.user_metadata && user.user_metadata.full_name) || (user.email ? user.email.split('@')[0] : 'User'),
            role: (user.user_metadata && user.user_metadata.role) || 'employee',
            permissions: (user.user_metadata && user.user_metadata.permissions) || '*',
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600)),
            supabase_user: user
          };
          
          try {
            nativeLocalStorage.setItem('vf_session', JSON.stringify(sessionPayload));
            nativeLocalStorage.setItem('vf_user_name', sessionPayload.username);
            nativeLocalStorage.setItem('vf_supabase_token', data.access_token);
            nativeLocalStorage.setItem('vf_supabase_session', JSON.stringify(data));
          } catch(e) {}
          
          cache['vf_session'] = JSON.stringify(sessionPayload);
          cache['vf_user_name'] = sessionPayload.username;

          this.logAuditTrail('login', 'auth', user.id || email, { email, role: sessionPayload.role });
        }
        
        return { data: data, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    },
    async refreshToken() {
      try {
        let session = null;
        try {
          const raw = nativeLocalStorage.getItem('vf_supabase_session');
          if (raw) session = JSON.parse(raw);
        } catch(e) {}
        if (!session || !session.refresh_token || !SUPABASE_URL) return null;
        
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.access_token) {
            nativeLocalStorage.setItem('vf_supabase_token', data.access_token);
            nativeLocalStorage.setItem('vf_supabase_session', JSON.stringify(data));
            return data.access_token;
          }
        }
      } catch(e) {}
      return null;
    },
    async signOut() {
      try {
        let token = null;
        try { token = nativeLocalStorage.getItem('vf_supabase_token'); } catch(e) {}
        if (token && SUPABASE_URL) {
          fetch(`${SUPABASE_URL}/auth/v1/logout`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${token}`
            }
          }).catch(() => {});
        }
      } catch(e) {}
      
      this.logAuditTrail('logout', 'auth', null, {});

      try {
        nativeLocalStorage.removeItem('vf_session');
        nativeLocalStorage.removeItem('vf_user_name');
        nativeLocalStorage.removeItem('vf_supabase_token');
        nativeLocalStorage.removeItem('vf_supabase_session');
      } catch(e) {}
      
      delete cache['vf_session'];
      delete cache['vf_user_name'];
      return { error: null };
    },
    async getUser(accessToken) {
      try {
        const token = accessToken || nativeLocalStorage.getItem('vf_supabase_token');
        if (!token) return { data: { user: null }, error: new Error('No active token') };
        
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (!res.ok) return { data: { user: null }, error: new Error(data.message || 'Failed to fetch user') };
        return { data: { user: data }, error: null };
      } catch (e) {
        return { data: { user: null }, error: e };
      }
    },
    getSession() {
      try {
        const sessRaw = nativeLocalStorage.getItem('vf_session');
        return sessRaw ? JSON.parse(sessRaw) : null;
      } catch(e) {
        return null;
      }
    },
    // --- Enterprise Audit Logging API ---
    async logAuditTrail(action, entityType, entityId = null, details = {}) {
      if (!activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        const userInfo = getLocalUserInfo();
        const payload = {
          user_id: userInfo.userId || null,
          user_email: userInfo.email || userInfo.name || 'operator',
          role: userInfo.role || 'employee',
          action: action,
          entity_type: entityType,
          entity_id: entityId ? String(entityId) : null,
          details: details || {},
          created_at: new Date().toISOString()
        };
        fetch(`${SUPABASE_URL}/rest/v1/vf_audit_logs`, {
          method: 'POST',
          headers: this.getAuthHeaders({ 'Prefer': 'return=minimal' }),
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch(e) {}
    },
    async getAuditLogs(options = {}) {
      if (!activeConfig.isConfigured || !SUPABASE_URL) return { data: [], error: 'Not configured' };
      const limit = options.limit || 50;
      let url = `${SUPABASE_URL}/rest/v1/vf_audit_logs?select=*&order=created_at.desc&limit=${limit}`;
      if (options.entityType) url += `&entity_type=eq.${encodeURIComponent(options.entityType)}`;
      if (options.userEmail) url += `&user_email=eq.${encodeURIComponent(options.userEmail)}`;
      try {
        const res = await fetch(url, { headers: this.getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          return { data: data || [], error: null };
        }
        return { data: [], error: `HTTP ${res.status}` };
      } catch(e) {
        return { data: [], error: e.message || String(e) };
      }
    },
    // --- Server-Side RPC Health Check API ---
    async ping() {
      if (!activeConfig.isConfigured || !SUPABASE_URL) {
        return { ok: false, error: 'Database not configured' };
      }
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_ping`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({})
        });
        const elapsed = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const latency = Math.round(elapsed - t0);
        if (res.ok) {
          const data = await res.json();
          return { ok: true, latencyMs: latency, serverData: data };
        } else {
          // Fallback ping query if RPC not yet deployed
          const fallbackRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?select=key&limit=1`, {
            headers: this.getAuthHeaders()
          });
          const fallbackLatency = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
          return { ok: fallbackRes.ok, latencyMs: fallbackLatency, fallback: true };
        }
      } catch(e) {
        return { ok: false, error: e.message || String(e) };
      }
    },
    // Dynamic Configuration & Diagnostic APIs
    getConfig: () => ({
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      isConfigured: activeConfig.isConfigured,
      source: activeConfig.source
    }),
    async testConnection(testUrl, testKey) {
      const url = (testUrl || SUPABASE_URL || '').replace(/\/+$/, '');
      const key = testKey || SUPABASE_ANON_KEY || '';
      if (!url || !key) {
        return { ok: false, message: 'URL and Anon Key are required.' };
      }
      try {
        const cleanHost = url.replace(/^https?:\/\//i, '');
        const res = await fetch(`${url}/rest/v1/vf_kv_store?select=key&limit=1`, {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        });
        if (res.ok) {
          return { ok: true, message: 'Connected successfully to Supabase!' };
        } else {
          const err = await res.json().catch(() => ({}));
          return { ok: false, message: err.message || `Server returned error ${res.status}: ${res.statusText}` };
        }
      } catch (e) {
        return { ok: false, message: `Connection failed: ${e.message || e}` };
      }
    },
    async configure({ url, anonKey, saveToStorage = true }) {
      if (saveToStorage) {
        try {
          if (url && anonKey) {
            nativeLocalStorage.setItem('vf_supabase_url', url.trim());
            nativeLocalStorage.setItem('vf_supabase_anon_key', anonKey.trim());
          } else {
            nativeLocalStorage.removeItem('vf_supabase_url');
            nativeLocalStorage.removeItem('vf_supabase_anon_key');
          }
        } catch(e) {}
      }

      activeConfig = resolveConfig();
      if (url && anonKey && !saveToStorage) {
        activeConfig = {
          url: url.trim().replace(/\/+$/, ''),
          anonKey: anonKey.trim(),
          isConfigured: true,
          source: 'direct'
        };
      }
      SUPABASE_URL = activeConfig.url;
      SUPABASE_ANON_KEY = activeConfig.anonKey;

      if (ws) {
        try { ws.close(); } catch(e) {}
        ws = null;
      }
      clearInterval(wsHeartbeatTimer);
      clearTimeout(wsReconnectTimer);

      if (activeConfig.isConfigured) {
        setSyncStatus('connecting');
        initRealtimeWebSocket();
        await this.loadAll(true);
      } else {
        setSyncStatus('unconfigured');
      }

      return activeConfig;
    },
    resetConfig() {
      try {
        nativeLocalStorage.removeItem('vf_supabase_url');
        nativeLocalStorage.removeItem('vf_supabase_anon_key');
      } catch(e) {}
      return this.configure({ url: null, anonKey: null, saveToStorage: false });
    },
    // --- Cloud-First Hydration & Intelligent Item Merge Engine ---
    async loadAll(isInitial = false) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        isHydrated = true;
        setSyncStatus('unconfigured');
        window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { isReady: true, keys: [] } }));
        return;
      }
      let updatedKeys = [];
      let hasChanges = false;
      try {
        if (isInitial || Object.keys(lastKnownTimestamps).length === 0) {
          const rows = await fetchAllRowsPaginated('vf_kv_store', 'key,value,updated_at');
          if (Array.isArray(rows)) {
            const kvMap = {};

            rows.forEach(row => {
              if (!row || !row.key || isLocalOnlyKey(row.key)) return;
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                kvMap[row.key] = row.value;

                const localVal = cache[row.key] || nativeLocalStorage.getItem(row.key);
                const finalMerged = mergeDatasets(row.key, localVal, strValue);
                const finalStr = typeof finalMerged === 'string' ? finalMerged : JSON.stringify(finalMerged);

                lastSavedHashes[row.key] = computeHash(finalStr);

                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) {
                  pendingRemoteUpdates[row.key] = finalStr;
                  return;
                }

                if (cache[row.key] !== finalStr || isInitial) {
                  cache[row.key] = finalStr;
                  safeLocalStorageSet(row.key, finalStr);
                  updatedKeys.push(row.key);
                  hasChanges = true;

                  if (finalStr !== strValue && activeConfig.isConfigured) {
                    let parsed = finalStr;
                    try { parsed = JSON.parse(finalStr); } catch(e) {}
                    supabaseApi.set(row.key, parsed);
                  }
                }
              } catch (e) {
                cache[row.key] = String(row.value);
              }
            });

            // Reconcile Dedicated Costing Tables for complete data safety (Paginated)
            try {
              const costingTableDefs = [
                { key: 'costing-products-v4', table: 'vf_costing_products' },
                { key: 'costing-tfo-products-v1', table: 'vf_costing_tfo_products' },
                { key: 'costing-doubler-products-v1', table: 'vf_costing_doubler_products' },
                { key: 'costing-covering-products-v1', table: 'vf_costing_covering_products' }
              ];

              let deletedCostingIds = [];
              try {
                const delRow = kvMap['vf_deleted_costing_ids'];
                if (delRow) {
                  deletedCostingIds = typeof delRow === 'string' ? JSON.parse(delRow) : delRow;
                }
              } catch (e) {}
              deletedCostingIds = Array.isArray(deletedCostingIds) ? deletedCostingIds.map(String) : [];

              for (const { key, table } of costingTableDefs) {
                const tblRows = await fetchAllRowsPaginated(table, 'id,data,updated_at');

                if (Array.isArray(tblRows) && tblRows.length > 0) {
                  let currentKvArray = [];
                  try {
                    const existing = kvMap[key];
                    if (existing) currentKvArray = typeof existing === 'string' ? JSON.parse(existing) : existing;
                  } catch(e) {}

                  const mergedMap = new Map();
                  // Load table items (authoritative server items)
                  tblRows.forEach(r => {
                    const idStr = String(r.data?.id || r.id);
                    if (r.data && !deletedCostingIds.includes(idStr)) {
                      mergedMap.set(idStr, r.data);
                    }
                  });
                  // Merge cloud kvMap items only if not deleted and not in table
                  if (Array.isArray(currentKvArray)) {
                    currentKvArray.forEach(item => {
                      if (item && item.id) {
                        const idStr = String(item.id);
                        if (!deletedCostingIds.includes(idStr) && !mergedMap.has(idStr)) {
                          mergedMap.set(idStr, item);
                        }
                      }
                    });
                  }
                  // Retain locally cached items if they are not tombstoned
                  try {
                    const localRaw = cache[key] || nativeLocalStorage.getItem(key);
                    if (localRaw) {
                      const localArr = JSON.parse(localRaw);
                      if (Array.isArray(localArr)) {
                        localArr.forEach(item => {
                          if (item && item.id) {
                            const idStr = String(item.id);
                            if (!deletedCostingIds.includes(idStr) && !mergedMap.has(idStr)) {
                              mergedMap.set(idStr, item);
                            }
                          }
                        });
                      }
                    }
                  } catch(e) {}

                  const mergedList = Array.from(mergedMap.values());
                  const mergedStr = JSON.stringify(mergedList);

                  const lastTableWrite = lastLocalWrites[key] || 0;
                  if (Date.now() - lastTableWrite >= 3000 && mergedList.length > 0) {
                    cache[key] = mergedStr;
                    lastSavedHashes[key] = computeHash(mergedStr);
                    try { nativeLocalStorage.setItem(key, mergedStr); } catch(e) {}
                    if (!updatedKeys.includes(key)) updatedKeys.push(key);
                    hasChanges = true;
                  }
                }
              }
            } catch (err) {
              console.warn('Dedicated tables reconciliation notice:', err);
            }

            // Reconcile Dedicated Yarn RM Relational Tables for enterprise data integrity
            try {
              const yarnLots = await fetchAllRowsPaginated('vf_yarn_rm_lots', '*', 'order=receive_date.desc');
              const yarnBoxes = await fetchAllRowsPaginated('vf_yarn_rm_boxes', '*', 'order=box_number.asc');

              if (Array.isArray(yarnLots) && yarnLots.length > 0) {
                const boxesByLot = new Map();
                (yarnBoxes || []).forEach(b => {
                  if (!boxesByLot.has(b.lot_id)) boxesByLot.set(b.lot_id, []);
                  boxesByLot.get(b.lot_id).push({
                    id: b.box_number || b.id,
                    boxNumber: b.box_number,
                    cones: b.cones || 0,
                    grossWeight: Number(b.gross_weight) || 0,
                    remainingWeight: Number(b.remaining_weight) || 0,
                    weight: Number(b.active_weight) || 0,
                    status: b.status || 'available',
                    issueDate: b.issue_date || null,
                    issuedTo: b.issued_to || null,
                    grDate: b.gr_date || null,
                    grWeight: Number(b.gr_weight) || 0,
                    grRemarks: b.gr_remarks || null
                  });
                });

                const reconstructedStock = yarnLots.map(l => ({
                  id: l.id,
                  batchId: l.batch_id || '',
                  lotNumber: l.lot_number,
                  challanNo: l.challan_number || '',
                  challanNumber: l.challan_number || '',
                  receiveDate: l.receive_date,
                  date: l.receive_date,
                  supplier: l.supplier,
                  quality: l.quality,
                  itemType: l.item_type || 'Polyester',
                  code: l.code || '',
                  color: l.color || '',
                  rate: Number(l.rate) || 0,
                  orderRef: l.order_ref || '',
                  notes: l.notes || '',
                  boxes: boxesByLot.get(l.id) || []
                }));

                const yKey = 'vishwa_yarn_rm_stock_data';
                const yStr = JSON.stringify(reconstructedStock);
                const lastYarnWrite = lastLocalWrites[yKey] || 0;
                if (Date.now() - lastYarnWrite >= 3000) {
                  cache[yKey] = yStr;
                  lastSavedHashes[yKey] = computeHash(yStr);
                  safeLocalStorageSet(yKey, yStr);
                  if (!updatedKeys.includes(yKey)) updatedKeys.push(yKey);
                  hasChanges = true;
                }
              }
            } catch (yarnErr) {
              console.warn('Yarn RM relational reconciliation notice:', yarnErr);
            }

            // Reconcile Dedicated Yarn RM Orders Relational Tables
            try {
              const dbOrders = await fetchAllRowsPaginated('vf_yarn_orders', '*', 'order=order_date.desc');
              const dbBatches = await fetchAllRowsPaginated('vf_yarn_order_batches', '*', 'order=receive_date.desc');
              const dbBoxes = await fetchAllRowsPaginated('vf_yarn_order_boxes', '*', 'order=box_number.asc');

              if (Array.isArray(dbOrders) && dbOrders.length > 0) {
                const boxesByBatch = new Map();
                (dbBoxes || []).forEach(bx => {
                  if (!boxesByBatch.has(bx.batch_id)) boxesByBatch.set(bx.batch_id, []);
                  boxesByBatch.get(bx.batch_id).push({
                    boxNumber: bx.box_number,
                    weight: Number(bx.weight) || 0,
                    cones: bx.cones || 0,
                    returnedWeight: Number(bx.returned_weight) || 0,
                    returnedDate: bx.returned_date || null,
                    returnReason: bx.return_reason || null
                  });
                });

                const batchesByOrder = new Map();
                (dbBatches || []).forEach(b => {
                  if (!batchesByOrder.has(b.order_id)) batchesByOrder.set(b.order_id, []);
                  batchesByOrder.get(b.order_id).push({
                    id: b.id,
                    challanNumber: b.challan_number || '',
                    lotNumber: b.lot_number || '',
                    receiveDate: b.receive_date || '',
                    totalWeight: Number(b.total_weight) || 0,
                    notes: b.notes || '',
                    boxes: boxesByBatch.get(b.id) || []
                  });
                });

                const reconstructedOrders = dbOrders.map(o => ({
                  id: o.id,
                  orderNumber: o.order_number,
                  orderDate: o.order_date,
                  supplier: o.supplier,
                  category: o.category || 'Polyester',
                  type: o.category || 'Polyester',
                  quality: o.quality,
                  code: o.code || '',
                  color: o.color || '',
                  orderedWeight: Number(o.ordered_weight) || 0,
                  price: Number(o.price) || 0,
                  status: o.status || 'Active',
                  remarks: o.remarks || '',
                  batches: batchesByOrder.get(o.id) || []
                }));

                const oKey = 'yarn-rm-orders';
                const oStr = JSON.stringify(reconstructedOrders);
                const lastOrderWrite = lastLocalWrites[oKey] || 0;
                if (Date.now() - lastOrderWrite >= 3000) {
                  cache[oKey] = oStr;
                  lastSavedHashes[oKey] = computeHash(oStr);
                  safeLocalStorageSet(oKey, oStr);
                  if (!updatedKeys.includes(oKey)) updatedKeys.push(oKey);
                  hasChanges = true;
                }
              }
            } catch (orderErr) {
              console.warn('Yarn RM Orders relational reconciliation notice:', orderErr);
            }

            // Reconcile Dedicated Weft Issues Relational Table
            try {
              const dbIssues = await fetchAllRowsPaginated('vf_weft_issues', '*', 'order=date.desc');
              if (Array.isArray(dbIssues) && dbIssues.length > 0) {
                const reconstructedIssues = dbIssues.map(iss => ({
                  id: iss.id,
                  date: iss.date,
                  quality: iss.quality,
                  supplier: iss.supplier,
                  code: iss.code || '',
                  color: iss.color || '',
                  box: iss.box,
                  challan: iss.challan || '',
                  lot: iss.lot || '',
                  cones: Number(iss.cones) || 0,
                  net: Number(iss.net) || 0,
                  details: iss.details || ''
                }));

                const issKey = 'yarn-issues';
                const issStr = JSON.stringify(reconstructedIssues);
                const lastIssWrite = lastLocalWrites[issKey] || 0;
                if (Date.now() - lastIssWrite >= 3000) {
                  cache[issKey] = issStr;
                  lastSavedHashes[issKey] = computeHash(issStr);
                  safeLocalStorageSet(issKey, issStr);
                  if (!updatedKeys.includes(issKey)) updatedKeys.push(issKey);
                  hasChanges = true;
                }
              }
            } catch (issErr) {
              console.warn('Weft Issues relational reconciliation notice:', issErr);
            }

            // Reconcile Dedicated Warp Beams Relational Table
            try {
              const dbBeams = await fetchAllRowsPaginated('vf_warp_beams', '*', 'order=created_at.desc');
              if (Array.isArray(dbBeams) && dbBeams.length > 0) {
                const reconstructedBeams = dbBeams.map(b => ({
                  id: b.id,
                  beamNumber: b.beam_number,
                  quality: b.quality,
                  code: b.code || '',
                  color: b.color || '',
                  meters: Number(b.meters) || 0,
                  ends: b.ends || 0,
                  status: b.status || 'Available',
                  machineNumber: b.machine_number || null,
                  warpingPerson: b.warping_person || '',
                  createdAt: b.created_at,
                  history: Array.isArray(b.history) ? b.history : []
                }));

                const bKey = 'warp-beams';
                const bStr = JSON.stringify(reconstructedBeams);
                const lastBWrite = lastLocalWrites[bKey] || 0;
                if (Date.now() - lastBWrite >= 3000) {
                  cache[bKey] = bStr;
                  lastSavedHashes[bKey] = computeHash(bStr);
                  safeLocalStorageSet(bKey, bStr);
                  if (!updatedKeys.includes(bKey)) updatedKeys.push(bKey);
                  hasChanges = true;
                }
              }
            } catch (bErr) {
              console.warn('Warp Beams relational reconciliation notice:', bErr);
            }

            // Reconcile Dedicated Warp Issues Relational Table
            try {
              const dbWarpIssues = await fetchAllRowsPaginated('vf_warp_issues', '*', 'order=date.desc');
              if (Array.isArray(dbWarpIssues) && dbWarpIssues.length > 0) {
                const reconstructedWarpIssues = dbWarpIssues.map(iss => ({
                  id: iss.id,
                  date: iss.date,
                  quality: iss.quality,
                  code: iss.code || '',
                  color: iss.color || '',
                  issuedWeight: Number(iss.issued_weight) || 0,
                  details: iss.details || '',
                  supplier: iss.supplier || ''
                }));

                const wiKey = 'warp-issues';
                const wiStr = JSON.stringify(reconstructedWarpIssues);
                const lastWiWrite = lastLocalWrites[wiKey] || 0;
                if (Date.now() - lastWiWrite >= 3000) {
                  cache[wiKey] = wiStr;
                  lastSavedHashes[wiKey] = computeHash(wiStr);
                  safeLocalStorageSet(wiKey, wiStr);
                  if (!updatedKeys.includes(wiKey)) updatedKeys.push(wiKey);
                  hasChanges = true;
                }
              }
            } catch (wiErr) {
              console.warn('Warp Issues relational reconciliation notice:', wiErr);
            }

            // Reconcile Dedicated Warp Beam Loadings Relational Table
            try {
              const dbLoadings = await fetchAllRowsPaginated('vf_warp_beam_loadings', '*', 'order=date.desc');
              if (Array.isArray(dbLoadings) && dbLoadings.length > 0) {
                const reconstructedLoadings = dbLoadings.map(bl => ({
                  id: bl.id,
                  date: bl.date,
                  piecein: bl.piecein || '',
                  drawingIn: bl.drawing_in || '',
                  fani: bl.fani || '',
                  dropPinJog: bl.drop_pin_jog || '',
                  machineNumber: bl.machine_number || '',
                  beamNumber: bl.beam_number || '',
                  itemColor: bl.item_color || '',
                  meters: Number(bl.meters) || 0,
                  ends: bl.ends || 0,
                  rate: Number(bl.rate) || 0,
                  paymentAmount: Number(bl.payment_amount) || 0
                }));

                const blKey = 'warp-beam-loadings';
                const blStr = JSON.stringify(reconstructedLoadings);
                const lastBlWrite = lastLocalWrites[blKey] || 0;
                if (Date.now() - lastBlWrite >= 3000) {
                  cache[blKey] = blStr;
                  lastSavedHashes[blKey] = computeHash(blStr);
                  safeLocalStorageSet(blKey, blStr);
                  if (!updatedKeys.includes(blKey)) updatedKeys.push(blKey);
                  hasChanges = true;
                }
              }
            } catch (blErr) {
              console.warn('Warp Beam Loadings relational reconciliation notice:', blErr);
            }

            // Reconcile Dedicated Weaving Production Logs Relational Table
            try {
              const dbWeavLogs = await fetchAllRowsPaginated('vf_weaving_production_logs', '*', 'order=production_date.desc');
              if (Array.isArray(dbWeavLogs) && dbWeavLogs.length > 0) {
                const reconstructedWeavLogs = dbWeavLogs.map(l => ({
                  id: isNaN(Number(l.id)) ? l.id : Number(l.id),
                  productionDate: l.production_date,
                  machineNumber: l.machine_number,
                  beamNumber: l.beam_number || '',
                  secondaryBeamNumber: l.secondary_beam_number || '',
                  pissingDate: l.pissing_date || '',
                  pissingPerson: l.pissing_person || '',
                  dayWorker: l.day_worker || '',
                  dayShiftHours: Number(l.day_shift_hours) || 0,
                  dayMeters: Number(l.day_meters) || 0,
                  nightWorker: l.night_worker || '',
                  nightShiftHours: Number(l.night_shift_hours) || 0,
                  nightMeters: Number(l.night_meters) || 0,
                  picks: Number(l.picks) || 0,
                  product: l.product || '',
                  totalMeters: Number(l.total_meters) || 0,
                  takaSerial: l.taka_serial || null,
                  foldingDate: l.folding_date || null,
                  takaWeight: l.taka_weight !== null ? Number(l.taka_weight) : null,
                  takaAssignId: l.taka_assign_id || null,
                  isTpRoll: Boolean(l.is_tp_roll),
                  tpSourceSerials: Array.isArray(l.tp_source_serials) ? l.tp_source_serials : []
                }));

                const weavKey = 'productionLogs';
                const weavStr = JSON.stringify(reconstructedWeavLogs);
                const lastWeavWrite = lastLocalWrites[weavKey] || 0;
                if (Date.now() - lastWeavWrite >= 3000) {
                  cache[weavKey] = weavStr;
                  lastSavedHashes[weavKey] = computeHash(weavStr);
                  safeLocalStorageSet(weavKey, weavStr);
                  if (!updatedKeys.includes(weavKey)) updatedKeys.push(weavKey);
                  hasChanges = true;
                }
              }
            } catch (weavErr) {
              console.warn('Weaving Production relational reconciliation notice:', weavErr);
            }

            // Reconcile Dedicated Yarn Production Logs Relational Table
            try {
              const dbYarnProd = await fetchAllRowsPaginated('vf_yarn_production_logs', '*', 'order=date.desc');
              if (Array.isArray(dbYarnProd) && dbYarnProd.length > 0) {
                const divisions = ['covering', 'tfo', 'doubler'];
                divisions.forEach(div => {
                  const divRows = dbYarnProd.filter(r => (r.division || '').toLowerCase() === div);
                  if (divRows.length > 0) {
                    const reconstructed = divRows.map(yp => ({
                      id: yp.id,
                      date: yp.date,
                      boriNo: yp.bori_no,
                      productName: yp.product_name,
                      productId: yp.product_id || '',
                      lotNo: yp.lot_no || '',
                      color: yp.color || '',
                      denier: yp.denier !== null ? Number(yp.denier) : '',
                      tpm: yp.tpm !== null ? Number(yp.tpm) : '',
                      twist: yp.twist || '',
                      rolls: Number(yp.rolls) || 0,
                      qty: Number(yp.qty) || 0,
                      configType: yp.config_type || '',
                      ply: yp.ply || '',
                      yarns: Array.isArray(yp.yarns) ? yp.yarns : []
                    }));

                    const ypKey = `yarn_${div}_production_logs`;
                    const ypStr = JSON.stringify(reconstructed);
                    const lastYpWrite = lastLocalWrites[ypKey] || 0;
                    if (Date.now() - lastYpWrite >= 3000) {
                      cache[ypKey] = ypStr;
                      lastSavedHashes[ypKey] = computeHash(ypStr);
                      safeLocalStorageSet(ypKey, ypStr);
                      if (!updatedKeys.includes(ypKey)) updatedKeys.push(ypKey);
                      hasChanges = true;
                    }
                  }
                });
              }
            } catch (ypErr) {
              console.warn('Yarn Production relational reconciliation notice:', ypErr);
            }

            // Reconcile Dedicated Yarn Sales Logs Relational Table
            try {
              const dbYarnSales = await fetchAllRowsPaginated('vf_yarn_sales_logs', '*', 'order=sale_date.desc');
              if (Array.isArray(dbYarnSales) && dbYarnSales.length > 0) {
                const divisions = ['covering', 'tfo', 'doubler'];
                divisions.forEach(div => {
                  const divRows = dbYarnSales.filter(r => (r.division || '').toLowerCase() === div);
                  if (divRows.length > 0) {
                    const reconstructed = divRows.map(ys => ({
                      id: ys.id,
                      saleDate: ys.sale_date,
                      date: ys.sale_date,
                      challanNo: ys.challan_no || '',
                      customerName: ys.customer_name,
                      customer: ys.customer_name,
                      items: Array.isArray(ys.items) ? ys.items : [],
                      totalQty: Number(ys.total_qty) || 0,
                      saleQty: Number(ys.total_qty) || 0,
                      qty: Number(ys.total_qty) || 0,
                      totalAmount: Number(ys.total_amount) || 0,
                      amount: Number(ys.total_amount) || 0,
                      gstAmount: Number(ys.gst_amount) || 0,
                      gst: Number(ys.gst_amount) || 0
                    }));

                    const ysKey = `yarn_${div}_sales_logs`;
                    const ysStr = JSON.stringify(reconstructed);
                    const lastYsWrite = lastLocalWrites[ysKey] || 0;
                    if (Date.now() - lastYsWrite >= 3000) {
                      cache[ysKey] = ysStr;
                      lastSavedHashes[ysKey] = computeHash(ysStr);
                      safeLocalStorageSet(ysKey, ysStr);
                      if (!updatedKeys.includes(ysKey)) updatedKeys.push(ysKey);
                      hasChanges = true;
                    }
                  }
                });
              }
            } catch (ysErr) {
              console.warn('Yarn Sales relational reconciliation notice:', ysErr);
            }

            // Reconcile Dedicated Fabric Dispatches Relational Table
            try {
              const dbDispatches = await fetchAllRowsPaginated('vf_fabric_dispatches', '*', 'order=created_at.desc');
              if (Array.isArray(dbDispatches) && dbDispatches.length > 0) {
                const reconstructedStates = {};
                dbDispatches.forEach(d => {
                  if (!d.taka_serial) return;
                  reconstructedStates[d.taka_serial] = {
                    status: d.status || 'Warehouse',
                    currentStage: d.current_stage || 'Warehouse',
                    vendor: d.vendor || '',
                    customer: d.customer || '',
                    invoice: d.invoice_no || '',
                    challan: d.challan_no || '',
                    dispatchDate: d.dispatch_date || '',
                    rate: d.selling_rate !== null ? Number(d.selling_rate) : '',
                    isPartialPiece: Boolean(d.is_partial_piece),
                    history: Array.isArray(d.history) ? d.history : []
                  };
                });

                const dispKey = 'takaDispatchStates';
                const dispStr = JSON.stringify(reconstructedStates);
                const lastDispWrite = lastLocalWrites[dispKey] || 0;
                if (Date.now() - lastDispWrite >= 3000) {
                  cache[dispKey] = dispStr;
                  lastSavedHashes[dispKey] = computeHash(dispStr);
                  safeLocalStorageSet(dispKey, dispStr);
                  if (!updatedKeys.includes(dispKey)) updatedKeys.push(dispKey);
                  hasChanges = true;
                }
              }
            } catch (dispErr) {
              console.warn('Fabric Dispatches relational reconciliation notice:', dispErr);
            }

            // Reconcile Dedicated Fabric Cut Relations Relational Table
            try {
              const dbCuts = await fetchAllRowsPaginated('vf_fabric_cut_relations', '*', 'order=created_at.desc');
              if (Array.isArray(dbCuts) && dbCuts.length > 0) {
                const reconstructedCuts = {};
                dbCuts.forEach(c => {
                  if (!c.parent_serial) return;
                  if (c.metadata && typeof c.metadata === 'object' && Object.keys(c.metadata).length > 0) {
                    reconstructedCuts[c.parent_serial] = c.metadata;
                  } else {
                    reconstructedCuts[c.parent_serial] = Array.isArray(c.children) ? c.children : [];
                  }
                });

                const cutKey = 'takaCutRelations';
                const cutStr = JSON.stringify(reconstructedCuts);
                const lastCutWrite = lastLocalWrites[cutKey] || 0;
                if (Date.now() - lastCutWrite >= 3000) {
                  cache[cutKey] = cutStr;
                  lastSavedHashes[cutKey] = computeHash(cutStr);
                  safeLocalStorageSet(cutKey, cutStr);
                  if (!updatedKeys.includes(cutKey)) updatedKeys.push(cutKey);
                  hasChanges = true;
                }
              }
            } catch (cutErr) {
              console.warn('Fabric Cut Relations relational reconciliation notice:', cutErr);
            }

            // Reconcile Dedicated Salary Sheet & Staff Attendance Tables
            try {
              const [dbEmployees, dbAttendance, dbLoans, dbSettlements] = await Promise.all([
                fetchAllRowsPaginated('vf_employees', '*', 'order=name.asc'),
                fetchAllRowsPaginated('vf_attendance_records', '*', 'order=attendance_date.desc'),
                fetchAllRowsPaginated('vf_employee_loans', '*', 'order=loan_date.desc'),
                fetchAllRowsPaginated('vf_salary_settlements', '*', 'order=month_year.desc')
              ]);

              if (Array.isArray(dbEmployees) && dbEmployees.length > 0) {
                const staffKey = 'aethertasks_db_state_v7';
                let existingStaffState = {};
                try {
                  const rawStaff = cache[staffKey] || nativeLocalStorage.getItem(staffKey);
                  if (rawStaff) existingStaffState = JSON.parse(rawStaff);
                } catch(e) {}

                const reconstructedEmployees = dbEmployees.map(emp => ({
                  id: emp.id,
                  name: emp.name,
                  role: emp.role,
                  department: emp.department || '',
                  salaryStyle: emp.salary_style || 'Per Day Fixed',
                  salaryRate: Number(emp.salary_rate) || 0,
                  baseSalary: Number(emp.base_salary) || 0,
                  phone: emp.phone || '',
                  email: emp.email || '',
                  joiningDate: emp.joining_date || '',
                  assignedMachines: Array.isArray(emp.assigned_machines) ? emp.assigned_machines : [],
                  avatarGradient: emp.avatar_gradient || '',
                  active: emp.active !== false,
                  ...(emp.metadata && typeof emp.metadata === 'object' ? emp.metadata : {})
                }));

                const reconstructedAttendance = {};
                if (Array.isArray(dbAttendance)) {
                  dbAttendance.forEach(att => {
                    const date = att.attendance_date;
                    const empId = att.employee_id;
                    if (!date || !empId) return;
                    if (!reconstructedAttendance[date]) reconstructedAttendance[date] = {};
                    reconstructedAttendance[date][empId] = {
                      status: att.status || 'Present',
                      shift: att.shift || 'Day',
                      hours: Number(att.hours) || 0,
                      overtime: Number(att.overtime_hours) || 0,
                      meters: Number(att.meters) || 0,
                      rate: Number(att.rate) || 0,
                      earned: Number(att.total_earned) || 0,
                      notes: att.notes || '',
                      ...(att.metadata && typeof att.metadata === 'object' ? att.metadata : {})
                    };
                  });
                }

                const reconstructedLoans = Array.isArray(dbLoans) ? dbLoans.map(ln => ({
                  id: ln.id,
                  empId: ln.employee_id,
                  date: ln.loan_date,
                  amount: Number(ln.amount) || 0,
                  type: ln.type || 'Advance',
                  reason: ln.reason || '',
                  cleared: Boolean(ln.cleared)
                })) : [];

                const reconstructedSettlements = {};
                if (Array.isArray(dbSettlements)) {
                  dbSettlements.forEach(st => {
                    const m = st.month_year;
                    const empId = st.employee_id;
                    if (!m || !empId) return;
                    if (!reconstructedSettlements[m]) reconstructedSettlements[m] = {};
                    reconstructedSettlements[m][empId] = {
                      paidAmount: Number(st.paid_amount) || 0,
                      netPayable: Number(st.net_payable) || 0,
                      paidDate: st.paid_date || '',
                      paymentMode: st.payment_mode || '',
                      status: st.status || 'Paid',
                      ...(st.details && typeof st.details === 'object' ? st.details : {})
                    };
                  });
                }

                const mergedStaffState = {
                  ...existingStaffState,
                  employees: reconstructedEmployees,
                  attendance: reconstructedAttendance,
                  loans: reconstructedLoans,
                  salaryPayments: reconstructedSettlements
                };

                const staffStr = JSON.stringify(mergedStaffState);
                const lastStaffWrite = lastLocalWrites[staffKey] || 0;
                if (Date.now() - lastStaffWrite >= 3000) {
                  cache[staffKey] = staffStr;
                  lastSavedHashes[staffKey] = computeHash(staffStr);
                  safeLocalStorageSet(staffKey, staffStr);
                  if (!updatedKeys.includes(staffKey)) updatedKeys.push(staffKey);
                  hasChanges = true;
                }
              }
            } catch (staffErr) {
              console.warn('Salary Sheet relational reconciliation notice:', staffErr);
            }

            isHydrated = true;
            window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { isReady: true, keys: updatedKeys } }));

            if (hasChanges || isInitial) {
              window.dispatchEvent(new Event('storage'));
              updatedKeys.forEach(k => {
                window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: cache[k], isRemote: true } }));
                try {
                  window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: cache[k] }));
                } catch(e) {}
              });
            }
          }
          return;
        }

        // Lightweight Polling: Fetch metadata with pagination for complete coverage
        updatedKeys = [];
        hasChanges = false;
        const metaRows = await fetchAllRowsPaginated('vf_kv_store', 'key,updated_at');
        if (!Array.isArray(metaRows) || metaRows.length === 0) return;

        // Identify keys that have actually changed on the server (excluding local session keys)
        const changedKeys = [];
        metaRows.forEach(row => {
          if (!row || !row.key || isLocalOnlyKey(row.key)) return;
          const lastWrite = lastLocalWrites[row.key] || 0;
          const knownTs = lastKnownTimestamps[row.key];
          if (!knownTs || !row.updated_at || row.updated_at !== knownTs || !cache.hasOwnProperty(row.key)) {
            if (Date.now() - lastWrite >= 3000) {
              changedKeys.push(row.key);
            }
          }
        });

        if (changedKeys.length === 0) return; // Zero network payload downloaded if nothing changed!

        // Fetch values in chunks of 50 keys to prevent URL overflow
        const chunkSize = 50;

        for (let i = 0; i < changedKeys.length; i += chunkSize) {
          const chunk = changedKeys.slice(i, i + chunkSize);
          const encodedKeys = chunk.map(k => `"${encodeURIComponent(k)}"`).join(',');
          const valRes = await fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=in.(${encodedKeys})&select=key,value,updated_at`, {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          });
          if (valRes.ok) {
            const rows = await valRes.json();
            rows.forEach(row => {
              if (!row || !row.key || isLocalOnlyKey(row.key)) return;
              try {
                if (row.updated_at) lastKnownTimestamps[row.key] = row.updated_at;
                const strValue = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                const localVal = cache[row.key] || nativeLocalStorage.getItem(row.key);
                const finalMerged = mergeDatasets(row.key, localVal, strValue);
                const finalStr = typeof finalMerged === 'string' ? finalMerged : JSON.stringify(finalMerged);

                lastSavedHashes[row.key] = computeHash(finalStr);

                const lastWrite = lastLocalWrites[row.key] || 0;
                if (Date.now() - lastWrite < 3000) {
                  pendingRemoteUpdates[row.key] = finalStr;
                  return;
                }

                if (cache[row.key] !== finalStr) {
                  cache[row.key] = finalStr;
                  safeLocalStorageSet(row.key, finalStr);
                  updatedKeys.push(row.key);
                  hasChanges = true;

                  if (finalStr !== strValue && activeConfig.isConfigured) {
                    let parsed = finalStr;
                    try { parsed = JSON.parse(finalStr); } catch(e) {}
                    supabaseApi.set(row.key, parsed);
                  }
                }
              } catch (e) {
                cache[row.key] = String(row.value);
              }
            });
          }
        }

        if (hasChanges) {
          window.dispatchEvent(new Event('storage'));
          updatedKeys.forEach(k => {
            window.dispatchEvent(new CustomEvent('supabase-sync', { detail: { key: k, value: cache[k], isRemote: true } }));
            try {
              window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: cache[k] }));
            } catch(e) {}
          });
        }
      } catch (e) {
        console.error('Supabase loadAll failed:', e);
      } finally {
        isHydrated = true;
        window.dispatchEvent(new CustomEvent('supabase-ready', { detail: { isReady: true, keys: updatedKeys } }));
      }
    },
    // --- Enterprise Warp Beams Relational APIs ---
    async fetchWarpBeamsRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_warp_beams', '*', 'order=created_at.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(b => ({
          id: b.id,
          beamNumber: b.beam_number,
          quality: b.quality,
          code: b.code || '',
          color: b.color || '',
          meters: Number(b.meters) || 0,
          ends: b.ends || 0,
          status: b.status || 'Available',
          machineNumber: b.machine_number || null,
          warpingPerson: b.warping_person || '',
          createdAt: b.created_at,
          history: Array.isArray(b.history) ? b.history : []
        }));
      } catch(e) {
        console.error('fetchWarpBeamsRelational error:', e);
        return null;
      }
    },

    async saveWarpBeamRelational(beam) {
      if (!beam || !beam.beamNumber || !activeConfig.isConfigured || !SUPABASE_URL) return;
      const bId = String(beam.id || `BEAM-${beam.beamNumber}`);
      const bCreated = (beam.createdAt || new Date().toISOString().split('T')[0]).split('T')[0];
      const payload = {
        id: bId,
        beam_number: String(beam.beamNumber).trim(),
        quality: String(beam.quality || ''),
        code: beam.code ? String(beam.code) : null,
        color: beam.color ? String(beam.color) : null,
        meters: parseFloat(beam.meters) || 0,
        ends: parseInt(beam.ends, 10) || 0,
        status: String(beam.status || 'Available'),
        machine_number: beam.machineNumber ? String(beam.machineNumber) : null,
        warping_person: beam.warpingPerson || null,
        created_at: bCreated,
        history: Array.isArray(beam.history) ? beam.history : [],
        updated_at: new Date().toISOString()
      };
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beams?on_conflict=id`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(payload)
        });
      } catch(e) {}
    },

    async deleteWarpBeamRelational(beamId) {
      if (!beamId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beams?id=eq.${encodeURIComponent(beamId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchWarpIssuesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_warp_issues', '*', 'order=date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(iss => ({
          id: iss.id,
          date: iss.date,
          quality: iss.quality,
          code: iss.code || '',
          color: iss.color || '',
          issuedWeight: Number(iss.issued_weight) || 0,
          details: iss.details || '',
          supplier: iss.supplier || ''
        }));
      } catch(e) {
        console.error('fetchWarpIssuesRelational error:', e);
        return null;
      }
    },

    async deleteWarpIssueRelational(issueId) {
      if (!issueId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_issues?id=eq.${encodeURIComponent(issueId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchWarpBeamLoadingsRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_warp_beam_loadings', '*', 'order=date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(bl => ({
          id: bl.id,
          date: bl.date,
          piecein: bl.piecein || '',
          drawingIn: bl.drawing_in || '',
          fani: bl.fani || '',
          dropPinJog: bl.drop_pin_jog || '',
          machineNumber: bl.machine_number || '',
          beamNumber: bl.beam_number || '',
          itemColor: bl.item_color || '',
          meters: Number(bl.meters) || 0,
          ends: bl.ends || 0,
          rate: Number(bl.rate) || 0,
          paymentAmount: Number(bl.payment_amount) || 0
        }));
      } catch(e) {
        console.error('fetchWarpBeamLoadingsRelational error:', e);
        return null;
      }
    },

    async deleteWarpBeamLoadingRelational(loadingId) {
      if (!loadingId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_warp_beam_loadings?id=eq.${encodeURIComponent(loadingId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Weft Issues Relational APIs ---
    async fetchWeftIssuesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_weft_issues', '*', 'order=date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(iss => ({
          id: iss.id,
          date: iss.date,
          quality: iss.quality,
          supplier: iss.supplier,
          code: iss.code || '',
          color: iss.color || '',
          box: iss.box,
          challan: iss.challan || '',
          lot: iss.lot || '',
          cones: Number(iss.cones) || 0,
          net: Number(iss.net) || 0,
          details: iss.details || ''
        }));
      } catch(e) {
        console.error('fetchWeftIssuesRelational error:', e);
        return null;
      }
    },

    async recordWeftIssuesAtomic(issueList) {
      if (!Array.isArray(issueList) || issueList.length === 0) return { success: false, error: 'No issues to record' };
      if (activeConfig.isConfigured && SUPABASE_URL) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_record_weft_issues`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ p_issues: issueList })
          });
          if (res.ok) {
            return await res.json();
          }
        } catch(e) {
          console.warn('RPC vf_record_weft_issues fallback to local write:', e);
        }
      }
      return { success: true, fallback: true };
    },

    async deleteWeftIssueRelational(issueId) {
      if (!issueId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_weft_issues?id=eq.${encodeURIComponent(issueId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Weaving Production Logs Relational APIs ---
    async fetchWeavingProductionRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_weaving_production_logs', '*', 'order=production_date.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(l => ({
          id: isNaN(Number(l.id)) ? l.id : Number(l.id),
          productionDate: l.production_date,
          machineNumber: l.machine_number,
          beamNumber: l.beam_number || '',
          secondaryBeamNumber: l.secondary_beam_number || '',
          pissingDate: l.pissing_date || '',
          pissingPerson: l.pissing_person || '',
          dayWorker: l.day_worker || '',
          dayShiftHours: Number(l.day_shift_hours) || 0,
          dayMeters: Number(l.day_meters) || 0,
          nightWorker: l.night_worker || '',
          nightShiftHours: Number(l.night_shift_hours) || 0,
          nightMeters: Number(l.night_meters) || 0,
          picks: Number(l.picks) || 0,
          product: l.product || '',
          totalMeters: Number(l.total_meters) || 0,
          takaSerial: l.taka_serial || null,
          foldingDate: l.folding_date || null,
          takaWeight: l.taka_weight !== null ? Number(l.taka_weight) : null,
          takaAssignId: l.taka_assign_id || null,
          isTpRoll: Boolean(l.is_tp_roll),
          tpSourceSerials: Array.isArray(l.tp_source_serials) ? l.tp_source_serials : []
        }));
      } catch(e) {
        console.error('fetchWeavingProductionRelational error:', e);
        return null;
      }
    },

    async deleteWeavingProductionLogRelational(logId) {
      if (!logId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_weaving_production_logs?id=eq.${encodeURIComponent(logId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Yarn Production & Sales Relational APIs ---
    async fetchYarnProductionRelational(division) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = division ? `division=eq.${encodeURIComponent(division)}&order=date.desc` : 'order=date.desc';
        const rows = await fetchAllRowsPaginated('vf_yarn_production_logs', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(yp => ({
          id: yp.id,
          division: yp.division,
          date: yp.date,
          boriNo: yp.bori_no,
          productName: yp.product_name,
          productId: yp.product_id || '',
          lotNo: yp.lot_no || '',
          color: yp.color || '',
          denier: yp.denier !== null ? Number(yp.denier) : '',
          tpm: yp.tpm !== null ? Number(yp.tpm) : '',
          twist: yp.twist || '',
          rolls: Number(yp.rolls) || 0,
          qty: Number(yp.qty) || 0,
          configType: yp.config_type || '',
          ply: yp.ply || '',
          yarns: Array.isArray(yp.yarns) ? yp.yarns : []
        }));
      } catch(e) {
        console.error('fetchYarnProductionRelational error:', e);
        return null;
      }
    },

    async deleteYarnProductionLogRelational(logId) {
      if (!logId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_production_logs?id=eq.${encodeURIComponent(logId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchYarnSalesRelational(division) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = division ? `division=eq.${encodeURIComponent(division)}&order=sale_date.desc` : 'order=sale_date.desc';
        const rows = await fetchAllRowsPaginated('vf_yarn_sales_logs', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(ys => ({
          id: ys.id,
          division: ys.division,
          saleDate: ys.sale_date,
          date: ys.sale_date,
          challanNo: ys.challan_no || '',
          customerName: ys.customer_name,
          customer: ys.customer_name,
          items: Array.isArray(ys.items) ? ys.items : [],
          totalQty: Number(ys.total_qty) || 0,
          saleQty: Number(ys.total_qty) || 0,
          qty: Number(ys.total_qty) || 0,
          totalAmount: Number(ys.total_amount) || 0,
          amount: Number(ys.total_amount) || 0,
          gstAmount: Number(ys.gst_amount) || 0,
          gst: Number(ys.gst_amount) || 0
        }));
      } catch(e) {
        console.error('fetchYarnSalesRelational error:', e);
        return null;
      }
    },

    async deleteYarnSaleLogRelational(saleId) {
      if (!saleId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_sales_logs?id=eq.${encodeURIComponent(saleId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Fabric Dispatches & Outsource Pipeline Relational APIs ---
    async fetchFabricDispatchesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_fabric_dispatches', '*', 'order=created_at.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(d => {
          if (!d.taka_serial) return;
          result[d.taka_serial] = {
            status: d.status || 'Warehouse',
            currentStage: d.current_stage || 'Warehouse',
            vendor: d.vendor || '',
            customer: d.customer || '',
            invoice: d.invoice_no || '',
            challan: d.challan_no || '',
            dispatchDate: d.dispatch_date || '',
            rate: d.selling_rate !== null ? Number(d.selling_rate) : '',
            isPartialPiece: Boolean(d.is_partial_piece),
            history: Array.isArray(d.history) ? d.history : []
          };
        });
        return result;
      } catch(e) {
        console.error('fetchFabricDispatchesRelational error:', e);
        return null;
      }
    },

    async deleteFabricDispatchRelational(takaSerial) {
      if (!takaSerial || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_dispatches?taka_serial=eq.${encodeURIComponent(takaSerial)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Fabric Cut Relations Relational APIs ---
    async fetchFabricCutRelationsRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_fabric_cut_relations', '*', 'order=created_at.desc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(c => {
          if (!c.parent_serial) return;
          if (c.metadata && typeof c.metadata === 'object' && Object.keys(c.metadata).length > 0) {
            result[c.parent_serial] = c.metadata;
          } else {
            result[c.parent_serial] = Array.isArray(c.children) ? c.children : [];
          }
        });
        return result;
      } catch(e) {
        console.error('fetchFabricCutRelationsRelational error:', e);
        return null;
      }
    },

    async deleteFabricCutRelationRelational(parentSerial) {
      if (!parentSerial || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_fabric_cut_relations?id=eq.${encodeURIComponent(parentSerial)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Staff, Attendance & Salary Sheet Relational APIs ---
    async fetchEmployeesRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const rows = await fetchAllRowsPaginated('vf_employees', '*', 'order=name.asc');
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(emp => ({
          id: emp.id,
          name: emp.name,
          role: emp.role,
          department: emp.department || '',
          salaryStyle: emp.salary_style || 'Per Day Fixed',
          salaryRate: Number(emp.salary_rate) || 0,
          baseSalary: Number(emp.base_salary) || 0,
          phone: emp.phone || '',
          email: emp.email || '',
          joiningDate: emp.joining_date || '',
          assignedMachines: Array.isArray(emp.assigned_machines) ? emp.assigned_machines : [],
          avatarGradient: emp.avatar_gradient || '',
          active: emp.active !== false,
          ...(emp.metadata && typeof emp.metadata === 'object' ? emp.metadata : {})
        }));
      } catch(e) {
        console.error('fetchEmployeesRelational error:', e);
        return null;
      }
    },

    async deleteEmployeeRelational(empId) {
      if (!empId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_employees?id=eq.${encodeURIComponent(empId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchAttendanceRelational(startDate, endDate) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        let query = 'order=attendance_date.desc';
        if (startDate && endDate) {
          query = `attendance_date=gte.${startDate}&attendance_date=lte.${endDate}&order=attendance_date.desc`;
        }
        const rows = await fetchAllRowsPaginated('vf_attendance_records', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(att => {
          const date = att.attendance_date;
          const empId = att.employee_id;
          if (!date || !empId) return;
          if (!result[date]) result[date] = {};
          result[date][empId] = {
            status: att.status || 'Present',
            shift: att.shift || 'Day',
            hours: Number(att.hours) || 0,
            overtime: Number(att.overtime_hours) || 0,
            meters: Number(att.meters) || 0,
            rate: Number(att.rate) || 0,
            earned: Number(att.total_earned) || 0,
            notes: att.notes || '',
            ...(att.metadata && typeof att.metadata === 'object' ? att.metadata : {})
          };
        });
        return result;
      } catch(e) {
        console.error('fetchAttendanceRelational error:', e);
        return null;
      }
    },

    async deleteAttendanceRecordRelational(recordId) {
      if (!recordId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_attendance_records?id=eq.${encodeURIComponent(recordId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchEmployeeLoansRelational(employeeId) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = employeeId ? `employee_id=eq.${encodeURIComponent(employeeId)}&order=loan_date.desc` : 'order=loan_date.desc';
        const rows = await fetchAllRowsPaginated('vf_employee_loans', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        return rows.map(ln => ({
          id: ln.id,
          empId: ln.employee_id,
          date: ln.loan_date,
          amount: Number(ln.amount) || 0,
          type: ln.type || 'Advance',
          reason: ln.reason || '',
          cleared: Boolean(ln.cleared)
        }));
      } catch(e) {
        console.error('fetchEmployeeLoansRelational error:', e);
        return null;
      }
    },

    async deleteEmployeeLoanRelational(loanId) {
      if (!loanId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_employee_loans?id=eq.${encodeURIComponent(loanId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchSalarySettlementsRelational(monthYear) {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const query = monthYear ? `month_year=eq.${encodeURIComponent(monthYear)}&order=created_at.desc` : 'order=month_year.desc';
        const rows = await fetchAllRowsPaginated('vf_salary_settlements', '*', query);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const result = {};
        rows.forEach(st => {
          const m = st.month_year;
          const empId = st.employee_id;
          if (!m || !empId) return;
          if (!result[m]) result[m] = {};
          result[m][empId] = {
            paidAmount: Number(st.paid_amount) || 0,
            netPayable: Number(st.net_payable) || 0,
            paidDate: st.paid_date || '',
            paymentMode: st.payment_mode || '',
            status: st.status || 'Paid',
            ...(st.details && typeof st.details === 'object' ? st.details : {})
          };
        });
        return result;
      } catch(e) {
        console.error('fetchSalarySettlementsRelational error:', e);
        return null;
      }
    },

    async deleteSalarySettlementRelational(settlementId) {
      if (!settlementId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_salary_settlements?id=eq.${encodeURIComponent(settlementId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },
    // --- Enterprise Yarn RM Orders Relational APIs ---
    async fetchYarnOrdersRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const dbOrders = await fetchAllRowsPaginated('vf_yarn_orders', '*', 'order=order_date.desc');
        const dbBatches = await fetchAllRowsPaginated('vf_yarn_order_batches', '*', 'order=receive_date.desc');
        const dbBoxes = await fetchAllRowsPaginated('vf_yarn_order_boxes', '*', 'order=box_number.asc');
        if (!Array.isArray(dbOrders) || dbOrders.length === 0) return null;

        const boxesByBatch = new Map();
        (dbBoxes || []).forEach(bx => {
          if (!boxesByBatch.has(bx.batch_id)) boxesByBatch.set(bx.batch_id, []);
          boxesByBatch.get(bx.batch_id).push({
            boxNumber: bx.box_number,
            weight: Number(bx.weight) || 0,
            cones: bx.cones || 0,
            returnedWeight: Number(bx.returned_weight) || 0,
            returnedDate: bx.returned_date || null,
            returnReason: bx.return_reason || null
          });
        });

        const batchesByOrder = new Map();
        (dbBatches || []).forEach(b => {
          if (!batchesByOrder.has(b.order_id)) batchesByOrder.set(b.order_id, []);
          batchesByOrder.get(b.order_id).push({
            id: b.id,
            challanNumber: b.challan_number || '',
            lotNumber: b.lot_number || '',
            receiveDate: b.receive_date || '',
            totalWeight: Number(b.total_weight) || 0,
            notes: b.notes || '',
            boxes: boxesByBatch.get(b.id) || []
          });
        });

        return dbOrders.map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          orderDate: o.order_date,
          supplier: o.supplier,
          category: o.category || 'Polyester',
          type: o.category || 'Polyester',
          quality: o.quality,
          code: o.code || '',
          color: o.color || '',
          orderedWeight: Number(o.ordered_weight) || 0,
          price: Number(o.price) || 0,
          status: o.status || 'Active',
          remarks: o.remarks || '',
          batches: batchesByOrder.get(o.id) || []
        }));
      } catch (e) {
        console.error('fetchYarnOrdersRelational error:', e);
        return null;
      }
    },

    async deleteYarnOrderRelational(orderId) {
      if (!orderId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_orders?id=eq.${encodeURIComponent(orderId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    // --- Enterprise Yarn RM Stock Relational APIs ---
    async fetchYarnStockRelational() {
      if (!activeConfig.isConfigured || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
      try {
        const lots = await fetchAllRowsPaginated('vf_yarn_rm_lots', '*', 'order=receive_date.desc');
        const boxes = await fetchAllRowsPaginated('vf_yarn_rm_boxes', '*', 'order=box_number.asc');
        if (!Array.isArray(lots) || lots.length === 0) return null;

        const boxesByLot = new Map();
        (boxes || []).forEach(b => {
          if (!boxesByLot.has(b.lot_id)) boxesByLot.set(b.lot_id, []);
          boxesByLot.get(b.lot_id).push({
            id: b.box_number || b.id,
            boxNumber: b.box_number,
            cones: b.cones || 0,
            grossWeight: Number(b.gross_weight) || 0,
            remainingWeight: Number(b.remaining_weight) || 0,
            weight: Number(b.active_weight) || 0,
            status: b.status || 'available',
            issueDate: b.issue_date || null,
            issuedTo: b.issued_to || null,
            grDate: b.gr_date || null,
            grWeight: Number(b.gr_weight) || 0,
            grRemarks: b.gr_remarks || null
          });
        });

        return lots.map(l => ({
          id: l.id,
          batchId: l.batch_id || '',
          lotNumber: l.lot_number,
          challanNo: l.challan_number || '',
          challanNumber: l.challan_number || '',
          receiveDate: l.receive_date,
          date: l.receive_date,
          supplier: l.supplier,
          quality: l.quality,
          itemType: l.item_type || 'Polyester',
          code: l.code || '',
          color: l.color || '',
          rate: Number(l.rate) || 0,
          orderRef: l.order_ref || '',
          notes: l.notes || '',
          boxes: boxesByLot.get(l.id) || []
        }));
      } catch (e) {
        console.error('fetchYarnStockRelational error:', e);
        return null;
      }
    },

    async issueYarnBoxesAtomic(boxUids, issueData = {}) {
      if (!Array.isArray(boxUids) || boxUids.length === 0) return { success: false, error: 'No boxes specified' };
      const { issuedTo = 'General', issueDate = new Date().toISOString().split('T')[0], remarks = '' } = issueData;
      const user = getLocalUserInfo().name || 'Operator';

      if (activeConfig.isConfigured && SUPABASE_URL) {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_issue_yarn_boxes`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              p_box_ids: boxUids,
              p_issued_to: issuedTo,
              p_issue_date: issueDate,
              p_user: user,
              p_remarks: remarks
            })
          });

          if (res.ok) {
            const data = await res.json();
            return data;
          }
        } catch (e) {
          console.warn('RPC vf_issue_yarn_boxes fallback to local update:', e);
        }
      }
      return { success: true, fallback: true };
    },

    async deleteYarnLotRelational(lotId) {
      if (!lotId || !activeConfig.isConfigured || !SUPABASE_URL) return;
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vf_yarn_rm_lots?id=eq.${encodeURIComponent(lotId)}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
      } catch(e) {}
    },

    async fetchYarnTransactions(lotId = null) {
      if (!activeConfig.isConfigured || !SUPABASE_URL) return [];
      try {
        let url = 'vf_yarn_rm_transactions?select=*&order=created_at.desc';
        if (lotId) url += `&lot_id=eq.${encodeURIComponent(lotId)}`;
        return await fetchAllRowsPaginated(url);
      } catch (e) {
        return [];
      }
    },
    // --- Realtime User Presence & Live Collaborative Editing APIs ---
    getCurrentUser: () => getLocalUserInfo(),
    getCurrentPage: () => getCurrentPageKey(),
    getPresenceStore: () => ({ ...presenceStore }),
    getPresence(page) {
      const targetPage = page || getCurrentPageKey();
      return deduplicateUsers(Object.values(presenceStore).filter(u => !u.page || u.page === targetPage));
    },
    getAllPresence: () => deduplicateUsers(Object.values(presenceStore)),
    sendPresenceHello: () => sendPresenceHello(),
    sendPresencePing: (...args) => sendPresencePing(...args),
    sendPresenceLeave: () => sendPresenceLeave(),
    broadcastFieldFocus: (fieldId, isFocused, meta) => broadcastFieldFocus(fieldId, isFocused, meta),
    broadcastFieldChange: (fieldId, value, meta) => broadcastFieldChange(fieldId, value, meta),
    broadcastFormClear: (fieldIds) => broadcastFormClear(fieldIds),
    broadcastActiveFormSnapshot: (container) => {
      if (typeof window.__vf_broadcastActiveFormSnapshot === 'function') {
        window.__vf_broadcastActiveFormSnapshot(container);
      }
    },
    getAvatarColors: () => AVATAR_COLORS
  };

  // Initial local presence announcement across same-browser tabs
  sendPresenceHello();

  // Initial boot: start Realtime WS and initial load
  if (activeConfig.isConfigured) {
    // Purge any accidental local-only keys previously stored in remote vf_kv_store
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/vf_kv_store?key=in.("vf_session","vf_user_name","vf_supabase_token","vf_supabase_session","vf_sidebar_open_folders","vf_sidebar_collapsed","vishwa_fashions_sidebar_mode","vishwa_fashions_theme")`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }).catch(() => {});
    }
    initRealtimeWebSocket();
    supabaseApi.loadAll(true).then(() => {
      console.log("Management Suite — Cloud Sync initialized.");
    });
  } else {
    // Self-healing: if APP_CONFIG loads after supabase-client.js, auto-configure
    let checkAttempts = 0;
    const configCheckTimer = setInterval(() => {
      checkAttempts++;
      if (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL && window.APP_CONFIG.SUPABASE_ANON_KEY) {
        clearInterval(configCheckTimer);
        const resolved = resolveConfig();
        if (resolved.isConfigured && !activeConfig.isConfigured) {
          supabaseApi.configure({ url: resolved.url, anonKey: resolved.anonKey, saveToStorage: false });
        }
      }
      if (checkAttempts > 20) {
        clearInterval(configCheckTimer);
      }
    }, 250);
  }

  // Smart polling interval & Visibility Throttling (30s interval, disabled when tab is hidden)
  let syncIntervalId = null;
  const POLL_INTERVAL_MS = 30000;

  function startSmartSync() {
    if (!syncIntervalId) {
      syncIntervalId = setInterval(() => {
        if (!document.hidden) {
          supabaseApi.loadAll(false);
        }
      }, POLL_INTERVAL_MS);
    }
  }

  function stopSmartSync() {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  }

  startSmartSync();

  // Listen for tab focus/visibility changes to resume polling & reconnect WebSocket immediately
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopSmartSync();
    } else {
      initRealtimeWebSocket();
      supabaseApi.loadAll(false);
      startSmartSync();
    }
  });

  window.addEventListener('focus', () => {
    if (!document.hidden) {
      initRealtimeWebSocket();
      supabaseApi.loadAll(false);
    }
  });

  // Override localStorage calls to point to Cloud Storage with synchronous native fallback
  const supabaseLocalStorage = {
    getItem: function(key) {
      if (isLocalOnlyKey(key)) {
        try {
          return nativeLocalStorage.getItem(key);
        } catch(e) {
          return null;
        }
      }
      if (cache.hasOwnProperty(key)) {
        return cache[key];
      }
      try {
        const nativeVal = nativeLocalStorage.getItem(key);
        if (nativeVal !== null) {
          cache[key] = nativeVal;
          return nativeVal;
        }
      } catch(e) {}
      return null;
    },
    setItem: function(key, value) {
      const valStr = String(value);
      if (isLocalOnlyKey(key)) {
        safeLocalStorageSet(key, valStr);
        return;
      }
      cache[key] = valStr;
      lastLocalWrites[key] = Date.now();
      safeLocalStorageSet(key, valStr);

      if (syncChannel) {
        try { syncChannel.postMessage({ key: key, value: valStr, type: 'setItem', senderId: CLIENT_ID }); } catch(e) {}
      }

      let parsedVal = valStr;
      try {
        if ((valStr.startsWith('{') && valStr.endsWith('}')) || (valStr.startsWith('[') && valStr.endsWith(']'))) {
          parsedVal = JSON.parse(valStr);
        }
      } catch(e) {}

      supabaseApi.set(key, parsedVal);
    },
    removeItem: function(key) {
      if (isLocalOnlyKey(key)) {
        try {
          nativeLocalStorage.removeItem(key);
        } catch(e) {}
        idbDelete(key);
        return;
      }
      delete cache[key];
      lastLocalWrites[key] = Date.now();
      try {
        nativeLocalStorage.removeItem(key);
      } catch(e) {}
      idbDelete(key);
      if (syncChannel) {
        try { syncChannel.postMessage({ key: key, value: null, type: 'removeItem', senderId: CLIENT_ID }); } catch(e) {}
      }
      supabaseApi.delete(key);
    },
    clear: function() {
      Object.keys(cache).forEach(k => {
        if (!isLocalOnlyKey(k)) delete cache[k];
      });
      try {
        const savedSession = nativeLocalStorage.getItem('vf_session');
        const savedUserName = nativeLocalStorage.getItem('vf_user_name');
        const savedToken = nativeLocalStorage.getItem('vf_supabase_token');
        const savedSbSession = nativeLocalStorage.getItem('vf_supabase_session');
        nativeLocalStorage.clear();
        if (savedSession) nativeLocalStorage.setItem('vf_session', savedSession);
        if (savedUserName) nativeLocalStorage.setItem('vf_user_name', savedUserName);
        if (savedToken) nativeLocalStorage.setItem('vf_supabase_token', savedToken);
        if (savedSbSession) nativeLocalStorage.setItem('vf_supabase_session', savedSbSession);
      } catch(e) {}
      supabaseApi.clearAll();
    },
    key: function(index) {
      return Object.keys(cache)[index] || null;
    },
    get length() {
      return Object.keys(cache).length;
    }
  };

  window.VishwaSupabase = supabaseApi;

  try {
    Object.defineProperty(window, 'localStorage', {
      value: supabaseLocalStorage,
      writable: true,
      configurable: true
    });
  } catch(e) {
    window.localStorage = supabaseLocalStorage;
  }
})();

