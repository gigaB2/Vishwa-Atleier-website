# View Only vs Edit Access Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add View Only (`view`) and Edit Access (`edit`) permission modes for employee accounts across Settings and all application modules, allowing read-only viewing with filtering/search enabled while restricting data modification.

**Architecture:** Extend permission schema from binary to tri-state (`none`, `view`, `edit`). Update `sidebar.js` with global permission APIs (`vfHasAccess`, `vfCanEdit`, `vfIsViewOnly`), navigation filtering, and a global View-Only UI/action enforcer. Update `modules/settings.html` permission controls with styled dropdown selectors and quick preset action buttons.

**Tech Stack:** JavaScript (ES6+), HTML5, Vanilla CSS

## Global Constraints
- Do not break existing admin session capabilities.
- Maintain backwards compatibility for legacy `'full'` permissions.
- Ensure filter bars, search inputs, pagination, and date pickers remain fully functional in View-Only mode.
- Avoid external CSS libraries; use established theme variables (`var(--accent)`, `var(--border)`, etc.).

---

### Task 1: Core Permission Helpers & Navigation Filtering in `sidebar.js`

**Files:**
- Modify: `sidebar.js:650-815`

**Interfaces:**
- Produces: `window.vfHasAccess(key)`, `window.vfCanEdit(key)`, `window.vfIsViewOnly(key)`

- [ ] **Step 1: Define global permission helper functions**

Add the helper functions to `sidebar.js`:
```javascript
window.vfHasAccess = function(permKey) {
  const sessRaw = localStorage.getItem('vf_session');
  if (!sessRaw) return true;
  try {
    const sess = JSON.parse(sessRaw);
    if (!sess || sess.role === 'admin') return true;
    const perms = sess.permissions || {};
    const val = perms[permKey];
    return val === 'edit' || val === 'full' || val === 'view';
  } catch(e) { return true; }
};

window.vfCanEdit = function(permKey) {
  const sessRaw = localStorage.getItem('vf_session');
  if (!sessRaw) return true;
  try {
    const sess = JSON.parse(sessRaw);
    if (!sess || sess.role === 'admin') return true;
    const perms = sess.permissions || {};
    const val = perms[permKey];
    return val === 'edit' || val === 'full';
  } catch(e) { return true; }
};

window.vfIsViewOnly = function(permKey) {
  const sessRaw = localStorage.getItem('vf_session');
  if (!sessRaw) return false;
  try {
    const sess = JSON.parse(sessRaw);
    if (!sess || sess.role === 'admin') return false;
    const perms = sess.permissions || {};
    const val = perms[permKey];
    return val === 'view';
  } catch(e) { return false; }
};
```

- [ ] **Step 2: Update sidebar link visibility & page access redirection**

In `sidebar.js`, update permission checking for links and page guards so that `'view'` and `'edit'`/`'full'` allow access, and only `'none'` hides links or redirects:
```javascript
// A link is hidden if perms[key] === 'none' (or false)
const permVal = perms[key];
if (permVal === 'none' || permVal === false) {
  // hide link
}
```

- [ ] **Step 3: Test permission helper methods in browser console**

Verify `window.vfHasAccess`, `window.vfCanEdit`, and `window.vfIsViewOnly` operate as expected.

- [ ] **Step 4: Commit Task 1**

```bash
git add sidebar.js
git commit -m "feat(auth): add global permission helpers and update sidebar visibility logic for view/edit access"
```

---

### Task 2: Global View-Only UI & Event Interception Enforcer in `sidebar.js`

**Files:**
- Modify: `sidebar.js:810-850`

**Interfaces:**
- Consumes: `window.vfIsViewOnly(key)`

- [ ] **Step 1: Implement `applyViewOnlyEnforcer()` in `sidebar.js`**

