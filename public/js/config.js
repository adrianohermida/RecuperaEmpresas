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
window.RE_API_BASE      = '';
window.RE_SUPABASE_URL  = '';
window.RE_SUPABASE_ANON = '';
