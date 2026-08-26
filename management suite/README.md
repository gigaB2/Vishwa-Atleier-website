# Textile & Manufacturing Management Suite (Production Enterprise)

A high-performance, modular enterprise web application for textile manufacturing, yarn processing, weaving management, costing calculations, salary management, and real-time inventory tracking.

Built with **HTML5**, **Vanilla JavaScript**, **CSS3**, and powered by **Supabase Cloud / Realtime WebSocket Synchronization**.

---

## 🚀 Quick Setup Guide (For Deployments & New Instances)

Follow these 4 simple steps to set up a brand new instance of the application with its own dedicated database.

---

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and log in or create an account.
2. Click **New Project** and name your project (e.g., `textile-erp`).
3. Set a strong database password and select the region nearest to your users.
4. Wait ~1 minute for Supabase to provision your database.

---

### Step 2: 1-Click Database Provisioning

1. In your Supabase Project Dashboard, go to **SQL Editor** (from the left sidebar).
2. Click **New query**.
3. Open the file [`assets/supabase-schema.sql`](assets/supabase-schema.sql) from this project, copy its entire content, and paste it into the Supabase SQL Editor.
4. Click **Run** (or press `Ctrl + Enter`).
5. All synchronized tables (`vf_kv_store`, `vf_costing_products`, `vf_costing_tfo_products`, `vf_costing_doubler_products`, `vf_costing_covering_products`, `vf_audit_logs`), Row Level Security policies, RPC functions (`vf_ping`), and Realtime publications are now active!

---

### Step 3: Configure Database Connection

#### Option A: External Configuration File (Recommended for Deployment)
1. In your Supabase Dashboard, navigate to **Project Settings** (gear icon) > **API**.
2. Copy your **Project URL** (e.g., `https://xyzcompany.supabase.co`).
3. Copy your **`anon` `public` Key** (a long string starting with `eyJhbGciOi...`).
4. In this repository, duplicate `assets/config.example.js` to `assets/config.js` and paste your credentials:
   ```javascript
   window.APP_CONFIG = {
     SUPABASE_URL: "https://your-project-ref.supabase.co",
     SUPABASE_ANON_KEY: "your-anon-public-key-here",
     APP_NAME: "Management Suite",
     ENABLE_REALTIME_SYNC: true,
     SYNC_POLL_INTERVAL_MS: 30000
   };
   ```

#### Option B: In-App Admin Settings UI
1. Launch the application in your browser.
2. Go to **Settings** (`modules/settings.html`).
3. Scroll to the **Cloud Database & Backend Sync** section.
4. Enter your **Supabase Project URL** and **Supabase Anon Key**.
5. Click **Test Connection** to verify reachable status, then click **Save & Reconnect**.

---

### Step 4: Run or Deploy the Application

Because this application is a pure static web suite, it requires **zero backend servers to maintain**.

#### Local Testing:
Simply start any static HTTP server in the project folder:
```bash
# Using Node.js (npx)
npx serve .

# Or using Python
python -m http.server 8080
```
Then open `http://localhost:8080` in your web browser.

#### Cloud Deployment (1-Click Static Hosting):
Deploy the project folder to any static hosting provider:
- **GitHub Pages**: Automated workflow runs calculation tests before deploying ([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)).
- **Vercel**: Import repository and deploy with default static preset.
- **Netlify**: Drag-and-drop or connect git repository.
- **Cloudflare Pages**: Connect repository and set build output to `/`.

---

## 🧪 Automated Testing & Verification

The suite includes zero-dependency automated unit tests covering financial year boundaries, concurrent sync deduplication, and textile costing equations:

```bash
# Run all tests
node tests/run-all-tests.js

# Or test individual modules
node --test tests/fy-engine.test.js
node --test tests/sync-engine.test.js
node --test tests/costing-math.test.js
```

---

## 🔐 Enterprise Security, Audit Trail & Health Checks

1. **Audit Logs (`vf_audit_logs`)**:
   - Every login, sign up, logout, order mutation, and stock update is recorded with user email, timestamp, and metadata in the database.
   - Programmatically accessible via `window.VishwaSupabase.getAuditLogs({ limit: 50 })`.
2. **Server RPC Health Check**:
   - Test connectivity and latency anytime via `window.VishwaSupabase.ping()`.
3. **Session Token Refresh**:
   - Automatic background token refresh occurs every 5 minutes for active JWT sessions.
4. **Global Error Boundary**:
   - Catches unhandled promise rejections and script runtime errors, reporting diagnostics safely without breaking page state.

---

## 📁 Repository Structure

```
├── index.html                     # Main portal & authentication gateway
├── upload.html                    # Quick beam card photo upload utility
├── sidebar.js                     # Navigation, permission guard & dynamic script injector
├── sidebar.css                    # Unified global styling & dark/light theme tokens
├── tests/
│   ├── run-all-tests.js           # Master zero-dependency test runner
│   ├── fy-engine.test.js          # Indian FY calculation tests
│   ├── sync-engine.test.js        # Multi-device merge & conflict resolution tests
│   └── costing-math.test.js       # Warp/weft & yarn math validation tests
├── assets/
│   ├── config.js                  # Active Supabase credentials & app configuration
│   ├── config.example.js          # Clean configuration template
│   ├── supabase-client.js         # Reactive Cloud Sync, Audit logging & LocalStorage adapter
│   ├── supabase-schema.sql        # Database provisioning & audit table SQL schema
│   └── fy-engine.js               # Financial Year calculation engine
└── modules/
    ├── settings.html              # System, theme, admin, user permissions & database configuration
    ├── salary-sheet.html          # Payroll & worker salary calculation sheet
    ├── manage.html                # Master overview & operations management
    ├── weaving/                   # Weaving production, costing, orders, dispatch & gear charts
    └── yarn/                      # Yarn stock, production, sales & gear calculators
```

---

## 🛠️ Backup & Data Portability

Administrators can perform full backups at any time:
1. Go to **Settings** > **Backup & Restore**.
2. Click **Export Database** to download a complete JSON snapshot of all system data.
3. Click **Import Database** to restore data to any instance.
