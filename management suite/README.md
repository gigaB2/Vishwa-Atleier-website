# Textile & Manufacturing Management Suite

A high-performance, modular enterprise web application for textile manufacturing, yarn processing, weaving management, costing calculations, salary management, and real-time inventory tracking.

Built with **HTML5**, **Vanilla JavaScript**, **CSS3**, and powered by **Supabase Cloud / Realtime WebSocket Synchronization**.

---

## 🚀 Quick Setup Guide (For New Clients & Deployments)

Follow these 4 simple steps to set up a brand new instance of the application with its own dedicated database.

---

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and log in or create a free account.
2. Click **New Project** and name your project (e.g., `textile-erp`).
3. Set a strong database password and select the region nearest to your users.
4. Wait ~1 minute for Supabase to provision your database.

---

### Step 2: 1-Click Database Provisioning

1. In your Supabase Project Dashboard, go to **SQL Editor** (from the left sidebar).
2. Click **New query**.
3. Open the file [`assets/supabase-schema.sql`](assets/supabase-schema.sql) from this project, copy its entire content, and paste it into the Supabase SQL Editor.
4. Click **Run** (or press `Ctrl + Enter`).
5. You will see a success message. All synchronized tables (`vf_kv_store`, `vf_costing_products`, `vf_costing_tfo_products`, `vf_costing_doubler_products`, `vf_costing_covering_products`), Row Level Security policies, and Realtime publications are now active!

---

### Step 3: Configure Database Connection

There are **two ways** to connect the software to your Supabase project:

#### Option A: External Configuration File (Recommended for Deployment)
1. In your Supabase Dashboard, navigate to **Project Settings** (gear icon) > **API**.
2. Copy your **Project URL** (e.g., `https://xyzcompany.supabase.co`).
3. Copy your **`anon` `public` Key** (a long string starting with `eyJhbGciOi...`).
4. In this repository, open `assets/config.js` (or duplicate `assets/config.example.js` to `assets/config.js`) and paste your credentials:
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
- **Vercel**: Import repository and deploy with default static preset.
- **Netlify**: Drag-and-drop or connect git repository.
- **Cloudflare Pages**: Connect repository and set build output to `/`.
- **GitHub Pages**: Enable GitHub Pages from repository settings.

---

## 🔐 Initial Admin Login & Security Setup

1. Open `index.html` (or `modules/settings.html`).
2. Navigate to **Settings** > **Admin & Employee Authentication Settings**.
3. Create your master **Admin Account** with email and password.
4. Under **Portal Security & Access Mode**, select:
   - 🔒 **Strict Authentication Mode**: Requires all users to log in before viewing records.
   - 🌐 **Open Workspace Mode**: Allows guest access with role-based restriction on sensitive modules.
5. Create Employee logins and assign specific permissions (View / Edit / None) per department module (Weaving, Yarn, Salary, Costing).

---

## 📁 Repository Structure

```
├── index.html                     # Main portal & authentication gateway
├── upload.html                    # Quick beam card photo upload utility
├── sidebar.js                     # Navigation, permission guard & dynamic script injector
├── sidebar.css                    # Unified global styling & dark/light theme tokens
├── assets/
│   ├── config.js                  # Active Supabase credentials & app configuration
│   ├── config.example.js          # Clean configuration template for buyers
│   ├── supabase-client.js         # Reactive Cloud Sync & LocalStorage adapter
│   ├── supabase-schema.sql        # 1-Click database provisioning SQL script
│   └── fy-engine.js               # Financial Year calculation engine
└── modules/
    ├── settings.html              # System, theme, admin, user permissions & database configuration
    ├── salary-sheet.html          # Payroll & worker salary calculation sheet
    ├── manage.html                # Master overview & operations management
    ├── weaving/                   # Weaving production, costing, orders, dispatch & gear charts
    └── yarn/                      # Yarn stock, production, sales & gear calculators
```

---

## 🔄 Real-Time Multi-Device Sync Architecture

- **Zero-Latency In-Memory Cache**: Instant reads across all page transitions.
- **LocalStorage Bridge**: Guarantees full offline functionality even if internet is disconnected.
- **Phoenix WebSocket Broadcast**: Sub-50ms live updates across multiple connected devices with 0 database egress costs.
- **Smart Differential Polling**: Automatically throttles network activity when tab is hidden.

---

## 🛠️ Backup & Data Portability

Administrators can perform full backups at any time:
1. Go to **Settings** > **Backup & Restore**.
2. Click **Export Database** to download a complete JSON snapshot of all system data.
3. Click **Import Database** to restore data to any instance.
