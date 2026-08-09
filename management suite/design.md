# Vishwa Fashions — Enterprise Portal Design System

This document outlines the design language, component architecture, styling conventions, and responsive engineering standards used across the **Vishwa Group of Companies Management Suite**. Use this specification to ensure visual consistency and UI/UX excellence across Mobile, Tablet, and Laptop/Desktop viewports.

---

## 1. Typography & Type System

- **Display & Heading Font:** `Space Grotesk` (Google Fonts) & `Outfit`
  - Used for primary page titles, brand logos, numerical KPI displays, and section headers.
  - Weights: `400` (Regular), `500` (Medium), `600` (SemiBold), `700` (Bold).
- **Body & Interface Font:** `Inter` (Google Fonts)
  - Used for body copy, form inputs, table data, badges, and dropdown menus.
  - Weights: `400` (Regular), `500` (Medium), `600` (SemiBold).
- **Monospace Font:** `JetBrains Mono`
  - Used for financial totals, batch IDs, yarn code identifiers, and tabular numbers (`font-variant-numeric: tabular-nums`).
- **System Fallback:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif`

---

## 2. Color Palette & Token System

### Base Colors (Light Mode)
| CSS Variable | Hex / Value | Primary Usage |
| :--- | :--- | :--- |
| `--bg` | `#f8f7fc` | Page background gradient start |
| `--surface` | `#ffffff` | Card, container, and modal backgrounds |
| `--fg` | `#1a1a2e` | Primary body text and headers |
| `--muted` | `#8b8fa3` | Secondary text, helper labels, and icons |
| `--border` | `#e8e7f1` | Component borders and dividers |
| `--accent` | `#8b5cf6` | Primary brand purple |
| `--accent2` | `#ec4899` | Secondary brand pink |
| `--accent3` | `#f97316` | Tertiary brand orange / warning |
| `--error` | `--ef4444` | Destructive actions, validation errors |
| `--success` | `#10b981` | Success indicators, positive delta KPI |

### Base Colors (Dark Mode)
| CSS Variable | Hex / Value | Primary Usage |
| :--- | :--- | :--- |
| `--bg` | `#000000` / `#090a0f` | Dark background |
| `--surface` | `#0a0a0a` / `#12141d` | Card & modal background |
| `--fg` | `#ffffff` / `#f8fafc` | Primary text |
| `--muted` | `#a1a1aa` / `#94a3b8` | Muted text & icons |
| `--border` | `#27272a` / `rgba(255,255,255,0.08)` | Dividers & borders |
| `--accent` | `#7c3aed` / `#38bdf8` | Primary accent in dark mode |

### Gradients
- **Primary Accent Gradient:** `linear-gradient(135deg, var(--accent), var(--accent2))`
- **Light Ambient Gradient:** `linear-gradient(135deg, #f8f7fc 0%, #faf5ff 50%, #f0f4ff 100%)`
- **Dark Ambient Gradient:** `linear-gradient(135deg, #090a0f 0%, #0a0a0a 50%, #0f0f1a 100%)`

---

## 3. UI Component Specifications

### Cards & Panels
- **Border Radius:** `16px` (`1.0rem`)
- **Shadow:** `0 4px 16px rgba(0, 0, 0, 0.06)` (`--shadow-md`)
- **Hover Lift:** `transform: translateY(-2px)`, shadow elevation increase, top border gradient highlight.

### Buttons & Interactive Controls
- **Primary CTA:** Gradient background (`--accent` to `--accent2`), white text, `10px` border-radius, `0.2s ease` transition.
- **Secondary/Subtle:** Solid surface, `1.5px solid var(--border)` border, hover state changes border to `--accent`.
- **Touch Ergonomics (Apple HIG):** Minimum touch target height and width of `44px × 44px` on viewports `≤1024px`.

### Inputs, Selects & Date Pickers
- **Border Radius:** `10px`
- **Border:** `1.5px solid var(--border)`
- **Focus Glow:** Border transitions to `--accent` with `0 0 0 4px rgba(139, 92, 246, 0.12)`.
- **iOS Safari Auto-Zoom Rule:** Form controls on viewports `≤1024px` MUST declare `font-size: 16px !important;` to prevent unwanted auto-zooming on focus.

### Data Tables
- **Header:** Sticky top, semi-transparent backdrop blur background, `0.85rem` uppercase label.
- **Rows:** Hover highlight with horizontal gradient tint.
- **Mobile Freeze Column:** On screens `≤768px`, the first column (`th:first-child`, `td:first-child`) freezes in place with `position: sticky; left: 0; z-index: 4;` to preserve row context during horizontal scroll.

---

## 4. Cross-Device Responsive Engineering Standards (Mobile, Tablet & Laptop)

### 4.1 Mobile Viewports (Phones: 375px – 640px)
- **Navigation:** Slide-out drawer sidebar (`280px` max-width) triggered via top hamburger button (`.vf-sb-toggle`).
- **Form Layouts:** Single-column stacked form grids (`grid-template-columns: minmax(0, 1fr)`).
- **Tab Bar:** Horizontal smooth touch scrolling (`-webkit-overflow-scrolling: touch`) with scrollbar hidden.
- **Safe Area Insets:** Fixed controls observe `env(safe-area-inset-top)` (Notch / Dynamic Island) and `env(safe-area-inset-bottom)` (Home Indicator).

### 4.2 Tablet Viewports (iPad Portrait & Landscape: 768px – 1024px)
- **KPI Stats Grids:** 2-column layout (`grid-template-columns: repeat(2, minmax(0, 1fr))`) for balanced data density.
- **Sidebar Ergonomics:** Drawer mode active at `≤1024px` to maximize content canvas space for complex ledgers and costing charts.
- **Hybrid Input Support:** Press feedback state for touch/stylus taps while preventing sticky hover states.

### 4.3 Laptop & Desktop Viewports (Laptops: 1025px – 1440px / Monitors: >1440px)
- **Permanent Left Rail Sidebar:** Static left rail (`272px` expanded, `68px` collapsed) with fast `0.2s` width transition.
- **Container Boundaries:** Max container width capped at `1300px` centered with auto margins to avoid ultra-wide text stretching.
- **Multi-Column Dashboard Grids:** 4-column KPI metric cards (`grid-template-columns: repeat(4, 1fr)`) and multi-panel split view for master-detail records.
- **Full Keyboard Navigation:** Tab order focus rings (`2px solid var(--accent)`) and global hotkey shortcuts.

---

## 5. Visual Effects & Animations

- **Transitions:**
  - Fast: `0.15s ease` (Hover, press states)
  - Base: `0.25s ease` (Modal reveals, accordion collapse)
  - Slow: `0.40s ease` (Drawer slide-in)
- **Animations:**
  - `fadeIn`: Content slides up `8px` and fades in on view mount.
  - `slideDown`: Toast notifications enter from top with bounce easing.
  - `pulse`: Soft opacity breathing indicator for active status dots.

---

## 6. Business Module Specifications

### Warp & Weft Stock Books
- **Inventory Synchronization:** Filter `yarn-orders` chronologically by type (`Warp` vs `Weft`).
- **Depletion Logic:** `Closing Stock = Opening Stock + Receipts (In) - Issues`.
- **Date Display Convention:** Regional format `dd-mm-yyyy` in UI, stored as ISO `yyyy-mm-dd` for native input compatibility.
- **Beam Tracker & Timeline:** Split views for Active and Completed beams with interactive vertical event history.
