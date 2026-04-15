/**
 * config.js — runtime configuration
 *
 * RE_API_BASE prefixes all /api/* fetch calls.
 *
 * - Local dev + Render.com (same-origin):  '' (no prefix needed)
 * - GitHub Pages: CI (deploy-pages.yml) rewrites this file with
 *   the RENDER_API_URL secret before deploying to gh-pages.
 *   Set the secret in: GitHub repo → Settings → Secrets → Actions
 *   Value: https://recuperaempresas.onrender.com
 */
window.RE_API_BASE = 'https://recuperaempresas.onrender.com';
