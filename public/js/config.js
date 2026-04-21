/**
 * config.js — runtime configuration
 *
 * This file is served DYNAMICALLY by Express (/js/config.js route),
 * which injects the real values from environment variables.
 *
 * The static version below is only used as a fallback when the file is
 * loaded directly from the filesystem (e.g. local file:// dev without server).
 *
 * For GitHub Pages: CI (deploy-pages.yml) rewrites this file with real values
 * before deploying to gh-pages.
 */
window.RE_API_BASE      = 'https://api.recuperaempresas.com.br';
window.RE_API_WORKER_BASE = '';
window.RE_API_WORKER_ROUTES = [];
window.VITE_SUPABASE_URL = 'https://riiajjmnzgagntiqqshs.supabase.co';
window.VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpaWFqam1uemdhZ250aXFxc2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzY0ODUsImV4cCI6MjA5MTc1MjQ4NX0.zyOFjVFIBJem5FZmXBD-ya78RheD_a-YHetibyVvXcI';
window.RE_SUPABASE_URL  = 'https://riiajjmnzgagntiqqshs.supabase.co';
window.RE_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpaWFqam1uemdhZ250aXFxc2hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzY0ODUsImV4cCI6MjA5MTc1MjQ4NX0.zyOFjVFIBJem5FZmXBD-ya78RheD_a-YHetibyVvXcI';
window.RE_ENABLE_FRESHCHAT = false;
window.RE_FRESHCHAT_TOKEN = '';
window.RE_FRESHCHAT_SITE_ID = '';
