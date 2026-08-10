# Google Sheets Bottom Navigation Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the bottom quality navigation bar in both Yarn Costing (`modules/yarn/yarn-costing.html`) and Weaving Costing (`modules/weaving/weaving-costing.html`) into a 40px Google Sheets style navigation bar with drag-and-drop reordering for quality sheets.

**Architecture:** Implement compact Google Sheets tab bar CSS styling and a robust drag-and-drop reordering handler in React/JS for the 4 quality tab arrays (`products`, `tfoProducts`, `doublerProducts`, `coveringProducts`) in both costing modules.

**Tech Stack:** React (In-Browser Babel/standalone), HTML5 Drag and Drop API, Tailwind CSS, Vanilla CSS.

## Global Constraints
- Do NOT break existing costing calculations, formulas, or modal functions.
- Do NOT make syntax errors.
- Ensure state persistence in `localStorage` when tabs are reordered.
- Maintain existing dark mode compatibility.

---

### Task 1: Add Google Sheets Bottom Bar CSS Styles

**Files:**
- Modify: `modules/yarn/yarn-costing.html` (CSS section)
- Modify: `modules/weaving/weaving-costing.html` (CSS section)

**Interfaces:**
- Produces: CSS classes `.gs-tab-bar`, `.gs-tab`, `.gs-tab-active`, `.gs-tab-inactive`, `.gs-drag-over-left`, `.gs-drag-over-right`.

- [ ] **Step 1: Inspect existing footer styles in `yarn-costing.html`**
- [ ] **Step 2: Add Google Sheets bottom bar CSS rules to `yarn-costing.html` and `weaving-costing.html`**

```css
/* Google Sheets Style Navigation Footer */
.yc-quality-footer {
  height: 40px !important;
  padding: 0 12px !important;
  background-color: #f8f9fa !important;
  border-top: 1px solid #dadce0 !important;
}
.dark-mode .yc-quality-footer {
  background-color: #1f2937 !important;
  border-top-color: #374151 !important;
}

.gs-tab {
  height: 32px;
  padding: 0 16px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
  cursor: pointer;
  position: relative;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  border-right: 1px solid #dadce0;
  border-radius: 6px 6px 0 0;
  margin-top: 8px;
}

.gs-tab-active {
  background-color: #ffffff !important;
  color: #1e293b !important;
  font-weight: 700 !important;
  border-top: 2.5px solid #8b5cf6 !important;
  border-left: 1px solid #dadce0 !important;
  border-right: 1px solid #dadce0 !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.dark-mode .gs-tab-active {
  background-color: #111827 !important;
  color: #f3f4f6 !important;
  border-top-color: #a78bfa !important;
  border-left-color: #374151 !important;
  border-right-color: #374151 !important;
}

.gs-tab-inactive {
  background-color: #e9ecef;
  color: #64748b;
}

.gs-tab-inactive:hover {
  background-color: #f1f5f9;
  color: #334155;
}

.dark-mode .gs-tab-inactive {
  background-color: #111827;
  color: #9ca3af;
  border-right-color: #374151;
}

.dark-mode .gs-tab-inactive:hover {
  background-color: #1f2937;
  color: #e5e7eb;
}

.gs-drag-over-target {
  border-left: 3px solid #8b5cf6 !important;
}
```

- [ ] **Step 3: Verify styles render cleanly in browser without syntax errors**
- [ ] **Step 4: Commit CSS changes**

```bash
git add modules/yarn/yarn-costing.html modules/weaving/weaving-costing.html
git commit -m "style: add Google Sheets bottom navigation bar CSS classes"
```

---

### Task 2: Implement Google Sheets Navigation Bar with Drag & Rearrange in `yarn-costing.html`

**Files:**
- Modify: `modules/yarn/yarn-costing.html:21994-22073`

**Interfaces:**
- Consumes: `products`, `setProducts`, `activeIndex`, `setActiveIndex`, `tfoProducts`, `setTfoProducts`, `tfoActiveIndex`, `setTfoActiveIndex`, `doublerProducts`, `setDoublerProducts`, `doublerActiveIndex`, `setDoublerActiveIndex`, `coveringProducts`, `setCoveringProducts`, `coveringActiveIndex`, `setCoveringActiveIndex`.
- Produces: Drag & drop reordering handler `handleTabDragReorder(type, fromIndex, toIndex)` and Google Sheets tab bar UI.

