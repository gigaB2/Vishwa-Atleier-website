# Compatibility-Preserving Remediation Plan

**Project:** Vishwa Atelier public website and Management Suite  
**Audience:** Implementation engineer or coding AI  
**Priority:** Preserve all currently working Management Suite functionality  
**Production rule:** Do not deploy, migrate, delete, or rewrite production data without explicit owner approval and a verified rollback

## 1. Objective

Remediate the security, maintainability, performance, accessibility, SEO, and release-process findings without changing the Management Suite's current workflows, calculations, navigation, data meaning, offline behavior, synchronization behavior, visual layout, or user-visible outputs unless a change is explicitly approved.

This is a stabilization and hardening project, not a redesign or rewrite.

The Management Suite is already operational. Existing behavior is the specification. When the code and documentation disagree, characterize the behavior with a test and ask the owner before changing it.

## 2. Non-negotiable compatibility contract

The implementer must preserve all of the following unless the owner explicitly approves a change:

- Existing page URLs and relative navigation paths.
- Existing localStorage and IndexedDB keys.
- Existing JSON record shapes, identifiers, timestamps, and financial-year rules.
- Current calculations, rounding, table columns, filters, forms, exports, and print layouts.
- Yarn and weaving order, receipt, issue, GR, production, sales, costing, ledger, dispatch, employee, attendance, loan, and salary workflows.
- Current multi-PC merge rules, tombstones, authoritative-empty semantics, conflict resolution, and deletion behavior.
- Offline-first startup and cached read behavior.
- Current Supabase table and RPC names until a versioned migration is complete.
- Existing events, BroadcastChannel messages, listener names, and refresh behavior.
- Existing permissions and visible menu options for legitimate users.
- Existing website copy, brand styling, inquiry actions, lookbooks, catalog URLs, and contact routes.

Security enforcement may move from the browser into the database/server, but an authorized user must experience the same successful workflow.

### Prohibited implementation approaches

Do not:

- Rewrite the Management Suite in a framework.
- Replace large files wholesale.
- Rename storage keys or database columns as cleanup.
- Normalize or repair production records automatically.
- remove a fallback until its replacement is verified in staging.
- Run destructive SQL against production.
- make RLS changes before authenticated client requests are ready.
- Assume local mocked tests prove production database behavior.
- Add restrictive RLS policies while leaving permissive `USING (true)` policies in place.
- Change calculation formulas while extracting them.
- Combine security, refactoring, design, and performance changes in one release.
- Test browser flows against the owner's live production storage or production database.
- Commit secrets, service-role keys, user exports, backups, or production data fixtures.

## 3. Known baseline

The existing Management Suite runner currently passes tests covering:

- Financial-year calculations and carry-forward.
- Costing calculations.
- Yarn ledger and goods returns.
- Yarn and weaving multi-device synchronization.
- Tombstone and deletion behavior.
- Design-library synchronization and deletion.
- Presence behavior.
- Successful empty cloud responses versus offline failures.
- Concurrency and relational safeguards.

Relevant files:

- `management suite/tests/run-all-tests.js`
- `management suite/assets/supabase-client.js`
- `management suite/assets/supabase-schema.sql`
- `management suite/sidebar.js`
- `management suite/index.html`
- `management suite/ops/security-audit.sql`
- `management suite/ops/recovery-and-security-gates.md`

The repository is approximately 736 MB. About 509 MB is WebP imagery and 175 MB is MP4 video. Several Management Suite documents contain hundreds of kilobytes of inline JavaScript and CSS. Treat them as legacy compatibility-sensitive modules.

## 4. Definition of done

The project is complete only when:

1. All current tests still pass.
2. New browser characterization tests cover the critical user workflows.
3. Anonymous Supabase requests cannot read or mutate private application data.
4. Authorized users can complete the same workflows with the same results.
5. Legacy/plaintext/SHA-256 password fallback is removed after a verified account migration.
6. High-risk dynamic HTML output is safely encoded or built with DOM APIs.
7. Backup and restore has been proven in an isolated staging environment.
8. Public-site transferred bytes and Core Web Vitals improve without visual regression.
9. Security headers are deployed without breaking the application.
10. Every release has a documented rollback and post-release verification result.

