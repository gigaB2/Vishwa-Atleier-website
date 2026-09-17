# Audit implementation roadmap

Started 2026-09-17. Changes are local; production deployment is a separate step.
The existing user edits to yarn-ledger.html are preserved.

## Batch 1 — ledger regression repairs

Implemented:
- Preserve successful empty cloud arrays/objects instead of substituting stale caches.
- Centralize loader fallback so downstream ingestion does not reintroduce cached rows.
- Use newer remote financial fields, preserving explicit zero values.
- Update credit terms using exact source keys/IDs; refuse missing or ambiguous matches.
- Add regression tests executing functions extracted from the shipped HTML and include them in the master runner.

Remaining ledger work:
- Durable pending-write/revision tracking; reconcile already-loaded local rows and deletion markers without losing unsaved edits.
- Credit-term reset/conflict semantics and duplicate credit-term save calls.
- Historical duplicate/incorrect-liability reconciliation; never automatically discard payment history.
- Accurate pending/offline/cloud-confirmed save status.
- Transactional box issuance with full-selection validation and rollback.

## Batch 2 — receipt and supplier isolation

Implemented locally:
- Unreceived orders and empty receipt batches no longer borrow ordered quantities to create liabilities.
- Explicit order-level received quantities are accepted; zero is preserved.
- Supplier-specific challan matching prevents cross-supplier row merges, suppression and rate borrowing in covered paths.
- Added structured batch-read results distinguishing failure from successful absence; ledger uses cached fallback on failure only when this API is available.
- Batch reads use session-aware authentication headers; the existing map-returning API remains available for older callers.
- Added read-only deployment inventory SQL and recovery/security rollout instructions under `management suite/ops/`.

Validation: 19 production-function/API/syntax regression checks pass; master runner passes.
Only a live project is available. No production database or deployment changes have been made.
Existing in-memory row merges, durable offline queues and historical data repair remain separate work.

## Recovery baseline — before production changes

- Inspect deployed grants, policies, RPCs, auth configuration and private storage access.
- Obtain a database/media backup independently of Settings export; restore to isolated staging.
- Verify row counts, relationships and attachments; document recovery procedure.
- Agree and encode admin/operator/viewer/payroll permission matrix.

Gate: verified recovery and staging fixtures before production migrations.

## Security

- Remove default/local credentials and legacy authentication fallback.
- Enforce verified sessions and default-deny permissions.
- Use trusted server roles rather than editable user metadata.
- Restrict tables, storage and privileged functions; derive audit actors server-side and make audit records append-only.
- Change anonymous bearer requests to authenticated requests in coordination with policies.
- Replace unsafe HTML interpolation and introduce compatible security headers.

Gate: anonymous/role-negative direct API tests plus authorized workflow tests. Coordinate client and policy rollout; maintain rollback instructions.

## Backup and restore

- Versioned export of cloud records, required local/IndexedDB state, and attachments; exclude credentials/tokens.
- Validate schema and references before any replacement.
- Stage restore, await every operation, verify results, and support rollback.
- Failure injection and complete restore tests on populated staging data.

## Public website

- Compress videos, add lightweight posters and defer nonessential media.
- Compile production CSS; remove browser Tailwind dependency.
- Implement reliable inquiry delivery, spam controls and delivery feedback.
- Correct category presets and carry selected collection/SKU into inquiries.
- Add quote/sample actions in catalog details.
- Fix dialog hidden state, focus containment/return, keyboard interaction and reduced-motion handling.
- Simplify crowded navigation and substantiate certification/export claims.

Gate: desktop/mobile inquiry and accessibility checks; compare measured performance before/after. Select lead delivery destination before implementing its integration.

## Maintenance and release

- Extract business logic gradually into directly testable modules.
- Expand behavioral/database/browser coverage and include relevant tests in CI.
- Replace browser Babel/development React with a production build.
- Update setup, permission, recovery and deployment documentation.
- Release in small batches with staging sign-off, rollback and post-release checks.

No production database security, backup recovery, or deployment is claimed complete by the local ledger fixes.
