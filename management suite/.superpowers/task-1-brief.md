# Task 1 Brief: Hide Salary Sheet Top Navigation Tabs on Mobile & Tablet Viewports (<= 1024px)

## Task Description
Hide the `.tabs.salary-tabs` element in `modules/salary-sheet.html` when screen width is <= 1024px so tablet and mobile users rely exclusively on the sidebar navigation.

## Files to Modify
- `modules/salary-sheet.html`

## Global Constraints
- Target viewport: `<= 1024px`
- Do not affect desktop tab navigation (> 1024px)

## Steps
1. Edit `modules/salary-sheet.html` around `@media (max-width: 1024px)`.
2. Add rule:
```css
body .tabs.salary-tabs {
  display: none !important;
}
```
3. Commit with message: `style: hide top tabs on mobile and tablet viewports in salary sheet`.
