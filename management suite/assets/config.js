/**
 * Management Suite — Global Application Configuration
 * 
 * To connect to your own Supabase project:
 * 1. Set SUPABASE_URL to your Supabase project URL (e.g., https://xyz.supabase.co)
 * 2. Set SUPABASE_ANON_KEY to your Supabase Project 'anon' / 'public' API key
 * 3. Run the SQL schema script located in `assets/supabase-schema.sql` in your Supabase SQL Editor.
 * 
 * Note: Credentials can also be dynamically configured in the Admin Settings UI inside the app.
 */
(function() {
  window.APP_CONFIG = {
    // Supabase Cloud Project Configuration
    SUPABASE_URL: "https://fwlzysudduroyndkiewa.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bHp5c3VkZHVyb3luZGtpZXdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODMwMDEsImV4cCI6MjEwMDQ1OTAwMX0.Cv0Ns_gslFFSe90_lu1YBqo9aEcHaUbmnsI43TDZ_oo",
    
    // Application Branding & Features
    APP_NAME: "Management Suite",
    ENABLE_REALTIME_SYNC: true,
    SYNC_POLL_INTERVAL_MS: 30000
  };
})();
