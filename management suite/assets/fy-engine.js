/**
 * Financial Year (FY) Utility Engine
 * Vishwa Group of Companies Management App
 *
 * Provides helper functions for Indian Financial Year (April 1 to March 31) calculation,
 * date range parsing, and opening stock / carry forward calculations.
 */

(function (global) {
  'use strict';

  /**
   * Helper to parse input into a standard Date object.
   * Handles string 'YYYY-MM-DD', Date objects, timestamps, etc.
   * @param {string|Date|number} dateInput
   * @returns {Date|null}
   */
  function parseToDate(dateInput) {
    if (!dateInput) return null;
    if (dateInput instanceof Date) {
      return isNaN(dateInput.getTime()) ? null : dateInput;
    }
    // Handle string inputs (e.g., 'YYYY-MM-DD' or ISO strings)
    var dateStr = String(dateInput).trim();
    // If 'YYYY-MM-DD', append time component to avoid UTC offset issues in standard JS Date constructor
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      var parts = dateStr.split('-');
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Helper to format a Date object as 'YYYY-MM-DD'.
   * @param {Date} date
   * @returns {string|null}
   */
  function formatDateToISOString(date) {
    if (!date || isNaN(date.getTime())) return null;
    var yyyy = date.getFullYear();
    var mm = String(date.getMonth() + 1).padStart(2, '0');
    var dd = String(date.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  /**
   * Returns 'YYYY-YY' (or 'YYYY-YYYY' if shortFormat is false) for a given date string or Date object.
   * Indian FY runs from April 1 to March 31.
   * Example: '2026-04-01' => '2026-27', '2027-03-31' => '2026-27'.
   *
   * @param {string|Date|number} dateStr
   * @param {boolean} [shortFormat=true] If true returns '2026-27', if false returns '2026-2027'
   * @returns {string|null} Financial Year string (e.g. '2026-27')
   */
  function getFinancialYearForDate(dateStr, shortFormat) {
    var d = parseToDate(dateStr);
    if (!d) return null;

    var useShort = shortFormat !== false; // Default to true (short format '2026-27')
    var year = d.getFullYear();
    var month = d.getMonth() + 1; // 1-indexed: 1 = Jan, 4 = Apr, 12 = Dec

    var startYear, endYear;
    if (month >= 4) {
      startYear = year;
      endYear = year + 1;
    } else {
      startYear = year - 1;
      endYear = year;
    }

    var endStr = useShort ? String(endYear).slice(-2) : String(endYear);
    return startYear + '-' + endStr;
  }

  /**
   * Parses financial year string '2026-2027' or '2026-27' into start and end dates.
   * Returns { start: '2026-04-01', end: '2027-03-31' }.
   * If fyString is 'All', empty, or null, returns { start: null, end: null }.
   *
   * @param {string} fyString
   * @returns {{ start: string|null, end: string|null }}
   */
  function getFYDateRange(fyString) {
    if (!fyString || typeof fyString !== 'string') {
      return { start: null, end: null };
    }

    var trimmed = fyString.trim();
    if (trimmed.toLowerCase() === 'all' || trimmed === '') {
      return { start: null, end: null };
    }

    // Match 'YYYY-YYYY' or 'YYYY-YY'
    var match = trimmed.match(/^(\d{4})\s*[-–/]\s*(\d{2,4})$/);
    if (!match) {
      return { start: null, end: null };
    }

    var startYear = parseInt(match[1], 10);
    var endYearRaw = match[2];
    var endYear;

    if (endYearRaw.length === 2) {
      var startCentury = Math.floor(startYear / 100) * 100;
      endYear = startCentury + parseInt(endYearRaw, 10);
      if (endYear <= startYear) {
        endYear += 100;
      }
    } else {
      endYear = parseInt(endYearRaw, 10);
    }

    var startDate = startYear + '-04-01';
    var endDate = endYear + '-03-31';

    return {
      start: startDate,
      end: endDate
    };
  }

  /**
   * Calculates opening stock / carry forward balance prior to a given start date.
   * Opening Stock = (Initial Stock + Sum of Prior Receipts) - Sum of Prior Issues
   *
   * @param {Object} options
   * @param {Array} [options.receipts=[]] Array of receipt records
   * @param {Array} [options.issues=[]] Array of issue/dispatch records
   * @param {Array} [options.dispatches] Alias for options.issues
   * @param {string|Date} options.startDate Cutoff date (YYYY-MM-DD or Date object). Receipts/issues strictly before this date are included.
   * @param {string} [options.dateField] Custom property name for transaction date (defaults to auto-detecting date/created_at/tx_date)
   * @param {string} [options.qtyField] Custom property name for quantity (defaults to auto-detecting qty/quantity/net_wt/weight/meters)
   * @param {number} [options.initialStock=0] Base initial stock prior to transactions
   * @param {Function} [options.itemFilter] Optional filter callback (item) => boolean to filter relevant transactions
   * @returns {number} Calculated carry-forward stock quantity
   */
  function calculateStockCarryForward(options) {
    if (!options) return 0;

    var receipts = options.receipts || [];
    var issues = options.issues || options.dispatches || [];
    var startDateInput = options.startDate;
    var initialStock = Number(options.initialStock) || 0;
    var customDateField = options.dateField;
    var customQtyField = options.qtyField;
    var itemFilter = typeof options.itemFilter === 'function' ? options.itemFilter : null;

    var startDate = parseToDate(startDateInput);
    if (!startDate) {
      // If no start date given, carry forward is equal to initial stock
      return initialStock;
    }

    // Set time of cutoff start date to midnight (00:00:00.000) for exact date comparison
    var cutoffTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();

    function getItemDate(item) {
      if (!item) return null;
      if (customDateField && item[customDateField]) {
        return parseToDate(item[customDateField]);
      }
      var rawDate = item.date || item.created_at || item.tx_date || item.issue_date || item.receipt_date || item.receiveDate || item.orderDate || item.productionDate || item.timestamp;
      return parseToDate(rawDate);
    }

    function getItemQty(item) {
      if (!item) return 0;
      if (customQtyField && item[customQtyField] !== undefined) {
        return parseFloat(item[customQtyField]) || 0;
      }
      var qty = item.qty !== undefined ? item.qty :
                item.quantity !== undefined ? item.quantity :
                item.net_wt !== undefined ? item.net_wt :
                item.weight !== undefined ? item.weight :
                item.issuedWeight !== undefined ? item.issuedWeight :
                item.net !== undefined ? item.net :
                item.totalWeight !== undefined ? item.totalWeight :
                item.meters !== undefined ? item.meters : 0;
      return parseFloat(qty) || 0;
    }

    var totalPriorReceipts = 0;
    for (var i = 0; i < receipts.length; i++) {
      var r = receipts[i];
      if (itemFilter && !itemFilter(r)) continue;
      var rDate = getItemDate(r);
      if (!rDate && startDate) {
        // Fallback: If date is missing/invalid, consider receipt prior to start date
        totalPriorReceipts += getItemQty(r);
      } else if (rDate) {
        var rTime = new Date(rDate.getFullYear(), rDate.getMonth(), rDate.getDate()).getTime();
        if (rTime < cutoffTime) {
          totalPriorReceipts += getItemQty(r);
        }
      }
    }

    var totalPriorIssues = 0;
    for (var j = 0; j < issues.length; j++) {
      var iss = issues[j];
      if (itemFilter && !itemFilter(iss)) continue;
      var iDate = getItemDate(iss);
      if (!iDate && startDate) {
        // Fallback: If date is missing/invalid, consider issue prior to start date
        totalPriorIssues += getItemQty(iss);
      } else if (iDate) {
        var iTime = new Date(iDate.getFullYear(), iDate.getMonth(), iDate.getDate()).getTime();
        if (iTime < cutoffTime) {
          totalPriorIssues += getItemQty(iss);
        }
      }
    }

    var finalBalance = initialStock + totalPriorReceipts - totalPriorIssues;
    // Round to 4 decimal places to eliminate floating point inaccuracies
    return Math.round(finalBalance * 10000) / 10000;
  }

  /**
   * Automatic Carry Forward Engine
   * Dynamically calculates and caches opening balances for the target financial year
   * based on all transactions prior to target FY start date.
   *
   * @param {string} targetFY E.g. '2026-27'
   * @returns {Object} Calculated opening balances for all modules
   */
  function autoCarryForward(targetFY) {
    if (!targetFY || targetFY === 'All') return null;
    var range = getFYDateRange(targetFY);
    if (!range.start) return null;

    var cutoffDate = range.start;

    // Safe localStorage getItem parser helper
    function getStoredJSON(key, fallback) {
      try {
        if (typeof localStorage === 'undefined') return fallback;
        var data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
      } catch (e) {
        return fallback;
      }
    }

    // 1. Yarn Orders Opening Stock
    var yarnOrders = getStoredJSON('yarn-orders', []);
    var yarnIssuesList = getStoredJSON('yarn-issues', []);
    var activeYarnLots = [];
    var totalYarnWeightKg = 0;
    var totalYarnBags = 0;

    yarnOrders.forEach(function(order) {
      var oDate = order.orderDate || (order.createdAt ? String(order.createdAt).split('T')[0] : null);
      if (!oDate || oDate < cutoffDate) {
        var unissuedKg = calculateStockCarryForward({
          receipts: order.batches || [],
          issues: yarnIssuesList,
          startDate: cutoffDate,
          qtyField: 'weight'
        });

        if (unissuedKg > 0 || !oDate) {
          activeYarnLots.push(order);
          totalYarnWeightKg += unissuedKg;
          totalYarnBags += (parseFloat(order.bags) || 0);
        }
      } else {
        activeYarnLots.push(order);
      }
    });

    // 2. Order Book Carry-Forward Logic
    var activeOrdersCount = 0;
    var pendingOrdersCount = 0;
    var carriedForwardOrders = [];
    yarnOrders.forEach(function(order) {
      var oDate = order.orderDate || (order.createdAt ? String(order.createdAt).split('T')[0] : null);
      var status = (order.status || 'Active').toLowerCase();
      if (!oDate || oDate < cutoffDate) {
        if (status !== 'completed' && status !== 'cancelled' && status !== 'closed') {
          activeOrdersCount++;
          if (status === 'pending') pendingOrdersCount++;
          carriedForwardOrders.push(order);
        }
      } else {
        activeOrdersCount++;
        if (status === 'pending') pendingOrdersCount++;
      }
    });

    // 3. Raw Material Warp Stock Book Carry-Forward Logic
    var warpIssuesList = getStoredJSON('warp-issues', []);
    var warpBeamsList = getStoredJSON('warp-beams', []);
    var warpCarriedForwardOrders = [];
    var warpPriorUnissuedKg = 0;

    yarnOrders.forEach(function(order) {
      var oDate = order.orderDate || (order.createdAt ? String(order.createdAt).split('T')[0] : null);
      if (!oDate || oDate < cutoffDate) {
        var orderBatches = order.batches || [];
        var unissuedWarpKg = calculateStockCarryForward({
          receipts: orderBatches,
          issues: warpIssuesList,
          startDate: cutoffDate,
          qtyField: 'weight',
          itemFilter: function(item) {
            return !item.quality || item.quality === order.quality;
          }
        });
        if (unissuedWarpKg > 0 || !oDate) {
          warpCarriedForwardOrders.push(order);
          warpPriorUnissuedKg += unissuedWarpKg;
        }
      } else {
        warpCarriedForwardOrders.push(order);
      }
    });

    var warpPriorBeamsCount = 0;
    warpBeamsList.forEach(function(beam) {
      var bDate = beam.createdAt ? String(beam.createdAt).split('T')[0] : (beam.date || null);
      if (!bDate || bDate < cutoffDate) {
        warpPriorBeamsCount++;
      }
    });

    // 4. Raw Material Weft Stock Book Carry-Forward Logic
    var weftOrders = yarnOrders.filter(function(o) {
      return o.type && String(o.type).trim().toLowerCase() === 'weft';
    });
    var weftBoxesCarriedForwardCount = 0;
    var weftOpeningStockKg = 0;
    var weftOpeningStockCones = 0;

    weftOrders.forEach(function(order) {
      (order.batches || []).forEach(function(batch) {
        var arrivalDate = batch.receiveDate || order.orderDate || (order.createdAt ? String(order.createdAt).split('T')[0] : null);
        if (!arrivalDate || arrivalDate < cutoffDate) {
          (batch.boxes || []).forEach(function(box) {
            var weight = parseFloat(box.weight) || 0;
            var retWeight = parseFloat(box.returnedWeight) || 0;
            var inCones = parseInt(box.cones, 10) || 0;
            var grCones = (retWeight && weight && inCones) ? Math.round(retWeight / (weight / inCones)) : 0;
            var kgPerCone = inCones > 0 ? weight / inCones : 0;
            var grWeight = grCones * kgPerCone;
            var netInKg = weight - grWeight;
            var netInCones = inCones - grCones;

            var boxIssuesBefore = yarnIssuesList.filter(function(i) {
              var iDate = i.date || (i.createdAt ? String(i.createdAt).split('T')[0] : null);
              return (!iDate || iDate < cutoffDate) &&
                     i.quality === order.quality &&
                     (!i.supplier || i.supplier === order.supplier) &&
                     i.code === order.code &&
                     i.box === box.boxNumber &&
                     i.challan === batch.challanNumber;
            });

            var issuedKgBefore = boxIssuesBefore.reduce(function(s, i) { return s + (parseFloat(i.net) || 0); }, 0);
            var issuedConesBefore = boxIssuesBefore.reduce(function(s, i) { return s + (parseInt(i.cones, 10) || 0); }, 0);

            var remKg = Math.max(0, netInKg - issuedKgBefore);
            var remCones = Math.max(0, netInCones - issuedConesBefore);

            if (remKg > 0 || remCones > 0) {
              weftBoxesCarriedForwardCount++;
              weftOpeningStockKg += remKg;
              weftOpeningStockCones += remCones;
            }
          });
        }
      });
    });

    // 5. Salary Sheet Carry-Forward Logic
    var salaryState = getStoredJSON('aethertasks_db_state_v7', {});
    var salaryPayments = salaryState.salaryPayments || {};
    var loansList = salaryState.loans || [];
    var totalPriorAdvances = 0;
    var totalPriorLoanDeductions = 0;
    var activeLoansCount = 0;
    var totalRemainingLoanBalance = 0;

    Object.keys(salaryPayments).forEach(function(mKey) {
      if (mKey < cutoffDate.slice(0, 7)) {
        var empPayments = salaryPayments[mKey] || {};
        Object.keys(empPayments).forEach(function(empName) {
          var pm = empPayments[empName] || {};
          totalPriorAdvances += parseFloat(pm.advance) || 0;
          totalPriorLoanDeductions += parseFloat(pm.loan) || 0;
        });
      }
    });

    loansList.forEach(function(loan) {
      var lAmount = parseFloat(loan.amount) || 0;
      var totalDeducted = 0;
      Object.keys(salaryPayments).forEach(function(mKey) {
        if (mKey < cutoffDate.slice(0, 7)) {
          var pm = (salaryPayments[mKey] && salaryPayments[mKey][loan.employeeName]) || {};
          totalDeducted += parseFloat(pm.loan) || 0;
        }
      });
      var remLoan = Math.max(0, lAmount - totalDeducted);
      if (remLoan > 0) {
        activeLoansCount++;
        totalRemainingLoanBalance += remLoan;
      }
    });

    // 6. Spare Parts Opening Stock
    var machineParts = getStoredJSON('vf_machine_parts', []);
    var machinePartsLogs = getStoredJSON('vf_machine_parts_logs', []);
    var sparePartsBalances = machineParts.map(function(part) {
      var openingQty = calculateStockCarryForward({
        receipts: [part],
        issues: machinePartsLogs,
        startDate: cutoffDate,
        qtyField: 'quantity',
        itemFilter: function(log) { return log.partId === part.id; }
      });
      return {
        partId: part.id,
        partName: part.name,
        openingQty: Math.max(0, openingQty)
      };
    });

    var summary = {
      targetFY: targetFY,
      cutoffDate: cutoffDate,
      yarn: {
        activeLotCount: activeYarnLots.length,
        totalWeightKg: Math.round(totalYarnWeightKg * 100) / 100,
        totalBags: Math.round(totalYarnBags * 100) / 100
      },
      orderBook: {
        totalActiveOrders: activeOrdersCount,
        pendingOrders: pendingOrdersCount,
        carriedForwardOrdersCount: carriedForwardOrders.length
      },
      rawMaterialWarp: {
        activeOrdersCount: warpCarriedForwardOrders.length,
        priorUnissuedKg: Math.round(warpPriorUnissuedKg * 100) / 100,
        priorBeamsCount: warpPriorBeamsCount
      },
      rawMaterialWeft: {
        carriedForwardBoxesCount: weftBoxesCarriedForwardCount,
        totalOpeningStockKg: Math.round(weftOpeningStockKg * 100) / 100,
        totalOpeningStockCones: weftOpeningStockCones
      },
      salarySheet: {
        priorAdvances: Math.round(totalPriorAdvances * 100) / 100,
        priorLoanDeductions: Math.round(totalPriorLoanDeductions * 100) / 100,
        activeLoansCount: activeLoansCount,
        remainingLoanBalance: Math.round(totalRemainingLoanBalance * 100) / 100
      },
      spareParts: sparePartsBalances,
      computedAt: new Date().toISOString()
    };

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('vishwa_fy_auto_opening_' + targetFY, JSON.stringify(summary));
      }
    } catch(e) {}

    return summary;
  }

  /**
   * Alias for calculateStockCarryForward
   */
  function calculateOpeningStock(options) {
    return calculateStockCarryForward(options);
  }

  // Export to window.FYEngine
  var FYEngine = {
    getFinancialYearForDate: getFinancialYearForDate,
    getFYDateRange: getFYDateRange,
    calculateStockCarryForward: calculateStockCarryForward,
    calculateOpeningStock: calculateOpeningStock,
    autoCarryForward: autoCarryForward
  };

  global.FYEngine = FYEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FYEngine;
  }
})(typeof window !== 'undefined' ? window : this);