## 5. Workstream order

Perform the work in this order. A later phase must not start until the preceding phase's gate passes.

---

## Phase 0 — Baseline, recovery, and staging

### Goal

Create a safe environment and executable behavioral specification before modifying application behavior or database access.

### Tasks

1. Create a branch named with the repository's `codex/` prefix or the owner's requested convention.
2. Record the deployed application revision, hosting configuration, Supabase project reference, schema version, and deployment procedure.
3. Run and save the output of:
   - `node "management suite/tests/run-all-tests.js"`
   - Every test file that is intentionally excluded from the master runner.
   - A static syntax check for every inline script.
4. Update the root `package.json` scripts without changing runtime dependencies:
   - `test`
   - `test:unit`
   - `test:integration`
   - `test:e2e`
   - `test:all`
5. Run `management suite/ops/security-audit.sql` against production in read-only mode. Save policy, grant, function, trigger, publication, and storage-policy results outside the public repository.
6. Obtain an independent database backup and a separate storage/media backup.
7. Restore both into a new staging Supabase project. Do not point staging at production storage.
8. Use an anonymization script or sanitized fixture process for names, emails, phone numbers, payroll data, addresses, API keys, documents, and images containing personal data.
9. Verify staging against production aggregates:
   - Row counts by table.
   - Yarn stock totals and status counts.
   - Open/completed order counts.
   - Ledger receivable/payable totals.
   - Employee, attendance, loan, and salary totals.
   - Design and attachment counts.
   - Referenced storage objects.
10. Document the recovery procedure and time required to restore service.

### Required artifacts

- Staging configuration excluded from Git.
- Backup inventory and restore log.
- Sanitized representative fixtures.
- Baseline test report.
- Production access inventory.

### Gate

- The staging restore succeeds.
- Totals and relationships match expected production aggregates.
- Existing tests pass unchanged.
- Rollback procedure has been rehearsed.

Do not proceed to security migration if this gate fails.

---

## Phase 1 — Browser characterization tests

### Goal

Protect the exact working behavior before modifying authentication, persistence, rendering, or file structure.

### Test isolation requirements

- Use a dedicated staging Supabase project.
- Use a dedicated browser origin or context.
- Seed deterministic fixture data before each suite.
- Never clear or overwrite production localStorage, IndexedDB, or Supabase records.
- Give each test run unique record prefixes and clean up only its own records.

### Required end-to-end workflows

#### Authentication and navigation

- Employee sign-in and sign-out.
- Admin sign-in and sign-out.
- Session restoration after refresh.
- Expired-session handling.
- Authorized first-page redirect.
- View-only versus edit permissions.
- Direct navigation to allowed and disallowed modules.

#### Yarn

- Create, edit, complete, reopen, and delete an RM order.
- Receive multiple batches and boxes.
- Issue and unissue boxes.
- Create partial and full goods returns.
- Verify stock, order, and purchase-ledger propagation.
- Create Doubler, TFO, Covering, and MX production records.
- Create sales challans and verify sales-ledger propagation.
- Verify duplicate challan prevention and supplier isolation.
- Verify costing outputs against fixed golden fixtures.

#### Weaving

- Create and update an order.
- Receive warp/weft materials.
- Create warp beams and loadings.
- Add production logs.
- Complete and reopen orders.
- Dispatch and cut fabric.
- Add, inspect, and delete designs.

#### Payroll and administration

- Create and edit an employee.
- Attendance entry.
- Loan and repayment entry.
- Salary calculation and settlement.
- Company/settings persistence.
- Permissions update.

#### Data resilience

- Two browsers concurrently create distinct records.
- Two browsers edit the same record; current winner semantics remain unchanged.
- Remote deletion cannot be resurrected by stale local state.
- Successful empty cloud datasets clear stale caches.
- Failed cloud reads retain offline data.
- Browser refresh during pending work follows current behavior.
- Export and restore a complete staging backup.

### Golden assertions

For every financial or inventory workflow, assert both UI values and persisted values. Capture:

