/**
 * Management Suite — Configuration Template (Example)
 * 
 * Instructions:
 * 1. Copy this file to `config.js` in the same directory:
 *    cp config.example.js config.js
 * 2. Replace the placeholder values with your Supabase Project credentials.
 * 3. Run `supabase-schema.sql` in your Supabase project's SQL Editor.
 */
(function() {
  window.APP_CONFIG = {
    // Supabase Cloud Project Configuration
    SUPABASE_URL: "https://your-project-ref.supabase.co",
    SUPABASE_ANON_KEY: "your-anon-public-key-here",
    
    // Application Branding & Features
    APP_NAME: "Management Suite",
    ENABLE_REALTIME_SYNC: true,
    SYNC_POLL_INTERVAL_MS: 30000
  };
})();
