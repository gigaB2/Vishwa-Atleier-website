# Design Specification: Interactive Digital Book Planner (`To-do.html`)

**Date:** 2026-08-03  
**Status:** Approved  
**Output Target:** Standalone `To-do.html` (Single file HTML + CSS + JS)

---

## 1. Overview & Vision
The Interactive Digital Book Planner is a single-file, serverless web application that mimics a physical open hardcover journal. It provides a two-page spread view for any selected date:
- **Left Page:** Actionable Daily Task List (add, complete with strikethrough, delete, progress tracking).
- **Right Page:** Ruled Notebook Page (freeform journaling and notes with real-time auto-saving).
- **Page-Turning Experience:** Hardware-accelerated 3D spine-pivot leaf flip animation when changing dates.
- **Persistence:** LocalStorage persistence keyed by date (`YYYY-MM-DD`).

---

## 2. UI & Design System

### 2.1 Aesthetic & Palette
- **Book Cover / Jacket:** Dark charcoal trim (`#1e2229`) with leather texture and 3D drop shadow (`0 20px 50px rgba(0,0,0,0.3)`).
- **Parchment Paper:** Warm off-white/cream paper (`#faf7f0`).
- **Primary Text:** Dark graphite (`#2c2c2c`).
- **Accents:** Warm amber / leather brown (`#8b5a2b`) for buttons and badges.
- **Ruled Lines:** Faint blue horizontal lines (`rgba(70, 130, 180, 0.15)`) spaced at 28px intervals on the right page.
- **Typography:**
  - UI Controls & Dates: System sans-serif / `Outfit` / `Inter`.
  - Handwritten / Notes Feel: `Caveat` or elegant serif fallback.

### 2.2 Layout Breakdown
```
+-----------------------------------------------------------------------------------+
|                           NAV HEADER: [← Prev] [Date Picker] [Today] [Next →]     |
+----------------------------------------------------+------------------------------+
|                     LEFT PAGE                      |          RIGHT PAGE          |
|                   (Daily Tasks)                    |      (Thoughts & Notes)      |
|                                                    |                              |
|   Progress: [ 3 / 5 Completed ]                    |                              |
|   +--------------------------------------------+   |  ..........................  |
|   | Enter new task...                   [Add]  |   |  ..........................  |
|   +--------------------------------------------+   |  ..........................  |
|                                                    |  ..........................  |
|   [x] ~~Morning workout~~               [🗑️]       |  ..........................  |
|   [ ] Code review                       [🗑️]       |  ..........................  |
|   [ ] Read chapter 4                    [🗑️]       |  ..........................  |
|                                                    |                              |
|                                         PAGE 1     |     PAGE 2                   |
+----------------------------------------------------+------------------------------+
```

---

## 3. Core Functionality

### 3.1 Date Navigation & Persistence
- **Default State:** Automatically sets active date to today (`YYYY-MM-DD`) on initial load.
- **Date Picker:** Interactive `<input type="date">` for rapid jumping to any date.
- **Navigation Controls:** Next Day (`→`) and Previous Day (`←`) buttons.
- **Data Model (`localStorage` key: `todo_book_planner_v1`):**
  ```json
  {
    "2026-08-03": {
      "tasks": [
        { "id": "t_1722700000000", "text": "Morning workout", "completed": true }
      ],
      "notes": "Great productive day today!"
    }
  }
  ```

### 3.2 Left Page — Daily Tasks
- **Task Creation:** Input box + "Add Task" button (and `Enter` key handler). Trim input; ignore empty entries.
- **Task List:** Render tasks with custom checkboxes. Checking toggles completed status and applies line-through + reduced opacity.
- **Task Deletion:** Click trash icon to delete task instantly with fade-out.
- **Progress Counter:** Live count of completed vs total tasks for the day.

### 3.3 Right Page — Thoughts & Notes
- **Textarea:** Full-width lined textarea with auto-height or scrollable ruled lines.
- **Auto-Save:** Debounced function (300ms) saves changes to `localStorage` on typing, updating a small indicator badge ("Saved ✓").

---

## 4. 3D Page-Flip Animation Architecture

1. **Perspective Container:** `.book-container` set to `perspective: 1500px`.
2. **Animation Leaf:** A dual-sided element `.flip-leaf` positioned over the turning page with `transform-style: preserve-3d`.
3. **Forward Flip (Next Day):**
   - Leaf starts at right page (`transform: rotateY(0deg)`, `transform-origin: left center`).
   - Rotates to `-180deg`. At `-90deg` midpoint, content flips from current right page view to target left page view.
4. **Backward Flip (Prev Day):**
   - Leaf starts at left page (`transform: rotateY(0deg)`, `transform-origin: right center`).
   - Rotates to `180deg`.
5. **Shadow Overlay:** Dynamic gradients (`linear-gradient`) overlay the flipping leaf to create physical paper shadow & light reflection during rotation.
6. **Interaction Lock:** Navigation controls disabled during the 500ms animation loop to prevent overlapping transitions.

---

## 5. Verification Plan & Deliverables
- Single output file: `To-do.html`.
- Verification via browser testing for:
  1. Date change & 3D page flip animation smoothness.
  2. Adding/toggling/deleting tasks.
  3. Writing notes and confirming persistence across page reloads.