- IDs and source keys.
- Quantities and weights.
- Rates, taxes, discounts, interest, totals, and rounding.
- Statuses and issue/return dates.
- Tombstone values.
- Updated timestamps.
- Cross-module mirrored records.

### Gate

All characterization tests pass against the unmodified application. A failing test must be resolved as a test-fixture issue or documented existing behavior; do not silently change the app.

---

## Phase 2 — Access-control design

### Goal

Define server-enforced authorization that reproduces the current legitimate-user permissions.

### Tasks

1. Inventory every table, storage bucket, RPC, and action used by each page.
2. Create a permissions matrix with at least:
   - Anonymous.
   - Employee/viewer.
   - Operator/editor.
   - Payroll-authorized user.
   - Administrator.
3. Decide which existing per-page permission values remain UI-only preferences and which must be enforced by the database.
4. Store authoritative roles in a server-controlled table or `app_metadata`. Do not trust client-editable `user_metadata` for administrator status.
5. Define ownership/tenant rules. If all authenticated employees share one company dataset, encode that explicitly. If multiple companies require isolation, add it only through a separately approved versioned migration.
6. Classify RPC functions as:
   - Public health check.
   - Authenticated operational function.
   - Administrator-only function.
7. Define storage access for reads, uploads, replacements, and deletion.
8. Define audit behavior:
   - Actor derived from `auth.uid()`/verified JWT.
   - Ordinary users can append approved events.
   - Ordinary users cannot rewrite or delete audit history.

### Gate

The owner approves the permissions matrix and confirms which users require payroll, settings, export, restore, and administrative access.

---

## Phase 3 — Authentication compatibility layer

### Goal

Make verified Supabase Auth sessions authoritative while retaining the current login screen and successful navigation behavior.

### Implementation sequence

1. Add an authentication adapter with a small interface:
   - `signIn(email, password)`
   - `signOut()`
   - `getSession()`
   - `refreshSession()`
   - `getCurrentProfile()`
   - `hasPermission(permission)`
2. Keep existing callers and UI intact; route them through the adapter.
3. Store only the minimum compatibility session object required by existing pages. Do not store password hashes or passwords.
4. Add an authenticated fetch helper that uses the current access token and refreshes once on a 401.
5. Make failure explicit. Do not fall back to local administrator authentication when Supabase rejects validly attempted credentials.
6. During staging only, provide a migration report identifying:
   - Users already backed by Supabase Auth.
   - Local-only users.
   - Plaintext password records.
   - Unsalted SHA-256 records.
   - Disabled or duplicate accounts.
7. Migrate local-only users through approved invitations or forced password-reset flows. Never import legacy password material as a valid modern password.
8. After all designated users successfully authenticate in staging, disable the local-password fallback behind a temporary rollback flag.
9. Remove the rollback flag only after the production migration is verified.

### Compatibility checks

- Same login pages and role tabs.
- Same first allowed page.
- Same sidebar identity.
- Same visible permissions.
- Same refresh and logout behavior.
- Offline cached data remains readable only according to the agreed offline policy; offline login must not manufacture a server-authenticated identity.

### Gate

- Every active user has a verified Supabase Auth identity.
- Administrator recovery has been tested.
- Legacy plaintext/SHA-256 credentials are no longer accepted.
- Browser tests pass.

---

## Phase 4 — RLS, grants, RPCs, and storage

### Goal

Remove anonymous access while preserving authorized application operations.

### Important rollout rule

Client authentication changes and RLS changes must be deployed as a coordinated, reversible release. Applying RLS first may break the suite. Applying the client first while permissive policies remain does not improve security but can be used briefly for verification.

### Tasks

1. Create versioned SQL migrations; do not edit production manually without recording the exact script.
2. Add negative tests before changing policies:
   - Anonymous SELECT is denied on private tables.
   - Anonymous INSERT/UPDATE/DELETE is denied.
   - Viewer mutation is denied.
   - Non-payroll user payroll reads are denied.
   - Non-admin settings/user mutations are denied.
   - Audit UPDATE/DELETE is denied.
   - Unauthorized storage upload/delete is denied.
