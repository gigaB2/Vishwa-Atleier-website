# Task 2 Brief: Ensure Uniform Desktop PDF Export in Costing Sheet (`weaving-costing.html` & `yarn-costing.html`)

## Task Description
Enforce fixed desktop width (1200px) during PDF export generation in `runCostingPdfExport` across both `modules/weaving/weaving-costing.html` and `modules/yarn/yarn-costing.html` so exported PDFs are identical regardless of the user's viewport width (mobile/tablet/desktop).

## Files to Modify
- `modules/weaving/weaving-costing.html`
- `modules/yarn/yarn-costing.html`

## Steps
1. In `modules/weaving/weaving-costing.html`:
   - Update `.printable-offscreen-wrapper.yc-pdf-exporting` CSS rule to set explicit `width: 1200px !important; min-width: 1200px !important; max-width: 1200px !important;`.
   - Update `runCostingPdfExport` function so `wrapper.style.width = '1200px'; wrapper.style.minWidth = '1200px'; wrapper.style.maxWidth = '1200px';` during export.
2. Repeat exact changes in `modules/yarn/yarn-costing.html`.
3. Commit changes with message: `fix: enforce desktop width layout in costing sheet PDF exports across viewports`.
4. Write report to `C:\Users\Admin\Desktop\work\main\.superpowers\task-2-report.md`.