- [ ] **Step 1: Add drag reorder state and handler function in `yarn-costing.html`**

```javascript
const [draggedTab, setDraggedTab] = useState(null); // { type: 'fabric'|'tfo'|'doubler'|'covering', index: number }
const [dragOverIndex, setDragOverIndex] = useState(null);

const handleTabReorder = (type, fromIdx, toIdx) => {
  if (fromIdx === toIdx || fromIdx === null || toIdx === null) return;
  
  if (type === 'fabric') {
    setProducts(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return updated;
    });
    if (activeIndex === fromIdx) setActiveIndex(toIdx);
    else if (activeIndex > fromIdx && activeIndex <= toIdx) setActiveIndex(prev => prev - 1);
    else if (activeIndex < fromIdx && activeIndex >= toIdx) setActiveIndex(prev => prev + 1);
  } else if (type === 'tfo') {
    setTfoProducts(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return updated;
    });
    if (tfoActiveIndex === fromIdx) setTfoActiveIndex(toIdx);
    else if (tfoActiveIndex > fromIdx && tfoActiveIndex <= toIdx) setTfoActiveIndex(prev => prev - 1);
    else if (tfoActiveIndex < fromIdx && tfoActiveIndex >= toIdx) setTfoActiveIndex(prev => prev + 1);
  } else if (type === 'doubler') {
    setDoublerProducts(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return updated;
    });
    if (doublerActiveIndex === fromIdx) setDoublerActiveIndex(toIdx);
    else if (doublerActiveIndex > fromIdx && doublerActiveIndex <= toIdx) setDoublerActiveIndex(prev => prev - 1);
    else if (doublerActiveIndex < fromIdx && doublerActiveIndex >= toIdx) setDoublerActiveIndex(prev => prev + 1);
  } else if (type === 'covering') {
    setCoveringProducts(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return updated;
    });
    if (coveringActiveIndex === fromIdx) setCoveringActiveIndex(toIdx);
    else if (coveringActiveIndex > fromIdx && coveringActiveIndex <= toIdx) setCoveringActiveIndex(prev => prev - 1);
    else if (coveringActiveIndex < fromIdx && coveringActiveIndex >= toIdx) setCoveringActiveIndex(prev => prev + 1);
  }
};
```

- [ ] **Step 2: Render Google Sheets style footer across Fabric, TFO, Doubler, and Covering costing in `yarn-costing.html`**
  - Implement left toolbar with `+` (Add sheet) and `≡` (Quality list / search dropdown).
  - Map tabs with `draggable="true"`, `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd` and active indicator border.
- [ ] **Step 3: Test dragging tab in `yarn-costing.html` to confirm smooth reordering without errors**
- [ ] **Step 4: Commit `yarn-costing.html` implementation**

```bash
git add modules/yarn/yarn-costing.html
git commit -m "feat(yarn): implement Google Sheets bottom tab bar with drag reordering"
```

---

### Task 3: Implement Google Sheets Navigation Bar with Drag & Rearrange in `weaving-costing.html`

**Files:**
- Modify: `modules/weaving/weaving-costing.html` (Footer sections for Fabric, TFO, Doubler, Covering)

**Interfaces:**
- Consumes: Same quality tab arrays and setters in `weaving-costing.html`.
- Produces: Drag & drop reordering handler and Google Sheets tab bar UI in `weaving-costing.html`.

- [ ] **Step 1: Add drag reorder state and handler function in `weaving-costing.html`**
- [ ] **Step 2: Render Google Sheets style footer across Fabric, TFO, Doubler, and Covering costing in `weaving-costing.html`**
- [ ] **Step 3: Test dragging tab in `weaving-costing.html` to confirm smooth reordering without errors**
- [ ] **Step 4: Commit `weaving-costing.html` implementation**

```bash
git add modules/weaving/weaving-costing.html
git commit -m "feat(weaving): implement Google Sheets bottom tab bar with drag reordering"
```

---

### Task 4: Verification & Regression Testing

**Files:**
- Check: `modules/yarn/yarn-costing.html`
- Check: `modules/weaving/weaving-costing.html`

- [ ] **Step 1: Check syntax and HTML structure in both files**
- [ ] **Step 2: Verify active quality tab selection remains intact when reordered**
- [ ] **Step 3: Verify adding/deleting qualities works from the new Google Sheets bottom bar**
- [ ] **Step 4: Final git status check and commit**