Add CSS injection and DOM enforcer logic:
```javascript
function applyViewOnlyEnforcer() {
  const sessRaw = localStorage.getItem('vf_session');
  if (!sessRaw) return;
  let activeSession = null;
  try { activeSession = JSON.parse(sessRaw); } catch(e) {}
  if (!activeSession || activeSession.role === 'admin' || !activeSession.permissions) return;

  const currentPath = window.location.pathname.toLowerCase().split('/').pop().split('?')[0];
  
  // Find current perm key for this page
  let currentPageKey = null;
  Object.keys(permKeyMap).forEach(key => {
    const target = permKeyMap[key].split('?')[0].toLowerCase();
    if (target.endsWith(currentPath)) {
      currentPageKey = key;
    }
  });

  if (!currentPageKey) return;

  const isViewOnly = window.vfIsViewOnly(currentPageKey);
  if (isViewOnly) {
    document.body.classList.add('vf-view-only-mode');
    
    // Inject CSS for View Only mode
    if (!document.getElementById('vf-view-only-styles')) {
      const style = document.createElement('style');
      style.id = 'vf-view-only-styles';
      style.textContent = `
        .vf-view-only-mode .btn-primary:not(.vf-filter-btn):not(.vf-tab-btn),
        .vf-view-only-mode .save-btn,
        .vf-view-only-mode button[onclick*="save"],
        .vf-view-only-mode button[onclick*="create"],
        .vf-view-only-mode button[onclick*="delete"],
        .vf-view-only-mode button[onclick*="remove"],
        .vf-view-only-mode button[onclick*="add"],
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
        }
      `;
      document.head.appendChild(style);
    }

    // Insert View Only badge into main container header if present
    const header = document.querySelector('.page-header, .header-title-area, .header-container, h1, h2');
    if (header && !document.querySelector('.vf-view-only-badge')) {
      const badge = document.createElement('span');
      badge.className = 'vf-view-only-badge';
      badge.innerHTML = '👁️ View Only Access';
      header.appendChild(badge);
    }
  }
}
```

- [ ] **Step 2: Trigger `applyViewOnlyEnforcer()` on DOM content loaded**

Execute `applyViewOnlyEnforcer()` inside `sidebar.js` initialization loop.

- [ ] **Step 3: Commit Task 2**

```bash
git add sidebar.js
git commit -m "feat(auth): implement global view-only UI enforcer and status badge"
```

---

### Task 3: Settings UI Dual Access Controls (`modules/settings.html`)

**Files:**
- Modify: `modules/settings.html:785-880, 1990-2040, 2090-2150, 2185-2235`

- [ ] **Step 1: Replace checkboxes with dropdown selectors and add preset buttons in `settings.html`**

Update `#emp-perm-checkboxes` and `#edit-modal-perm-checkboxes` markup in `modules/settings.html`:
```html
<div style="display: flex; gap: 0.4rem; margin-left: auto;">
  <button type="button" onclick="setAllPermLevel('emp-perm-checkboxes', 'edit')" style="font-size: 0.75rem; padding: 4px 10px; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); border-radius: 6px; cursor: pointer; font-weight: 600;">All Edit</button>
  <button type="button" onclick="setAllPermLevel('emp-perm-checkboxes', 'view')" style="font-size: 0.75rem; padding: 4px 10px; background: rgba(56,189,248,0.15); color: var(--accent); border: 1px solid rgba(56,189,248,0.3); border-radius: 6px; cursor: pointer; font-weight: 600;">All View</button>
  <button type="button" onclick="setAllPermLevel('emp-perm-checkboxes', 'none')" style="font-size: 0.75rem; padding: 4px 10px; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; cursor: pointer; font-weight: 600;">Deselect All</button>
</div>
```

Convert items to `<select class="vf-perm-select" data-key="...">`:
```html
<div class="vf-perm-row">
  <span>📁 RM Order Book</span>
  <select class="vf-perm-select" data-key="order-book">
    <option value="none">🚫 No Access</option>
    <option value="view">👁️ View Only</option>
    <option value="edit" selected>✏️ Edit Access</option>
  </select>
</div>
```

- [ ] **Step 2: Update JS handlers in `settings.html`**

Update `createNewEmployeeAccount()`, `openEditPermModal()`, and `saveEmployeePermissionsFromModal()`:
```javascript
function setAllPermLevel(containerId, level) {
  const selects = document.querySelectorAll('#' + containerId + ' select.vf-perm-select');
  selects.forEach(s => s.value = level);
}

// In createNewEmployeeAccount & saveEmployeePermissionsFromModal:
const selects = document.querySelectorAll('#' + containerId + ' select.vf-perm-select');
const perms = {};
selects.forEach(s => {
  perms[s.dataset.key] = s.value;
});
```

- [ ] **Step 3: Update `bindParentChildPermToggles()` to cascade dropdown value changes**

```javascript
container.querySelectorAll('select.vf-perm-select').forEach(sel => {
  sel.addEventListener('change', (e) => {
    const parentKey = e.target.dataset.key;
    const newLevel = e.target.value;
    if (parentChildMap[parentKey]) {
      parentChildMap[parentKey].forEach(childKey => {
        const childSel = container.querySelector(`select[data-key="${childKey}"]`);
        if (childSel) childSel.value = newLevel;
      });
    }
  });
});
```

- [ ] **Step 4: Verify UI in browser and test saving permissions**

Verify employee account creation and permission modal editing with View Only and Edit selections.

- [ ] **Step 5: Commit Task 3**

```bash
git add modules/settings.html
git commit -m "feat(settings): add dropdown selectors and preset buttons for view/edit access permissions"
```
