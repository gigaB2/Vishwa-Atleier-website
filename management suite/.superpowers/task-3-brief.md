# Task 3 Brief: Ensure Uniform Desktop PDF Export in Salary Sheet (`salary-sheet.html`)

## Task Description
Enforce fixed desktop width (1200px) during print and PDF export in `modules/salary-sheet.html` so exported PDFs and print outputs are identical across mobile, tablet, and desktop viewports.

## Files to Modify
- `modules/salary-sheet.html`

## Steps
1. Edit `@media print` CSS block in `modules/salary-sheet.html`.
2. Add width locking rules:
```css
@media print {
  html, body, .container {
    width: 1200px !important;
    min-width: 1200px !important;
    max-width: 1200px !important;
  }
}
```
3. Commit with: `fix: enforce desktop width in salary sheet print and pdf export`.
4. Write report to `C:\Users\Admin\Desktop\work\main\.superpowers\task-3-report.md`.
