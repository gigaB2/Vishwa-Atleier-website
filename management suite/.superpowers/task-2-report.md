# Task 2 Execution Report: Ensure Uniform Desktop PDF Export in Costing Sheet (`weaving-costing.html` & `yarn-costing.html`)

## Executive Summary
Successfully updated `modules/weaving/weaving-costing.html` and `modules/yarn/yarn-costing.html` to lock `.printable-offscreen-wrapper` to a desktop width of `1200px` during PDF export generation in `runCostingPdfExport`. This guarantees that exported PDF files maintain a consistent, un-clipped desktop layout regardless of whether the user triggers the export on desktop, tablet, or mobile viewports.

## Changes Made

### 1. `modules/weaving/weaving-costing.html`
- **CSS Rule Updated**: Added `width: 1200px !important; min-width: 1200px !important; max-width: 1200px !important;` to `.printable-offscreen-wrapper.yc-pdf-exporting`.
- **JavaScript Export Helper Updated**: In `runCostingPdfExport`:
  - Captured `width`, `minWidth`, and `maxWidth` in `prevWrapper`.
  - Set `wrapper.style.width = '1200px'`, `wrapper.style.minWidth = '1200px'`, and `wrapper.style.maxWidth = '1200px'` during PDF generation.
  - Restored `width`, `minWidth`, and `maxWidth` in the cleanup `restore()` callback.

### 2. `modules/yarn/yarn-costing.html`
- **CSS Rule Updated**: Added `width: 1200px !important; min-width: 1200px !important; max-width: 1200px !important;` to `.printable-offscreen-wrapper.yc-pdf-exporting`.
- **JavaScript Export Helper Updated**: In `runCostingPdfExport`:
  - Captured `width`, `minWidth`, and `maxWidth` in `prevWrapper`.
  - Set `wrapper.style.width = '1200px'`, `wrapper.style.minWidth = '1200px'`, and `wrapper.style.maxWidth = '1200px'` during PDF generation.
  - Restored `width`, `minWidth`, and `maxWidth` in the cleanup `restore()` callback.

## Git Commit Details
- **Commit Message**: `fix: enforce desktop width layout in costing sheet PDF exports across viewports`
- **Files Committed**:
  - `modules/weaving/weaving-costing.html`
  - `modules/yarn/yarn-costing.html`

## Status
- **Task Status**: Completed Successfully
