# Design Document: PDF Export Consistency & Tablet/Mobile Tab Hiding

## Objectives
1. Ensure PDF export output for Costing Sheet (`weaving-costing.html` and `yarn-costing.html`) and Salary Sheet (`salary-sheet.html`) is 100% identical across all viewports (Mobile, Tablet, Desktop).
2. Completely hide top tab navigation (Dashboard, Karigar, Staff, Beams, Loans) in `salary-sheet.html` on screens `<= 1024px` (Tablet and Mobile), delegating navigation exclusively to the sidebar.

## Scope & Components Impacted
- `modules/salary-sheet.html`
- `modules/weaving/weaving-costing.html`
- `modules/yarn/yarn-costing.html`

## Technical Details

### 1. PDF Export Uniformity
- **Costing Sheet (`runCostingPdfExport` in `weaving-costing.html` & `yarn-costing.html`)**:
  - Apply temporary desktop dimensions (`width: 1200px`) to `.printable-offscreen-wrapper` during `yc-pdf-exporting` execution.
  - Reset styles cleanly upon completion of `html2pdf` rendering.
- **Salary Sheet (`salary-sheet.html`)**:
  - Standardize `@media print` rules to enforce desktop layout, full widths, and table columns regardless of current window width.

### 2. Tab Navigation Removal on Tablet & Mobile
- In `salary-sheet.html`, within `@media (max-width: 1024px)`, set `body .tabs.salary-tabs` to `display: none !important;`.
- Ensure sidebar links seamlessly handle section switching for tablet users.

## Self-Review Checklist
- [x] No placeholders or TODOs.
- [x] Clear scope bounded to target files.
- [x] Backwards-compatible without breaking desktop view.