3. Add positive tests for every authorized workflow.
4. Replace every permissive policy from `supabase-schema.sql`. Drop the existing permissive policies by exact name; restrictive policies do not override permissive policies because applicable policies are combined.
5. Revoke unnecessary grants from `anon` and `authenticated`.
6. For every `SECURITY DEFINER` function:
   - Fix `search_path`.
   - Validate the caller and required role inside the function.
   - Validate all identifiers and allowed tables/columns.
   - Grant execution only to required roles.
7. Protect `vf_auth_users`:
   - Do not expose `pass_hash` to clients.
   - Prefer a safe profile view containing only required fields.
   - Make role changes administrator-only.
8. Protect salary, loans, attendance, company settings, exports, and backups using the approved matrix.
9. Make storage private unless a specific asset is intentionally public.
10. Use signed URLs or authenticated downloads for private media.
11. Ensure realtime subscriptions deliver only rows the current user is permitted to select.

### Suggested policy pattern

Use named helper functions for role checks, but keep authorization based on server-controlled data. Policies should distinguish SELECT, INSERT, UPDATE, and DELETE when permissions differ. Avoid a universal `FOR ALL` policy unless the access truly is identical.

### Deployment steps

1. Maintenance announcement if needed.
2. Confirm fresh backup.
3. Deploy authenticated client build.
4. Verify designated administrator and operator sessions.
5. Apply RLS/grant/storage migration.
6. Run negative direct-API tests.
7. Run positive browser smoke tests.
8. Monitor errors, failed sync queue, and realtime connections.
9. Roll back application and migration if critical checks fail. Do not restore public policies as the default long-term rollback.

### Gate

All anonymous and role-negative tests fail closed, all authorized workflow tests pass, and no cross-module synchronization regressions occur.

---

## Phase 5 — DOM injection and input hardening

### Goal

Eliminate executable user/imported content without changing rendered text or layouts.

### Priority files

Start with pages containing the most dynamic HTML:

1. `management suite/modules/salary-sheet.html`
2. `management suite/modules/manage.html`
3. `management suite/modules/yarn/yarn-production.html`
4. `management suite/modules/yarn/yarn-sales.html`
5. `management suite/modules/weaving/weaving-production.html`
6. `management suite/modules/yarn/yarn-ledger.html`
7. `management suite/modules/yarn/yarn-stock-dashboard.html`
8. `management suite/sidebar.js`

### Implementation rules

- Use `textContent` for plain values.
- Use `createElement`, `setAttribute`, and event listeners for structures.
- When retaining templates is necessary, apply one reviewed context-aware escaping helper to every interpolated text value.
- Validate URLs and permit only expected protocols. Reject `javascript:`, unexpected `data:` URLs, and malformed remote URLs.
- Do not escape numeric values in a way that changes formatting or calculations.
- Do not sanitize by deleting legitimate punctuation from names, qualities, remarks, or design codes.
- Never insert imported backup/OCR/API content into executable HTML.
- Avoid inline event-handler strings containing record data.

### Tests

Add fixtures containing:

- `<script>` and event-handler payloads.
- Quotes, apostrophes, ampersands, angle brackets, emoji, Gujarati/Hindi text.
- Long supplier/employee/design names.
- URL protocol attacks.
- Valid existing HTML-looking business text that must display literally.

Assert the value displays as text, no unexpected element/event is created, and existing actions still target the correct record.

### Gate

The page's screenshot, text, actions, calculations, and persisted records match the baseline for normal fixtures; hostile fixtures execute no code.

---

## Phase 6 — Backup, import, and destructive-operation safety

### Goal

Make recovery dependable without changing ordinary operations.

### Tasks

1. Version the backup format and include:
   - Application version.
   - Schema version.
   - Export timestamp.
   - Per-section counts and checksums.
   - LocalStorage data required for compatibility.
   - IndexedDB data.
   - Cloud table data.
   - Attachment manifest.
2. Exclude passwords, access/refresh tokens, Supabase keys, Gemini/API keys, and transient caches.
3. Validate an import before writing anything:
   - Supported version.
   - Required collections and types.
   - Identifier uniqueness.
   - Foreign-key/reference integrity.
   - Finite numeric values and valid dates.
   - Attachment availability.
