const assert = require('assert');
const fs = require('fs');

console.log('Testing VF_DB interface completeness...');

// Read supabase-client.js
const code = fs.readFileSync('c:\\Users\\Admin\\Desktop\\Websi\\Website\\management suite\\assets\\supabase-client.js', 'utf8');

// Check that all required VF_DB methods exist in the file
const requiredMethods = [
  'isConfigured',
  'fetchTable',
  'upsert',
  'delete',
  'exportFullBackup',
  'migrateAllToRelational',
  // Yarn
  'yarn.getLots',
  'yarn.saveLot',
  'yarn.deleteLot',
  'yarn.issueBoxes',
  'yarn.getOrders',
  'yarn.saveOrder',
  'yarn.deleteOrder',
  'yarn.getProduction',
  'yarn.saveProduction',
  'yarn.deleteProduction',
  'yarn.getSales',
  'yarn.saveSale',
  'yarn.deleteSale',
  'yarn.getQualities',
  'yarn.saveQuality',
  'yarn.deleteQuality',
  'yarn.getFpQualities',
  'yarn.saveFpQuality',
  'yarn.deleteFpQuality',
  'yarn.getSuppliers',
  'yarn.saveSupplier',
  'yarn.deleteSupplier',
  // Weaving
  'weaving.getBeams',
  'weaving.saveBeam',
  'weaving.deleteBeam',
  'weaving.getBeamLoadings',
  'weaving.saveBeamLoading',
  'weaving.deleteBeamLoading',
  'weaving.getWeftIssues',
  'weaving.saveWeftIssues',
  'weaving.deleteWeftIssue',
  'weaving.getWarpIssues',
  'weaving.saveWarpIssue',
  'weaving.deleteWarpIssue',
  'weaving.getProductionLogs',
  'weaving.saveProductionLog',
  'weaving.deleteProductionLog',
  'weaving.getDispatches',
  'weaving.saveDispatch',
  'weaving.deleteDispatch',
  'weaving.getCutRelations',
  'weaving.saveCutRelation',
  'weaving.getDesigns',
  'weaving.saveDesign',
  'weaving.deleteDesign',
  'weaving.getMachinery',
  'weaving.saveMachinery',
  'weaving.deleteMachinery',
  // Staff
  'staff.getEmployees',
  'staff.saveEmployee',
  'staff.deleteEmployee',
  'staff.getAttendance',
  'staff.saveAttendance',
  'staff.deleteAttendance',
  'staff.getLoans',
  'staff.saveLoan',
  'staff.deleteLoan',
  'staff.getSalarySettlements',
  'staff.saveSalarySettlement',
  'staff.deleteSalarySettlement',
  // Costing
  'costing.getProducts',
  'costing.saveProduct',
  'costing.deleteProduct',
  // Companies
  'companies.getCompanies',
  'companies.saveCompany',
  'companies.deleteCompany',
  // Audit
  'audit.log',
  'audit.getLogs'
];

let missing = 0;
for (const m of requiredMethods) {
  const parts = m.split('.');
  const funcName = parts[parts.length - 1];
  const hasMethod = code.includes(`${funcName}(`) || code.includes(`${funcName}:`);
  if (!hasMethod) {
    console.error(`MISSING method or declaration: ${m}`);
    missing++;
  }
}

if (missing === 0) {
  console.log(`SUCCESS: All ${requiredMethods.length} VF_DB API endpoints verified!`);
} else {
  console.error(`FAILED: ${missing} endpoints missing.`);
  process.exit(1);
}

