# Google Sheets Style Bottom Navigation Bar with Drag & Rearrange

## Overview
Redesign the bottom quality tab navigation bar in both **Yarn Costing Sheet** (`modules/yarn/yarn-costing.html`) and **Weaving Costing Sheet** (`modules/weaving/weaving-costing.html`) to replicate the authentic Google Sheets bottom tab bar layout and feature drag-and-drop tab reordering.

## Target Files
1. `modules/yarn/yarn-costing.html`
2. `modules/weaving/weaving-costing.html`

## Features & Specifications

### 1. Visual Design (Google Sheets Style)
- **Footer Container (`yc-quality-footer`)**:
  - Height: `40px` compact sheet layout (down from heavy 64px `h-16`).
  - Background: `#f8f9fa` (light mode) / `#1f2937` (dark mode).
  - Border: Top border `1px solid #dadce0` (`#374151` in dark mode).
- **Left Action Bar**:
  - `+` **Add Sheet Button**: Clean Google Sheets style `+` icon button with subtle rounded hover effect. Clicking adds a new Quality tab to the active costing section.
  - `≡` **Sheet Menu / Quality Search**: Compact sheet switcher dropdown with search filter and quick selection list for all qualities.
  - **Divider**: Vertical line (`1px solid #cbd5e1`).
- **Tab Elements (`yc-quality-footer-scroll`)**:
  - Horizontal flex container with hidden scrollbar / smooth horizontal drag scrolling.
  - **Active Tab**:
    - Background: `#ffffff` (`dark:bg-slate-800`).
    - Top accent line: `2.5px solid #8b5cf6` (or green `#107c41`).
    - Typography: Bold font (`font-bold`), text color `#1e293b`.
    - Shape: Rounded top corners (`rounded-t-md`), border-left `1px solid #dadce0`, border-right `1px solid #dadce0`.
    - Action: Close / delete `✕` icon button on hover/active when total qualities > 1.
  - **Inactive Tabs**:
    - Background: `#e9ecef` (`dark:bg-slate-900`), text `#64748b`.
    - Top accent: Transparent.
    - Right divider: `1px solid #dadce0`.
    - Hover state: `#f1f5f9` (`dark:hover:bg-slate-800`).

### 2. Drag & Rearrange Facility
- Native HTML5 Drag and Drop (`draggable="true"`).
- Event Handlers: `onDragStart`, `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop`, `onDragEnd`.
- Visual Feedback:
  - Dragged tab shows reduced opacity (`opacity-50`).
  - Target insertion location shows vertical indigo drop indicator border (`border-l-4 border-indigo-600`).
- Reorder Logic:
  - Reorders items in `products`, `tfoProducts`, `doublerProducts`, or `coveringProducts` array when dropped.
  - Recalculates and maintains `activeIndex` / `tfoActiveIndex` / `doublerActiveIndex` / `coveringActiveIndex` so the currently selected item remains selected.
  - Automatically saves the updated order to `localStorage`.

### 3. Scope of Application
Applied to all 4 costing sections in both modules:
- Main Fabric Quality Costing (`products`)
- TFO Costing (`tfoProducts`)
- Doubler Costing (`doublerProducts`)
- Covering Costing (`coveringProducts`)

## Verification Criteria
1. Bottom bar stays fixed at the bottom with 40px sheet-like height.
2. Styling matches Google Sheets tabs across light and dark themes.
3. Tabs can be dragged left/right to reorder quality sheets.
4. Active quality tab stays selected and intact after reordering.
5. `+` button creates new quality sheets; `≡` dropdown filters and switches sheets.
6. All existing costing calculation logic, formulas, imports, and exports remain 100% functional.
