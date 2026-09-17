-- Read-only deployment inventory. Run in the Supabase SQL editor as an administrator.
-- No customer rows, credentials, JWTs, or storage objects are selected.
BEGIN TRANSACTION READ ONLY;

-- RLS coverage, including whether owners are subject to RLS.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND c.relname LIKE 'vf\_%' ESCAPE '\'
ORDER BY c.relname;

-- Effective policies, including any old permissive policies left by provisioning.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename LIKE 'vf\_%' ESCAPE '\')
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

-- Table privileges granted to API roles.
SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name LIKE 'vf\_%' ESCAPE '\'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- Effective RPC execution rights (including inherited PUBLIC privileges).
SELECT n.nspname AS schema_name, p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, p.proconfig AS function_settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname LIKE 'vf\_%' ESCAPE '\'
ORDER BY p.proname;

-- Bucket access configuration only; no files are read.
SELECT id, name, public FROM storage.buckets WHERE id = 'vf_media_assets';

ROLLBACK;
