# Design Specification: Smart Gantt Chart for Daily Tasks

**Date:** 2026-08-03  
**Status:** Approved  
**Target File:** `To-do.html`

---

## 1. Overview
The **Smart Gantt Chart** provides a visual timeline view of daily tasks in the To-Do book planner application. It renders in a modal overlay, automatically allocating 1-hour time slots to tasks starting from 9:00 AM, while supporting interactive drag-and-drop time adjustment and duration resizing.

---

## 2. User Experience & Aesthetics

### 2.1 Header Trigger Button
- **Button Element**: `<button id="gantt-modal-btn" class="gantt-trigger-btn">📊 Gantt View</button>`
- **Placement**: Located in `.book-header-banner` alongside date navigation controls.
- **Styling**: Styled to match the dark leather & warm gold design system with smooth hover and focus states.

### 2.2 Modal Overlay Layout
- **Container**: Fixed full-screen overlay (`#gantt-modal-overlay`) with backdrop blur and semi-transparent dark tint.
- **Modal Card**: Elevated container with warm parchment background (`var(--paper-bg)`), rounded corners, shadow, and leather header trim.
- **Modal Header**:
  - Title: "Daily Task Timeline & Gantt Chart"
  - Current Date Badge (e.g., "Mon, Aug 3, 2026")
  - Progress Summary (e.g. "2 / 5 Tasks Completed")
  - Time Range Filter (Default: "8:00 AM - 8:00 PM", Toggle: "24 Hours")
  - Close Button (`✕`)

---

## 3. Gantt Grid & Interactive Mechanics

### 3.1 Time Column Grid
- **Columns**: Hourly ticks (8:00 AM to 8:00 PM = 12 columns by default).
- **Sub-grid**: 15-minute snapping guide lines (9:00, 9:15, 9:30, 9:45).

### 3.2 Task Rows
- **Left Sidebar**: Task checkbox and task title (truncated with ellipsis if long).
- **Right Bar Track**: Timeline bar indicating task execution block.

### 3.3 Smart Time Slot Auto-Allocation
When a task has no explicit `startTime` or `endTime`:
- The first task is assigned `09:00` to `10:00`.
- Subsequent tasks are assigned consecutive 1-hour slots (`10:00` - `11:00`, `11:00` - `12:00`, etc.).
- Slots wrap cleanly around lunch (`12:00` - `13:00`) or continue sequentially up to end of day.

### 3.4 Drag & Resize Behaviors
- **Drag Bar Body**: Shifts task start and end times together while preserving duration. Snaps to 15-minute increments.
- **Drag Right Edge**: Resizes task end time (min duration: 15 minutes).
- **Persistence**: Mouse release or drag end saves updated `startTime` and `endTime` back to task object and persists via `saveCurrentDateData()`.

### 3.5 Visual State Representation
- **Pending Tasks**: Warm golden amber gradient (`linear-gradient(135deg, #d97706, #b45309)`), 2px rounded corners, subtle shadow.
- **Completed Tasks**: Emerald green gradient (`linear-gradient(135deg, #059669, #047857)`), line-through text, checkmark badge.

---

## 4. Data Model Extension

Each task item in `currentTasks` array is extended with time fields:
```json
{
  "id": "t_1722700000000_a1b2",
  "text": "Review budget proposals",
  "completed": false,
  "startTime": "09:00",
  "endTime": "10:00"
}
```

Backward compatibility is guaranteed: missing `startTime` and `endTime` values are automatically populated dynamically during Gantt chart rendering.

---

## 5. Security & Scope Boundaries
- Operates entirely within `To-do.html` local DOM and state management.
- Fully compatible with `processTaskRollover` (rolled over tasks retain or recalculate time slots cleanly).
- Zero external dependencies required.
