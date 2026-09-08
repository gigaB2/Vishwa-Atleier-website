# Design Spec: 2 Decimal Places for Final Bill and Net Balance in Yarn Ledger

- **Date**: 2026-09-08
- **Topic**: Enforcing 2 Decimal Places on Final Bill and Net Balance Columns & Exports in Yarn Ledger
- **Status**: Approved

## 1. Overview
Ensure that all instances of **Final Bill** and **Net Balance** calculations, displays (spreadsheet grid, mobile cards, party statements, challan modal), and CSV exports in `management suite/modules/yarn/yarn-ledger.html` strictly display and preserve 2 decimal places without rounding errors, scientific notation, or dropped trailing zeros.

---

## 2. Architecture & Precision Layer

### 2.1 Financial Computation (`computeRowFinancials`)
- **Grand Total**: `Number(row.grandTotal) || 0`
- **Effective Adjustment**: `Number(Number(effectiveAdjAmount).toFixed(2))`
- **Round Off**: `Number(Number(roundOff).toFixed(2))`
- **Final Bill Amount**:
  ```javascript
  const finalBill = Math.max(0, Number((grandTotal + effectiveAdjAmount).toFixed(2)));
  ```
- **Net Balance Calculation**:
  ```javascript
  const rawNet = (finalBill + roundOff) - paid;
  const netBalance = Math.abs(rawNet) <= 0.005 ? 0 : Number(rawNet.toFixed(2));
  ```
- **Return Values**:
  - `finalBill`: numeric float rounded to 2 decimal places.
  - `netBalance`: numeric float rounded to 2 decimal places.
  - `netOutstanding`: numeric alias for `netBalance`.
  - `principalOutstanding`: numeric alias for `netBalance`.
  - `netBilled`: numeric alias for `finalBill`.

### 2.2 Currency Formatter (`formatCurrency`)
- Guarantees strict Indian Rupee formatting with exact 2 decimal places:
  ```javascript
  function formatCurrency(num) {
    let val = Number(num);
    if (isNaN(val) || Math.abs(val) <= 0.005) {
      val = 0;
    }
    return '₹ ' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  ```

---

## 3. UI & Export Consistency

### 3.1 Spreadsheet Table & Dynamic Cell Updaters
- Grid Row Elements:
  - `.col-val-final-bill`: `formatCurrency(comp.finalBill)`
  - `.col-val-net-balance`: `formatCurrency(comp.netBalance)`
- Single-row DOM updater `updateRowDOM(rowId)` preserves identical formatting.

### 3.2 Mobile Restructured Cards
- Mobile Card Highlights:
  - `Final Bill`: `formatCurrency(comp.finalBill)`
  - `Net Balance` / `Balance Due`: `comp.netBalance > 0 ? formatCurrency(comp.netBalance) : 'Settled'`
  - Drawer Detail breakdown: `formatCurrency(comp.finalBill)` and `formatCurrency(comp.netBalance)`.

### 3.3 Party Statement Modal & Printouts
- Statement Rows:
  - Final Bill cell: `formatCurrency(comp.finalBill)`
  - Net Balance cell: `formatCurrency(comp.netBalance)`
- Statement Totals Footer:
  - `totalFinalBill`: accumulated 2-decimal floats, rendered via `formatCurrency(totalFinalBill)`.
  - `totalNetBal`: accumulated 2-decimal floats, rendered via `formatCurrency(totalNetBal)`.

### 3.4 CSV Export (`exportToCSV`)
- Export values formatted with `.toFixed(2)` for numeric precision in Excel/spreadsheets:
  - `comp.finalBill.toFixed(2)`
  - `comp.netBalance.toFixed(2)`

---

## 4. Verification Plan
1. **Spreadsheet Grid Verification**: Inspect table cells to verify values with trailing zeroes (e.g., `.50`, `.00`) display correctly as `₹ 1,500.50` and `₹ 0.00`.
2. **Mobile Card Verification**: Verify mobile card preview and drawer reflect 2 decimals.
3. **Party Statement Modal**: Verify individual row columns and footer grand totals show 2 decimal places.
4. **CSV Export Check**: Verify generated CSV contains exact 2-decimal numbers (e.g. `1234.50`) for Final Bill and Net Balance columns.
