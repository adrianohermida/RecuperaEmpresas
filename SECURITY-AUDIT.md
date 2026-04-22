# Security Audit — Supabase Query Isolation

**Date:** 2026-04-21
**Scope:** Backend routes in `routes/` — Supabase queries audited for cross-user data leakage.

---

## 1. Architecture Context

This is a **single-admin / multi-client** platform, NOT a multi-tenant SaaS:

- There is **one admin** (consultant) who manages all client companies.
- Each client is a row in `re_users` with `is_admin = false`.
- The `requireAdmin` middleware loads the admin from `re_users` — the admin user does **not** have a `company_id` field relevant for cross-tenant filtering.
- `company_id` only exists on **member tokens** (`re_company_users`) for sub-users of a client company.
- Defense-in-depth therefore means: **admin routes must verify the target user/resource belongs to the request, not to another admin call**, and **client routes must scope to `req.user.id`**.

---

## 2. Vulnerabilities Found and Fixed

### VULN-01 — `routes/forms.js` line 661 — Tipo C: Response ID without form_id ownership check

**Severity:** Medium

**Route:** `GET /api/admin/forms/:id/responses/:responseId`

**Problem:** The query fetched `re_form_responses` by `responseId` alone, without verifying that the response belonged to the form specified in `:id`. An admin could call `/api/admin/forms/FORM_A/responses/RESPONSE_FROM_FORM_B` and retrieve responses from a completely different form. In a multi-admin scenario this would allow cross-tenant response access.

```js
// Before (insecure)
const { data: response } = await sb.from('re_form_responses')
  .select('*,...')
  .eq('id', req.params.responseId).single();

// After (secure)
const { data: response } = await sb.from('re_form_responses')
  .select('*,...')
  .eq('id', req.params.responseId)
  .eq('form_id', req.params.id)   // ← added ownership check
  .single();
```

**Status:** FIXED

---

### VULN-02 — `routes/journeys.js` line 182 — Tipo C: Assignment update without journey_id ownership check

**Severity:** Medium

**Route:** `PUT /api/admin/journeys/:id/assignments/:asnId`

**Problem:** The query updated `re_journey_assignments` filtering only by `asnId`. An admin could pass any `asnId` regardless of whether it belonged to journey `:id`. A malicious or misconfigured request could update assignments from other journeys.

```js
// Before (insecure)
const { data } = await sb.from('re_journey_assignments')
  .update(updates).eq('id', req.params.asnId).select().single();

// After (secure)
const { data } = await sb.from('re_journey_assignments')
  .update(updates)
  .eq('id', req.params.asnId)
  .eq('journey_id', req.params.id)   // ← added ownership check
  .select().single();
```

**Status:** FIXED

---

## 3. Queries Audited and Marked OK

### `routes/admin-clients.js`

| Route | Query | Assessment |
|---|---|---|
| `GET /api/admin/clients` | `re_users.select('*').eq('is_admin', false)` | OK — intentionally lists all non-admin clients for the single admin |
| `GET /api/admin/client/:id` | `findUserById(req.params.id)` | OK — `findUserById` looks up by ID; result is used for display only |
| `POST /api/admin/clients/bulk-action` delete | `re_users.select(...).in('id', ids)` then `.filter(u => !u.is_admin)` | OK — admin escalation prevented by filtering out admins before delete |
| `POST /api/admin/client/:id/task` | `re_tasks.insert({ user_id: req.params.id, ... })` | OK — `user_id` is set from URL param (admin assigns to a specific client) |
| `GET /api/admin/client/:id/bookings` | `re_bookings...eq('user_id', req.params.id)` | OK — scoped to the specific client |
| `POST /api/admin/client/:id/message` | `re_messages.insert({ user_id: req.params.id, ... })` | OK — scoped to client |
| `DELETE /api/admin/client/:id` | `re_users.delete().eq('id', req.params.id)` | OK — deletes by exact ID; `is_admin` check done first |
| `PUT /api/admin/client/:id` (LGPD) | `re_data_change_requests.insert({ company_id: req.params.id, ... })` | OK (semantic note below) |

> **Note on `re_data_change_requests.company_id`:** The field is named `company_id` but stores the target client's user ID (`req.params.id`). This is internally consistent — it appears this table uses `company_id` as the owning user reference. No query isolation issue, but the field naming is misleading. Mark for schema review.

