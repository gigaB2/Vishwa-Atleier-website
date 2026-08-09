# Mobile To-Do Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `To-do.html` for small mobile screens (320px to 425px width) into a Vertical Scrolling Dual Card Stack layout with 44px+ touch targets and zero iOS auto-zoom issues.

**Architecture:** CSS media query enhancements within `To-do.html` under `@media (max-width: 767px)` and `@media (max-width: 425px)`. Replaces tabbed single-page toggle mode on mobile with a continuous stacked dual-card leather notebook layout, adding a mobile spine divider between Tasks and Notes.

**Tech Stack:** HTML5, Vanilla CSS3, Vanilla JS.

## Global Constraints
- Target viewports: `320px` to `425px` (iPhone SE, iPhone Mini, iPhone Standard, Pixel, Galaxy).
- Minimal touch target size: `44px × 44px` for buttons, checkboxes, and inputs.
- Input font-size floor: `16px !important` on inputs and textareas to enforce zero auto-zoom on iOS Safari.
- Zero horizontal scrolling on all viewports (`overflow-x: hidden`).

---

### Task 1: Mobile Glass Header Banner Redesign

**Files:**
- Modify: `To-do.html:585-645` (mobile media queries for `.book-header-banner`, `.date-badge-trigger`, `.nav-btn`)

**Interfaces:**
- Consumes: Header HTML elements (`#date-picker`, `#date-formatted-title`, `#prev-date-btn`, `#today-btn`, `#next-date-btn`).
- Produces: 2-row responsive header banner layout on screens `≤ 425px`.

- [ ] **Step 1: Inspect current header media query rules**

View `To-do.html` lines 595-640 to verify current flex and size rules for `.book-header-banner`.

- [ ] **Step 2: Update CSS media query for mobile header (320px to 425px)**

In `To-do.html`, update `@media (max-width: 425px)` rules for `.book-header-banner`:
```css
@media (max-width: 425px) {
  .book-header-banner {
    padding: 8px;
    gap: 8px;
    flex-direction: column;
    width: 100%;
    margin-bottom: 12px;
  }
  .date-badge-trigger {
    width: 100%;
    min-height: 44px;
    padding: 8px 14px;
  }
  .date-title {
    font-size: 14px;
  }
  .nav-actions-right {
    width: 100%;
    display: flex;
    gap: 6px;
  }
  .nav-btn {
    flex: 1;
    min-height: 44px;
    padding: 6px;
    font-size: 12px;
  }
}
```

- [ ] **Step 3: Verify syntax in To-do.html**

Ensure brackets match and no CSS syntax errors exist.

- [ ] **Step 4: Commit header redesign**

```bash
git add To-do.html
git commit -m "style: redesign mobile header banner for 320px-425px viewports"
```

---

### Task 2: Vertical Dual-Card Book Stack & Mobile Spine Divider

**Files:**
- Modify: `To-do.html:645-725` (Mobile layout rules for `.pages-spread`, `.left-page`, `.right-page`, `.book`)

**Interfaces:**
- Consumes: `.pages-spread`, `.left-page`, `.right-page`, `.book`.
- Produces: Stacked dual-card layout displaying both tasks and notes vertically on mobile.

- [ ] **Step 1: Remove tab toggle hidden restrictions on mobile**

In `To-do.html`, update mobile `@media (max-width: 767px)`:
```css
/* Mobile Vertical Stack Mode (Both Pages Visible) */
.pages-spread {
  display: flex !direction;
  flex-direction: column !important;
  gap: 16px;
}

.pages-spread .left-page,
.pages-spread .right-page {
  display: flex !important;
  width: 100% !important;
  border-right: none !important;
  border-radius: 8px !important;
}

/* Hide mobile tab switcher since both pages are stacked vertically */
.mobile-tab-bar {
  display: none !important;
}
```

- [ ] **Step 2: Add Mobile Stitched Spine Divider HTML and CSS**

In `To-do.html`, insert a `<div class="mobile-spine-divider"></div>` between `.left-page` and `.right-page` in the HTML markup, and add CSS:
```css
.mobile-spine-divider {
  display: none;
}
@media (max-width: 767px) {
  .mobile-spine-divider {
    display: block;
    width: 100%;
    height: 1px;
    border-top: 2px dashed rgba(139, 90, 43, 0.3);
    margin: 4px 0;
    position: relative;
  }
  .mobile-spine-divider::after {
    content: '✦';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--paper-cream);
    padding: 0 10px;
    color: var(--accent-brown);
    font-size: 10px;
  }
}
```

- [ ] **Step 3: Commit vertical stack layout**

```bash
git add To-do.html
git commit -m "style: implement vertical scrolling dual card stack for mobile"
```

---

### Task 3: Touch Ergonomics & Form Control Sizing

**Files:**
- Modify: `To-do.html:670-750` (Form inputs, task items, notebook paper styles for 320px–425px)

**Interfaces:**
- Consumes: `.task-input`, `.add-task-btn`, `.task-item`, `.task-checkbox`, `.delete-task-btn`, `.notebook-textarea`.
- Produces: Touch-optimised UI controls conforming to Apple HIG 44px rules and zero iOS auto-zoom.

- [ ] **Step 1: Update form input and task item sizing for ≤ 425px**

In `To-do.html`:
```css
@media (max-width: 425px) {
  body {
    padding: 10px 6px;
  }

  .add-task-form {
    display: flex;
    gap: 6px;
    width: 100%;
  }

  .task-input {
    flex: 1;
    min-height: 44px;
    font-size: 16px !important;
  }

  .add-task-btn {
    min-height: 44px;
    min-width: 60px;
    padding: 8px 12px;
    font-size: 13px;
  }

  .task-item {
    min-height: 48px;
    padding: 8px 10px;
    gap: 10px;
  }

  .task-checkbox {
    width: 24px;
    height: 24px;
    min-width: 24px;
    min-height: 24px;
  }

  .delete-task-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .notes-margin-line {
    left: 20px;
  }

  .notebook-textarea {
    padding: 0 6px 0 28px;
    font-size: 16px !important;
    line-height: 26px;
    min-height: 280px;
    background-image: repeating-linear-gradient(
      transparent,
      transparent 25px,
      var(--line-blue) 26px
    );
  }
}
```

- [ ] **Step 2: Commit touch ergonomics update**

```bash
git add To-do.html
git commit -m "style: enforce 44px touch targets and 16px font-size floor on 320px-425px"
```

---

### Task 4: Verification & Responsive Validation

**Files:**
- Test: `To-do.html`

- [ ] **Step 1: Serve website locally and inspect To-do.html**

Use local server or playwright/browser test to inspect rendering at `320px`, `375px`, `425px`.

- [ ] **Step 2: Check for horizontal overflow or layout glitches**

Verify `document.documentElement.scrollWidth <= window.innerWidth` across viewports.

- [ ] **Step 3: Final verification commit**

```bash
git add To-do.html
git commit -m "fix: verify mobile 320px-425px responsive redesign"
```