4. Show a dry-run summary and require explicit user confirmation in the UI.
5. Restore into staging/temp structures first where feasible.
6. Await every operation and report partial failures.
7. Create a pre-import recovery snapshot.
8. Add failure-injection tests for network interruption, malformed records, missing attachments, quota exhaustion, and partial writes.
9. Verify restored financial and inventory totals.

### Gate

A populated staging environment can be exported, destroyed in staging, restored, and verified with matching counts/totals and attachments.

---

## Phase 7 — Public website performance

### Goal

Reduce initial network and rendering cost without changing appearance, copy, interactions, or URLs.

### Tasks

1. Measure the current homepage at mobile and desktop widths. Record LCP, CLS, INP/TBT, transferred bytes, request count, and video bytes.
2. Replace Tailwind's browser CDN with compiled, minified static CSS. Preserve all current generated classes and responsive behavior.
3. Keep only the true LCP image preloaded.
4. Set below-the-fold images to `loading="lazy"` and `decoding="async"`.
5. Add explicit image width/height or aspect ratio to prevent layout shifts.
6. Generate responsive `srcset`/`sizes` variants and AVIF/WebP fallbacks.
7. Re-encode large videos into web-optimized MP4/WebM variants.
8. Set noncritical videos to `preload="none"` or `metadata` and activate sources near the viewport.
9. Respect reduced-motion and data-saver preferences.
10. Prevent multiple identical large video downloads where the same source is reused.
11. Add immutable caching for hashed media/CSS/JS and short caching for HTML/config.
12. Optimize PDFs without changing visual fidelity or existing URLs.

### Acceptance criteria

- No visual regression at supported breakpoints.
- No homepage horizontal overflow.
- Navigation, process tabs, lookbook controls, globe, modal, email, and WhatsApp actions behave identically.
- Initial transferred bytes materially decrease; record before/after results rather than promising an arbitrary score.

---

## Phase 8 — Accessibility and SEO corrections

### Accessibility tasks

- Provide one meaningful `h1` per public/operational page where appropriate without changing visible styling.
- Preserve logical heading order.
- Add missing `alt` text or empty `alt` for decorative images.
- Add accessible names to icon-only controls.
- Add `type="button"` to non-submit buttons.
- Ensure touch targets are approximately 44 by 44 CSS pixels where practical.
- Preserve visible focus indicators.
- Verify dialog focus entry, containment, Escape close, and focus return.
- Verify all key workflows by keyboard.
- Respect `prefers-reduced-motion`.
- Correct color contrast without redesigning the palette.

### SEO and link tasks

- Make the Airjet page Open Graph image absolute.
- Add `rel="noopener noreferrer"` to untrusted new-tab links.
- Verify canonicals, sitemap entries, robots behavior, and status codes.
- Confirm that certification, export-market, production-capacity, tax-ID, and contact claims are approved and current.
- Add privacy information before implementing analytics or server-side lead storage.
- Keep catalog and PDF URLs stable.

### Gate

Automated accessibility checks have no critical violations, manual keyboard workflows pass, and search metadata validation passes without changing public copy.

---

## Phase 9 — Security headers and dependency hardening

### Goal

Add browser protections without breaking inline-heavy legacy pages.

### Tasks

1. Inventory all script, style, font, image, media, connect, worker, frame, and form origins.
2. Add headers in staging:
   - `X-Content-Type-Options: nosniff`
   - Appropriate `Referrer-Policy`.
   - Appropriate `Permissions-Policy`.
   - Frame protection via CSP `frame-ancestors`.
   - HSTS only after HTTPS and subdomain implications are confirmed.
3. Introduce Content Security Policy in report-only mode.
4. Remove or nonce/hash inline scripts progressively. Do not enable a blocking CSP until all critical flows pass.
5. Self-host or pin external icon/font assets where licensing permits.
6. Keep the Supabase origin and websocket connection explicitly allowed.
7. Use separate cache policies for config/HTML and fingerprinted assets.
8. Add dependency, secret, and static-security scanning to CI.

### Gate

No critical CSP reports remain for supported workflows, blocking headers pass staging browser tests, and the production rollback is prepared.

