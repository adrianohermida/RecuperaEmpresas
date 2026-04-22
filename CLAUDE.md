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

## Recent Improvements (April 2026)

### Security & Data Integrity
- **Vulnerability Fixes**: Resolved NR-01 and NR-02 in `routes/journeys.js` (ownership validation for assignments).
- **Data Standardization**: Fixed NR-03 by renaming `company_id` to `user_id` in `re_data_change_requests` across backend and workers for architectural clarity.
- **Audit Log**: Updated `SECURITY-AUDIT.md` with the status of all resolved vulnerabilities.

### UX & Feedback Visual
- **Loading States**: Implemented visual feedback (spinners/disabled buttons) in Perfil, Configurações, and Agenda Admin.
- **Toasts**: Standardized success/error notifications across critical flows.
- **Persistence Feedback**: Added "Saving..." indicators for automatic preference updates.

### Integrations
- **Freshchat**: Consolidated JWT-based authentication across Client Portal and Admin. Added `/api/admin/freshchat/identity` for real-time diagnostic in the Integrations page.
- **Google Calendar**: Refined synchronization logic in `lib/calendar.js` to ensure event status consistency during cancellations and reschedules.
