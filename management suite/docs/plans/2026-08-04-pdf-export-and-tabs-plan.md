# PDF Export Uniformity & Mobile/Tablet Tab Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize PDF exports across mobile, tablet, and desktop views for Costing Sheets and Salary Sheet, and hide top navigation tabs in Salary Sheet on screens <= 1024px.

**Architecture:** CSS media query adjustment in `salary-sheet.html` for tab visibility; JS offscreen wrapper style locking in `weaving-costing.html` & `yarn-costing.html` for PDF export consistency across viewports.

**Tech Stack:** HTML5, CSS3, Vanilla JavaScript (html2pdf.js / window.print)

## Global Constraints
- Target screens `<= 1024px` for hiding top tabs in `salary-sheet.html`.
- Maintain desktop styling and layout in exported PDFs regardless of window size.

---

### Task 1: Hide Salary Sheet Top Navigation Tabs on Mobile & Tablet Viewports (<= 1024px)

**Files:**
- Modify: `modules/salary-sheet.html:3186-3260`

**Interfaces:**
- Consumes: `.tabs.salary-tabs`
- Produces: Hidden `.tabs.salary-tabs` element on `@media (max-width: 1024px)`

- [ ] **Step 1: Inspect CSS media query rule in `modules/salary-sheet.html`**
- [ ] **Step 2: Update `@media (max-width: 1024px)` rule to hide `.tabs.salary-tabs`**

```css
@media (max-width: 1024px) {
  body .tabs.salary-tabs {
    display: none !important;
  }
}
```

- [ ] **Step 3: Verify tab hiding on viewports <= 1024px**
- [ ] **Step 4: Commit changes**

```bash
git add modules/salary-sheet.html
git commit -m "style: hide top tabs on mobile and tablet viewports in salary sheet"
```

---

### Task 2: Ensure Uniform Desktop PDF Export in Costing Sheet (`weaving-costing.html` & `yarn-costing.html`)

**Files:**
- Modify: `modules/weaving/weaving-costing.html:197-206`, `6450-6488`
- Modify: `modules/yarn/yarn-costing.html:210-219`, `6449-6487`

**Interfaces:**
- Consumes: `.printable-offscreen-wrapper.yc-pdf-exporting`
- Produces: Fixed 1200px desktop width snapshot container during PDF render.

- [ ] **Step 1: Add fixed desktop width to `.printable-offscreen-wrapper.yc-pdf-exporting` in `weaving-costing.html` and `yarn-costing.html`**

```css
.printable-offscreen-wrapper.yc-pdf-exporting {
  width: 1200px !important;
  min-width: 1200px !important;
  max-width: 1200px !important;
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  visibility: visible !important;
  opacity: 0 !important;
  left: 0 !important;
  top: 0 !important;
  z-index: -1 !important;
}
```

- [ ] **Step 2: Force explicit width in `runCostingPdfExport` JavaScript setup**

```javascript
if (wrapper) {
  wrapper.classList.add('yc-pdf-exporting');
  wrapper.style.width = '1200px';
  wrapper.style.minWidth = '1200px';
  wrapper.style.maxWidth = '1200px';
}
```

- [ ] **Step 3: Verify PDF export consistency on mobile/tablet viewports**
- [ ] **Step 4: Commit changes**

```bash
git add modules/weaving/weaving-costing.html modules/yarn/yarn-costing.html
git commit -m "fix: enforce desktop width layout in costing sheet PDF exports across viewports"
```

---

### Task 3: Ensure Uniform Desktop PDF Export in Salary Sheet (`salary-sheet.html`)

**Files:**
- Modify: `modules/salary-sheet.html:1476-1510`

**Interfaces:**
- Consumes: `@media print` CSS block
- Produces: Unified print/PDF layout across all screen sizes.

- [ ] **Step 1: Inspect `@media print` block in `salary-sheet.html`**
- [ ] **Step 2: Add print viewport rules to lock container width to 1200px / desktop layout during print**

```css
@media print {
  html, body, .container {
    width: 1200px !important;
    min-width: 1200px !important;
    max-width: 1200px !important;
  }
}
```

- [ ] **Step 3: Verify print / PDF preview on mobile/tablet screen sizes**
- [ ] **Step 4: Commit changes**

```bash
git add modules/salary-sheet.html
git commit -m "fix: enforce desktop width in salary sheet print and pdf export"
```
