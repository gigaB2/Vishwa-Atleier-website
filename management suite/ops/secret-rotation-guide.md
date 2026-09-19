# Supabase Credential Rotation & Secret Hygiene Guide

**Audience:** System Administrator / Factory Owner  
**Purpose:** Instructions for safely rotating Supabase API keys without disrupting active factory operations, offline caching, or production data.

---

## 1. Background: Public Keys vs. Secret Keys

In your Supabase Project (**Settings -> API**), there are two types of keys:

| Key Type | Role in Token | Where it belongs | What happens if leaked? |
| :--- | :--- | :--- | :--- |
| **`anon` (public)** | `"role": "anon"` | Client-side (`config.js`, browser, settings) | Safe when RLS is enabled (Phase 4). Callers only get what Row Level Security permits. |
| **`service_role` (secret)** | `"role": "service_role"` | Server-side only (never in browser!) | **DANGEROUS.** Bypasses all RLS and grants full database control. **Must NEVER be in client code.** |

> [!NOTE]
> The app's `supabase-client.js` now includes an automated guard: if anyone accidentally inputs a `service_role` key into client files or the Admin Settings UI, the client **automatically blocks the connection** to protect your database.

---

## 2. When Should You Rotate Keys?

Rotate your keys if:
- A `service_role` key was ever shared, emailed, or committed to a public Git repository.
- An employee with admin access leaves the organization.
- Routine security maintenance (recommended annually).

---

## 3. Step-by-Step Zero-Downtime Key Rotation Procedure

### Step 1: Log in to Supabase Dashboard
1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Select your project (**Vishwa Atelier**).
3. In the left navigation, click on **Settings** (gear icon) -> **API**.

### Step 2: Generate a New API Key
1. Scroll down to the **Project API keys** section.
2. If you are rotating the `anon` key, locate the `anon` / `public` row.
3. Click **Generate new key** (or **Roll key** depending on your Supabase tier).
4. Copy the new `anon` key to your clipboard.

### Step 3: Update the Management Suite
You have two easy ways to update the app:

#### Option A: Via Admin Settings UI (Instant, No Code Changes)
1. Open the Management Suite in your browser.
2. Go to **Settings** -> **Supabase Cloud Sync**.
3. Paste the new **Supabase Anon Key** into the input field.
4. Click **Test Connection & Save**.
5. The app updates immediately for that workstation and synchronizes with local storage.

#### Option B: Via `management suite/assets/config.js` (For All Workstations)
1. Open [`management suite/assets/config.js`](file:///c:/Users/Admin/Desktop/Websi/Website/management%20suite/assets/config.js) in your editor.
2. Update the `SUPABASE_ANON_KEY` value:
   ```javascript
   SUPABASE_ANON_KEY: "your-new-anon-key-here",
   ```
3. Save the file.
4. Run the automated test suite to confirm syntax and safety:
   ```bash
   node "management suite/tests/secret-hygiene.test.js"
   ```

### Step 4: Verification Checklist
After updating the key, verify:
- [ ] Open the Management Suite and check the sidebar header: the cloud sync indicator should show green (**"Live"**).
- [ ] View the **Yarn Production** or **Weaving Production** screen: existing records load properly.
- [ ] Save a test log or note: verify sync transmits to the cloud without error.
- [ ] Test offline behavior: disconnect network, make an edit, reconnect, verify auto-sync recovers cleanly.

---

## 4. Emergency Assistance
If any screen fails to connect after rotation:
1. Re-check the key in **Settings -> API** in the Supabase Dashboard.
2. Ensure you copied the **`anon`** key and **NOT** the `service_role` key.
3. Check the browser console (`F12` -> Console) for any specific error messages.
