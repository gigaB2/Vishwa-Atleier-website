# Technical Design Specification: View Only vs Edit Access Permissions

**Date:** 2026-08-07  
**Status:** Approved  
**Target File:** `docs/superpowers/specs/2026-08-07-view-edit-access-permissions-design.md`

---

## 1. Executive Summary

This feature upgrades the employee page and tab access control system from a binary toggle (Access / No Access) to a 3-tier access control system:
1. **No Access (`none`)**: User cannot view the page/tab; it is hidden from navigation and direct URL visits redirect away.
2. **View Only (`view`)**: User can access the page/tab, view data, filter, search, sort, navigate pages, and view details, but CANNOT add, edit, or delete data.
3. **Edit Access (`edit`)**: Full access to view, create, update, and delete data.

Admins continue to bypass permission checks with full administrative access.

---

## 2. Permission Data Architecture

### 2.1 Permission Keys & Values
Permissions stored in `vf_users` and `vf_session` under the `permissions` object:

```json
{
  "order-book": "edit",
  "order-book-entry": "view",
  "order-book-analytics": "view",
  "rm-weft-stock-book": "edit",
  "weft-ledger": "view",
  "manage": "none"
}
```

### 2.2 Backward Compatibility
- Existing legacy `'full'` values automatically map to `'edit'`.
- Missing keys or legacy boolean `false` / `'none'` values map to `'none'`.
- Admins (`role === 'admin'`) automatically evaluate as `'edit'` for all keys.

### 2.3 Core Permission API (`sidebar.js` / global scope)
```javascript
window.vfHasAccess(permKey)   // Returns true if perm === 'edit' || perm === 'view' || isAdmin
window.vfCanEdit(permKey)     // Returns true if perm === 'edit' || isAdmin
window.vfIsViewOnly(permKey)  // Returns true if !isAdmin && perm === 'view'
```

---

## 3. Settings UI (`modules/settings.html`)

### 3.1 Permission Selectors
In **Create Employee Account** and **Edit Employee Access Modal**:
- Replace checkbox list per tab/module item with a styled dropdown selector:
  - `<select class="perm-level-select" data-key="order-book">`
    - Option `<option value="none">🚫 No Access</option>`
    - Option `<option value="view">👁️ View Only</option>`
    - Option `<option value="edit">✏️ Edit Access</option>`
  - Visual indicators: Distinct badge coloring for View Only (amber/sky) vs Edit (emerald) vs None (slate).

### 3.2 Quick Preset Buttons
Header bar above permissions list will include 3 preset action buttons:
- **Select All Edit**: Sets all module and sub-tab selectors to `edit`.
- **Select All View**: Sets all module and sub-tab selectors to `view`.
- **Deselect All**: Sets all module and sub-tab selectors to `none`.

### 3.3 Parent-Child Cascading Logic
- When a parent module folder dropdown (e.g. `order-book`) changes level, all child sub-tab dropdowns (e.g. `order-book-entry`, `order-book-analytics`) automatically update to match the parent level.
- Sub-tab selectors can still be individually customized (e.g., parent folder `view`, sub-tab `order-book-entry` set to `edit`).

---

## 4. Navigation & Page Access Guard (`sidebar.js`)

### 4.1 Navigation Filtering
- Items with `'edit'` or `'view'` permission remain visible in sidebar menu and accordions.
- Items with `'none'` permission are hidden using `.vf-perm-hidden` (`display: none !important`).
- Folder header accordions are hidden only if all child links inside are `'none'`.

### 4.2 Page Redirection Guard
- Direct page visits with `'none'` permission trigger quiet redirection to the first allowed page or `index.html`.
- Visits with `'view'` or `'edit'` permission are allowed to load.

---

## 5. Global View-Only UI & Action Enforcer

### 5.1 CSS View-Only Enforcer
When `vfIsViewOnly(currentKey)` is true for the active page/tab:
- Class `.vf-view-only-mode` is added to `document.body` and main content wrapper.
- CSS rules automatically hide/disable write operations:
  - `.vf-view-only-mode .btn-create, .vf-view-only-mode .btn-add, .vf-view-only-mode .btn-delete, .vf-view-only-mode .btn-edit, .vf-view-only-mode .btn-save, .vf-view-only-mode .action-edit, .vf-view-only-mode .action-delete` -> `display: none !important;`
  - `.vf-view-only-mode form input:not(.vf-filter-control):not([type="search"]), .vf-view-only-mode form textarea` -> `pointer-events: none; opacity: 0.7;`

### 5.2 Read-Only Status Indicator
- A floating or header badge **"👁️ View Only Access"** is displayed in the page header bar when in View-Only mode, giving clear context to the user.

### 5.3 JavaScript Event Interception
- Event delegation on `submit` and click actions for forms/save buttons to prevent accidental data modification with toast alert: `"You have View Only access to this page. Data entry and edits are restricted."`
