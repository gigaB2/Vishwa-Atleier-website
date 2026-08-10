# Mobile To-Do Page Redesign Specification (320px – 425px)

## 1. Overview & Objective
Redesign the **Digital Book Planner / To-Do App** (`To-do.html`) for small mobile viewports (320px to 425px width, covering iPhone SE, iPhone mini, standard iPhones, Google Pixel, and Samsung Galaxy devices). 

Transition from the side-by-side / single-tab toggle view to a **Vertical Scrolling Dual Card Stack**. Both **Daily Action Tasks** and **Thoughts & Notes** are presented sequentially within an authentic continuous leather binder frame while ensuring touch targets and ergonomics meet Apple HIG standards.

---

## 2. Responsive Layout & Component Specs

### 2.1 Viewport & Background Adjustments
- **Viewport**: Scaled for `320px` to `425px` screens with safe-area insets (`env(safe-area-inset-*)`).
- **Body Padding**: Dynamic padding (`padding: 10px 6px` on 375px–425px; `padding: 8px 4px` on 320px).
- **Overflow**: `overflow-x: hidden` to eliminate horizontal scrollbar drift.

### 2.2 Mobile Header Banner (`.book-header-banner`)
- **Structure**: 2-row layout inside a dark leather glassmorphic container (`background: rgba(35, 28, 24, 0.94)`, `backdrop-filter: blur(12px)`, `border-radius: 14px`).
- **Row 1 - Date Trigger Badge (`.date-badge-trigger`)**:
  - Spans `100%` width.
  - Centered date display (`Space Grotesk` font, `14px` bold, `#faf7f0`).
  - Includes calendar icon and hidden native date input overlay for seamless tap-to-pick.
- **Row 2 - Date Navigation Controls (`.nav-actions-right`)**:
  - 3-column flex grid (`gap: 6px`) containing `◀ Prev`, `Today`, `Next ▶`.
  - Buttons meet `44px` minimum touch target height with `12px` font size and subtle tap active states.

### 2.3 Stacked Dual-Page Book Container (`.book` & `.pages-spread`)
- **Outer Leather Frame (`.book`)**:
  - Continuous leather texture wrapper surrounding both pages.
  - Border radius `12px`, padding `8px`, deep shadow `0 8px 24px rgba(0,0,0,0.4)`.
- **Page Spread Flex Direction (`.pages-spread`)**:
  - Styled as `flex-direction: column` with `gap: 16px` on screens `≤ 425px`.
  - Displays both Page 1 and Page 2 visible in vertical scroll order.
- **Stitched Spine Divider (`.mobile-spine-divider`)**:
  - A subtle horizontal paper crease divider (`border-top: 1px dashed rgba(139, 90, 43, 0.3)`, `margin: 12px 0`) separating the two pages.

### 2.4 Page 1: Daily Action Tasks (`.left-page`)
- **Header**: Flex layout with section title (`Daily Action Tasks`, `16px` Space Grotesk) and task counter badge (`X / Y Done`).
- **Add Task Form (`.add-task-form`)**:
  - Flex row with `gap: 8px`.
  - Input field (`.task-input`): `44px` height, `16px !important` font size to prevent iOS Safari auto-zoom.
  - Add button (`.add-task-btn`): `44px` height, `44px` minimum width, bold text, dark brown hover background (`var(--accent-brown)`).
- **Task List & Items (`.task-item`)**:
  - `min-height: 48px`, padding `10px 10px`, background `rgba(255,255,255,0.85)` with 8px radius.
  - Custom checkbox: `22px × 22px` touch area.
  - Task text: `15px` font size with line-through on completed.
  - Delete button: `44px × 44px` tap target with trash icon / text and red hover highlight.

### 2.5 Page 2: Thoughts & Notes (`.right-page`)
- **Header**: Flex layout with title (`Thoughts & Notes`, `16px` Space Grotesk) and real-time save indicator (`Saved ✓`).
- **Notebook Paper Canvas (`.notebook-textarea`)**:
  - Red margin line inset at `20px` (adjusted for narrow 320px–425px screens).
  - Blue line background (`repeating-linear-gradient` with 26px line height).
  - Textarea font size `16px !important` (prevents iOS auto-zoom while maintaining handwritten Caveat font aesthetic).
  - Minimum height `320px`.

---

## 3. Micro-Interactions & Accessibility
- **Touch Targets**: All interactive buttons, checkboxes, and form inputs guarantee `≥ 44px` touch height according to Apple HIG and WCAG guidelines.
- **Animations**: Smooth cross-fade transition when changing dates; subtle checkbox scale effect on check/uncheck.
- **Color Contrast**: Main paper text (`#2c2925`) on cream paper (`#faf7f0`) exceeds 7:1 contrast ratio.

---

## 4. Verification Plan
- Validate layout on 320px width (iPhone SE 1st gen / smallest Androids).
- Validate layout on 375px width (iPhone SE 2nd/3rd gen, iPhone X/XS/11 Pro/12 mini/13 mini).
- Validate layout on 390px / 393px width (iPhone 12/13/14/15/16).
- Validate layout on 412px / 425px width (Pixel 7/8/9, Galaxy S21/S22/S23/S24).
- Ensure no horizontal scrolling occurs on any viewport width from 320px to 425px.