---

## Phase 10 — Incremental modularization

### Goal

Reduce maintenance risk after security and test coverage are established.

### Extraction order

1. Pure calculation functions.
2. Date, financial-year, formatting, validation, and identifier helpers.
3. Safe DOM rendering helpers.
4. Authentication/fetch adapter.
5. Storage repository interfaces.
6. Sync/merge services.
7. Page controllers.

### Rules

- Extract one function family at a time.
- Copy behavior first; do not improve formulas during extraction.
- Run unit, characterization, and browser tests after every extraction.
- Compare golden outputs before and after.
- Keep a compatibility wrapper for existing globals and inline callers.
- Do not migrate storage schemas merely to make the code cleaner.
- Commit each logical extraction independently for easy rollback.

Begin with a low-risk calculator or utility page. Do not begin with `yarn-ledger.html`, `salary-sheet.html`, `yarn-production.html`, or `supabase-client.js`.

---

## 6. Release strategy

Use small releases:

1. Tests and documentation only.
2. Authentication client preparation behind a disabled flag.
3. Staging authentication migration.
4. Coordinated authenticated client and RLS release.
5. DOM-hardening batches by page.
6. Public media/CSS optimization.
7. Accessibility fixes.
8. Security headers.
9. Optional modularization.

Each release must include:

- Scope and changed files.
- Expected unchanged behaviors.
- Database migration, if any.
- Pre-deployment backup reference.
- Automated test output.
- Manual smoke-test checklist.
- Monitoring window.
- Rollback steps.

## 7. Required smoke test after every Management Suite release

1. Employee and admin login.
2. Open every sidebar page without console errors.
3. Create a test yarn order and receipt.
4. Verify stock and ledger propagation.
5. Issue/unissue a test box.
6. Add/remove a test GR.
7. Create a test production and sales entry.
8. Verify a weaving order and production entry.
9. Verify employee/salary calculations with a fixture account.
10. Verify realtime changes in a second browser.
11. Delete only test-prefixed records and verify no resurrection.
12. Export a backup and validate its manifest.
13. Confirm no anonymous direct API access.
14. Confirm error logs contain no secrets or personal record payloads.

## 8. Stop conditions requiring owner input

Stop and ask the owner before proceeding if:

- Existing behavior conflicts with a proposed security rule.
- A role's intended data access is unclear.
- Staging totals do not match backup/production aggregates.
- Historical duplicates, liabilities, or stock discrepancies are found.
- A migration would alter identifiers, timestamps, financial values, or payment history.
- An active user cannot migrate to Supabase Auth.
- A CSP/header change breaks a workflow that cannot be isolated.
- A visual or performance change alters brand presentation.
- A production deployment or destructive database operation is required.

## 9. Instructions for the implementing AI

Use this operating prompt together with the plan:

> Implement this plan one gated phase at a time. The Management Suite currently works and its functionality must not change. Treat existing observable behavior as the specification. Before editing, inspect the relevant files and tests, state the exact phase and acceptance criteria, and identify any ambiguity. Add characterization tests before changing behavior-sensitive code. Make small, reviewable patches; never rewrite whole modules. Preserve URLs, storage keys, schemas, calculations, events, data shapes, navigation, permissions, visual outputs, offline behavior, and sync semantics. Work only against an isolated staging database and browser profile. Never deploy, run destructive SQL, migrate production data, or change production configuration without explicit owner approval. After each patch, run the narrow tests and the full suite, report changed files and results, and stop at the phase gate for review. If existing behavior and the plan conflict, stop and ask rather than guessing.

## 10. First assignment for the implementing AI

The first implementation task should be Phase 0 and Phase 1 only:

1. Add reliable root test commands.
2. Confirm and document every existing test included/excluded by the master runner.
3. Build isolated browser characterization tests for login, one complete yarn lifecycle, one complete weaving lifecycle, salary calculation, two-client sync, and backup validation.
4. Do not change application runtime code, database policies, UI, or production configuration during this assignment.
5. Return test results, coverage gaps, staging requirements, and any ambiguities for owner review.

Only after that assignment is approved should the implementer begin authentication or RLS work.