### `routes/forms.js`

| Route | Query | Assessment |
|---|---|---|
| `GET /api/admin/forms` | `re_forms.select(...)` (no company_id filter) | OK by architecture — single admin owns all forms |
| `POST /api/admin/forms` | `re_forms.insert({ ..., created_by: req.user.id, ... })` | OK — `created_by` is set |
| `PUT /api/admin/forms/:id` | `re_forms.update(...).eq('id', req.params.id)` | OK — single admin, no tenant isolation needed |
| `DELETE /api/admin/forms/:id` | `re_forms.delete().eq('id', req.params.id)` | OK |
| `GET /api/admin/forms/:id/responses` | `re_form_responses...eq('form_id', req.params.id)` | OK — scoped to form |
| `GET /api/admin/forms/:id/responses/:responseId` | See VULN-01 above | FIXED |
| `GET /api/forms/:id` (client) | `re_form_assignments...eq('form_id',...).eq('user_id', req.user.id)` | OK — checks assignment ownership |
| `POST /api/forms/:id/responses` (client) | `re_form_responses.insert({ form_id, user_id: req.user.id, ... })` | OK |
| `PUT /api/forms/:id/responses/:responseId` (client) | Fetches response, then checks `response.user_id !== req.user.id` | OK — ownership verified |
| `POST /api/forms/:id/responses/:responseId/complete` (client) | Checks `response.user_id !== req.user.id` | OK |
| `GET /api/my-forms`, `GET /api/my-forms/:id`, `POST /api/my-forms/:id/response` | All scoped by `userId = req.user.id` with assignment check | OK |

### `routes/journeys.js`

| Route | Query | Assessment |
|---|---|---|
| `GET /api/admin/journeys` | `re_journeys.select('*')` | OK by architecture |
| `GET /api/admin/journeys/:id` | `re_journeys...eq('id', req.params.id)` | OK |
| `POST /api/admin/journeys` | `re_journeys.insert({ ..., created_by: req.user.id })` | OK |
| `PUT /api/admin/journeys/:id` | `re_journeys.update(...).eq('id', req.params.id)` | OK |
| `DELETE /api/admin/journeys/:id` | `re_journeys.delete().eq('id', req.params.id)` | OK |
| `POST /api/admin/journeys/:id/steps` | `re_journey_steps.insert({ journey_id: req.params.id, ... })` | OK |
| `PUT /api/admin/journeys/:id/steps/:stepId` | `.eq('id', req.params.stepId).eq('journey_id', req.params.id)` | OK — double-keyed |
| `DELETE /api/admin/journeys/:id/steps/:stepId` | `.eq('id', req.params.stepId).eq('journey_id', req.params.id)` | OK |
| `GET /api/admin/journeys/:id/assignments` | `.eq('journey_id', req.params.id)` | OK |
| `POST /api/admin/journeys/:id/assignments` | `re_journey_assignments.upsert({ journey_id: req.params.id, ... })` | OK |
| `PUT /api/admin/journeys/:id/assignments/:asnId` | See VULN-02 above | FIXED |
| `DELETE /api/admin/journeys/:id/assignments/:asnId` | `.eq('id', req.params.asnId).eq('journey_id', req.params.id)` | OK |
| `POST /api/admin/journeys/:id/assignments/:asnId/complete-step` | `.eq('id', req.params.asnId)` only on upsert | NEEDS REVIEW (see below) |
| `GET /api/admin/journeys/:id/assignments/:asnId/progress` | `.eq('id', req.params.asnId)` | NEEDS REVIEW (see below) |
| `GET /api/my-journeys` (client) | `.eq('user_id', uid)` | OK |
| `POST /api/my-journeys/:asnId/complete-step` (client) | `.eq('id', req.params.asnId).eq('user_id', uid)` | OK |

### `routes/admin-agenda.js`

| Route | Query | Assessment |
|---|---|---|
| `GET /api/admin/agenda/slots` | Fetches all slots, then bookings by slot IDs | OK by architecture |
| `POST /api/admin/agenda/slots` | Creates slot with `created_by: req.user.id` | OK |
| `DELETE /api/admin/agenda/slots/:slotId` | Deletes by `id` only | OK (single admin) |
| `PUT .../bookings/:bookingId/confirm` | Fetches booking by `id`, updates by `id` | OK (single admin) |
| `PUT .../bookings/:bookingId/cancel` | Fetches booking by `id`, updates by `id` | OK (single admin) |
| `PUT .../bookings/:bookingId/reschedule` | Fetches booking by `id` | OK (single admin) |
| `POST .../book-for-client` | Inserts with explicit `slot_id`, `user_id` | OK |

