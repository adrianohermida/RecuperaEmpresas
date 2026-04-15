# Claude Code Instructions

## Deployment Model

- Production runs on a single origin: `https://recuperaempresas.com.br`
- Render serves both the frontend pages and the backend API
- Default API usage must be same-origin: use relative routes like `/api/auth/login`
- Do not reintroduce GitHub Pages split-origin assumptions unless explicitly requested

## API Rules

- Do not hardcode `https://recuperaempresas.onrender.com` in frontend code
- Keep `window.RE_API_BASE = ''` by default
- Only set `RE_API_BASE` for a deliberate non-production environment
- Prefer `fetch('/api/...')` over absolute API URLs

## Supabase Rules

- Supabase project URL must stay `https://riiajjmnzgagntiqqshs.supabase.co`
- Never replace the configured project ref unless explicitly requested
- Do not bypass Supabase auth email flows with custom auth emails
- Use Supabase native flows/templates for:
  - confirm sign up
  - invite user
  - magic link
  - change email
  - reset password
  - reauthentication
- Keep auth redirects consistent with the production origin:
  - `/login.html?confirmed=1`
  - `/login.html?invited=1`
  - `/login.html?magic=1`
  - `/login.html?email_changed=1`
  - `/login.html?reauthenticated=1`
  - `/reset-password.html`
  - `/oauth/consent`
  - `/api/auth/oauth/callback`

## Before Editing Auth

- Check `server.js`, `login.html`, `register.html`, `forgot-password.html`, `reset-password.html`, `oauth-consent.html`
- Preserve same-origin `/api/*` routing
- Preserve Supabase session handling in the browser for OAuth consent
- After changes, validate:
  - `/api/health`
  - register
  - login
  - forgot password
  - OAuth consent entry page

## Dangerous Mistakes To Avoid

- Do not point production frontend back to GitHub Pages logic
- Do not change `/api/*` to absolute URLs in production
- Do not remove the browser Supabase session setup used by OAuth consent
- Do not swap out Supabase templates with parallel custom auth emails
