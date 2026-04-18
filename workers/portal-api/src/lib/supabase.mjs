import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://riiajjmnzgagntiqqshs.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpaWFqam1uemdhZ250aXFxc2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzY0ODUsImV4cCI6MjA5MTc1MjQ4NX0.zyOFjVFIBJem5FZmXBD-ya78RheD_a-YHetibyVvXcI';

export function getSupabaseServiceRoleKey(env) {
  return String(
    env.VITE_SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || ''
  ).trim();
}

export function getSupabaseUrl(env) {
  return String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim() || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(env) {
  return String(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim() || DEFAULT_SUPABASE_ANON_KEY;
}

export function getSupabase(env) {
  const serviceRoleKey = getSupabaseServiceRoleKey(env);
  return createClient(getSupabaseUrl(env), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabaseAnon(env) {
  return createClient(getSupabaseUrl(env), getSupabaseAnonKey(env), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}