### `routes/tasks.js`

| Route | Query | Assessment |
|---|---|---|
| `GET /api/tasks` | `readTasks(req.user.id)` → `.eq('user_id', userId)` | OK |
| `PUT /api/tasks/:id` | `.eq('id', ...).eq('user_id', req.user.id)` | OK — double-keyed |

---

## 4. NEEDS REVIEW Items (not fixed — require further analysis)

### NR-01 — `journeys.js` `complete-step` (admin) — FIXED

**Route:** `POST /api/admin/journeys/:id/assignments/:asnId/complete-step`

**Status:** FIXED (2026-04-22) — Added ownership check to verify that `asnId` belongs to journey `req.params.id` before upserting completion.

### NR-02 — `journeys.js` `progress` (admin) — FIXED

**Route:** `GET /api/admin/journeys/:id/assignments/:asnId/progress`

**Status:** FIXED (2026-04-22) — Added `.eq('journey_id', req.params.id)` to the query to ensure data isolation.

### NR-03 — `admin-clients.js` `re_data_change_requests` — FIXED

**Status:** FIXED (2026-04-22) — Renamed the logic and references from `company_id` to `user_id` in the backend routes and workers to align with the actual data stored (user ID) and avoid architectural confusion.

---

## 5. Supabase RLS Recommendations

Based on the audit, the following tables should have RLS enabled with appropriate policies:

| Table | Recommended Policy |
|---|---|
| `re_forms` | `anon`/`authenticated` can read `active`/`publicado` forms; service role bypasses RLS for admin operations |
| `re_form_responses` | Users can read/write own responses (`user_id = auth.uid()`); `is null` user_id allowed for public/anon responses |
| `re_form_answers` | Access via `response_id` — ensure response ownership check cascades |
| `re_journey_assignments` | Users can read own assignments (`user_id = auth.uid()`) |
| `re_journey_step_completions` | Access only via assignment ownership |
| `re_tasks` | Users can read/update own tasks (`user_id = auth.uid()`) |
| `re_messages` | Users can read own messages (`user_id = auth.uid()`) |
| `re_bookings` | Users can read own bookings (`user_id = auth.uid()`) |
| `re_onboarding` | Users can read/write own record (`user_id = auth.uid()`) |
| `re_plan_chapters` | Users can read own chapters (`user_id = auth.uid()`) |
| `re_users` | Users can read own record (`id = auth.uid()`); admin bypass via service role |
| `re_data_change_requests` | Users can read own requests; admin via service role |

> **Important:** The backend currently uses a **service role key** (assumed) to bypass RLS. RLS is the last line of defense if the application key is ever exposed. Enable RLS on all tables above and ensure the service role is only used server-side.

---

## 6. Files Modified

| File | Change |
|---|---|
| `routes/forms.js` | Added `.eq('form_id', req.params.id)` to `GET /api/admin/forms/:id/responses/:responseId` (VULN-01) |
| `routes/journeys.js` | Added `.eq('journey_id', req.params.id)` to `PUT /api/admin/journeys/:id/assignments/:asnId` (VULN-02) |
| `routes/journeys.js` | Fixed NR-01 and NR-02 (Ownership validation for assignments) |
| `routes/admin-clients.js` | Fixed NR-03 (Standardized `user_id` in change requests) |
| `routes/data-change-requests.js` | Fixed NR-03 (Standardized `user_id` in change requests) |
| `workers/portal-api/...` | Fixed NR-03 (Standardized `user_id` in change requests) |

---

## 7. Overall Assessment

The codebase is **generally well-isolated** for a single-admin platform. Client-facing routes consistently scope by `req.user.id`. The two fixed vulnerabilities were parameter traversal risks (using `:responseId` / `:asnId` without verifying they belonged to the parent resource in the URL).

No evidence of data being returned to wrong tenants in the currently-shipped code. The RLS layer should be strengthened as a secondary defense.
