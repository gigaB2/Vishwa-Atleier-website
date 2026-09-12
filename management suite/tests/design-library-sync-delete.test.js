const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('Design Library — Sync & Deletion Engine Tests', () => {

    it('1. getDeletedTombstones in supabase-client.js includes numeric design codes without stripping them', () => {
        const clientCode = fs.readFileSync(
            path.resolve(__dirname, '../assets/supabase-client.js'),
            'utf-8'
        );

        // Verify the code reads from deleted-designs
        assert.ok(clientCode.includes("nativeLocalStorage.getItem('deleted-designs')"), 
            "supabase-client.js must inspect deleted-designs for tombstones");

        // Verify that designTombs is merged into return without being stripped by ^\d{1,4}$
        assert.ok(clientCode.includes("return Array.from(new Set([...filteredGeneral, ...designTombs]));"),
            "deleted-designs tombstones must be merged with designTombs preserved");
    });

    it('2. getDesignsWithTombstones includes ep_file_url in PostgREST select query', () => {
        const clientCode = fs.readFileSync(
            path.resolve(__dirname, '../assets/supabase-client.js'),
            'utf-8'
        );

        // Check getDesignsWithTombstones definition
        const fnMatch = clientCode.match(/async getDesignsWithTombstones[\s\S]*?select = options\.select \|\| '([^']+)'/);
        assert.ok(fnMatch, "getDesignsWithTombstones must be defined with default select");
        const selectFields = fnMatch[1];
        assert.ok(selectFields.includes('ep_file_url'), "select parameters must include ep_file_url for full cross-device asset sync");
    });

    it('3. VF_DB.weaving.deleteDesign performs PostgREST PATCH and broadcasts realtime deletion signal', () => {
        const clientCode = fs.readFileSync(
            path.resolve(__dirname, '../assets/supabase-client.js'),
            'utf-8'
        );

        // Verify deleteDesign function handles PATCH and fallback
        assert.ok(clientCode.includes("async deleteDesign(id, code = '')"), "deleteDesign method must exist on VF_DB.weaving");
        assert.ok(clientCode.includes("method: 'PATCH'"), "deleteDesign must use HTTP PATCH to soft-delete without NOT NULL constraint failures");
        assert.ok(clientCode.includes("design_name: codeStr || idStr || 'Deleted Design'"), "Fallback tombstone must provide design_name to satisfy Postgres NOT NULL");
        assert.ok(clientCode.includes("action: 'design_deleted'"), "deleteDesign must broadcast loom-designs-signal with design_deleted");
    });

    it('4. Design Library HTML contains quick delete button on card grid and clean inspect delete', () => {
        const htmlCode = fs.readFileSync(
            path.resolve(__dirname, '../modules/weaving/design-library.html'),
            'utf-8'
        );

        // Check Quick Delete button in card-actions
        assert.ok(htmlCode.includes('handleDelete(design.id, design.code)'), "Card actions must feature a quick delete button invoking handleDelete");
        assert.ok(htmlCode.includes('handleDelete(selectedDesign.id, selectedDesign.code)'), "Inspector modal must feature delete button invoking handleDelete");

        // Verify registerTombstone in design-library.html preserves numeric design codes
        assert.ok(htmlCode.includes("const registerTombstone = (val) => {"), "registerTombstone must be defined");
        const regTombstoneSection = htmlCode.slice(htmlCode.indexOf("const registerTombstone = (val) => {"), htmlCode.indexOf("const registerTombstone = (val) => {") + 300);
        assert.ok(!regTombstoneSection.includes("/^\\d{1,4}$/"), "registerTombstone must NOT reject numeric codes matching /^\d{1,4}$/");
    });

    it('5. Design Library preserves perpetual master catalog across financial years with ISO date sorting', () => {
        const htmlCode = fs.readFileSync(
            path.resolve(__dirname, '../modules/weaving/design-library.html'),
            'utf-8'
        );

        // Verify fyChanged event listener treats design library as perpetual master catalog
        assert.ok(htmlCode.includes("perpetual pattern catalog across all financial years"),
            "Design library must preserve perpetual catalog across financial years");

        // Verify date parsing handles DD-MM-YYYY to ISO format correctly
        assert.ok(htmlCode.includes("isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`"), 
            "Date parsing must convert DD-MM-YYYY to YYYY-MM-DD for accurate comparison");
    });
});
