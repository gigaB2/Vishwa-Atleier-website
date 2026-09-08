# Yarn Ledger 2 Decimal Places Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce strict 2-decimal places formatting on Final Bill and Net Balance columns across desktop spreadsheet, mobile cards, party statement modal, challan modal, and CSV exports in `yarn-ledger.html`.

**Architecture:** Update `computeRowFinancials()` to produce strictly rounded 2-decimal numbers for `finalBill` and `netBalance`. Ensure `formatCurrency()` returns exact 2 fraction digits for all values, and ensure `exportToCSV()` formats `finalBill` and `netBalance` with `.toFixed(2)`.

**Tech Stack:** HTML5, Vanilla JavaScript, CSS

## Global Constraints
- Target file: `management suite/modules/yarn/yarn-ledger.html`
- Do not break existing Supabase syncing, column freeze, or table sorting logic.
- Follow existing formatting patterns without introducing runtime errors.

---

### Task 1: Update Computation and Formatting Precision in `yarn-ledger.html`

**Files:**
- Modify: `c:/Users/Admin/Desktop/Websi/Website/management suite/modules/yarn/yarn-ledger.html`

**Interfaces:**
- Consumes: `row.grandTotal`, `row.paidAmount`, `row.actualAdjustment`, `row.roundOff`
- Produces: `computeRowFinancials(row).finalBill` (number with 2 decimals), `computeRowFinancials(row).netBalance` (number with 2 decimals), `formatCurrency(num)` (string with ₹ and 2 decimals), `exportToCSV()` (string with 2 decimals)

- [ ] **Step 1: Update `computeRowFinancials` and `formatCurrency` in `yarn-ledger.html`**

Ensure `finalBill` is computed as `Math.max(0, Number((grandTotal + effectiveAdjAmount).toFixed(2)))` and `netBalance` as `Math.abs(rawNet) <= 0.005 ? 0 : Number(rawNet.toFixed(2))`.
Ensure `formatCurrency` cleanly handles NaN, 0, and finite numbers with `minimumFractionDigits: 2, maximumFractionDigits: 2`.

- [ ] **Step 2: Update `exportToCSV` in `yarn-ledger.html`**

Ensure `comp.finalBill.toFixed(2)` and `comp.netBalance.toFixed(2)` are used when assembling CSV rows.

- [ ] **Step 3: Verification**

Verify syntax and run browser/manual verification to ensure:
- Desktop table renders Final Bill and Net Balance as `₹ X,XX,XXX.XX`
- Mobile cards render Final Bill and Net Balance as `₹ X,XX,XXX.XX`
- Party Statement modal and print view display `₹ X,XX,XXX.XX`
- CSV export contains `1234.50` style 2-decimal values.
