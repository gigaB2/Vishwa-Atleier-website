# Recovery and security rollout

Only the live Supabase project currently exists (confirmed by the owner).
No production SQL or data changes have been performed in this implementation.
The available tools do not include a Supabase administrator connection. A local
Docker CLI exists, but its daemon was unavailable during the implementation.

## 1. Inventory production without changing it

Run `security-audit.sql` in the project's SQL editor. It reads schema/access metadata,
not application rows. Keep its output with the deployment record. Compare actual
policies and grants with the repository schema; do not assume they are identical.
Review Auth dashboard settings for signup, session lifetime and administrator MFA.
Record the deployed application revision and database migration history.

## 2. Establish and prove recovery

Create an independent database backup using the project's supported backup/export
process. Record its timestamp, scope, successful completion and restoration method.
Back up media separately and verify that database attachment references are covered.
Do not treat the current Settings export as a complete cloud backup.
Store backups outside the public website repository with restricted access.

Restore into a separate staging project or isolated local PostgreSQL/Supabase instance.
Never test restore against the live project. Use a separate browser origin/configuration
for staging so browser-local configuration cannot accidentally target production.
Verify table counts, foreign keys, stock totals, ledger balances, payroll totals and
sample attachment reads. Record discrepancies and resolve them before migration.

## 3. Prepare the access model

Document approved access for each role and operation, including payroll, settings,
exports, storage downloads/uploads/deletion and audit reads. Inventory existing users
and server-controlled role assignments. Do not infer admin rights from editable metadata.
Test anonymous, viewer, operator, payroll and administrator requests directly against
the staging API as well as through the UI.

## 4. Coordinate rollout and rollback

Ship verified authentication and authenticated API requests together with restrictive
policies/RPC grants. Remove legacy permissive policies explicitly: adding restrictive
policies alone does not override permissive policies combined with OR.
Verify a designated administrator can sign in before cutting over operator traffic.
Keep an administrative recovery route and a tested application rollback available;
do not use public read/write policies as the automatic rollback strategy.

## 5. Existing ledger reconciliation

The current local patch prevents new unreceived-order liabilities and cross-supplier
challan collisions. It does not delete or automatically repair historical ledger rows.
In staging, identify auto-synced rows without receipts, duplicated source identifiers,
and supplier/challan mismatches. Reconcile against source receipts and preserve payment
history. Produce a reviewable reconciliation report before any production correction.

## Current release gate

Local mocked tests are not proof of deployed RLS, complete backup recovery, or actual
multi-device/offline correctness. Production rollout remains pending the checks above.
