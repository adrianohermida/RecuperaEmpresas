import { requireAdmin, requireAuth } from './lib/auth.mjs';
import { applyCors, json, noContent, notFound } from './lib/http.mjs';
import { handleAdminSystem } from './routes/admin-system.mjs';
import { handleAppointments } from './routes/appointments.mjs';
import { handleCreditors } from './routes/creditors.mjs';
import { handleDataChangeRequests } from './routes/data-change-requests.mjs';
import { handleDepartments } from './routes/departments.mjs';
import { handleDocumentRequests } from './routes/document-requests.mjs';
import { handleEmployees } from './routes/employees.mjs';
import { handleMessages } from './routes/messages.mjs';
import { handlePlan } from './routes/plan.mjs';
import { handleTasks } from './routes/tasks.mjs';
import { handleNotifications } from './routes/notifications.mjs';

function withCors(request, response, env) {
  return applyCors(request, response, env);
}

function match(pathname, pattern) {
  const matchResult = pathname.match(pattern);
  return matchResult ? matchResult.groups || {} : null;
}

async function routeAuthenticated(request, env, pathname, executionCtx) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  let params = match(pathname, /^\/api\/appointments(?:\/(?<id>[^/]+))?$/);
  if (params) return handleAppointments(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/creditors(?:\/(?<id>[^/]+))?$/);
  if (params) return handleCreditors(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/departments(?:\/(?<id>[^/]+))?$/);
  if (params) return handleDepartments(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/employees(?:\/(?<id>[^/]+))?$/);
  if (params) return handleEmployees(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/messages(?:\/(?<action>poll))?$/);
  if (params) return handleMessages(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/change-requests(?:\/(?<token>[^/]+))?$/);
  if (params) return handleDataChangeRequests(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/document-requests(?:\/(?<reqId>[^/]+)(?:\/(?<action>fulfill))?)?$/);
  if (params) return handleDocumentRequests(request, { ...auth, env, executionCtx, params, scope: 'user' });

  params = match(pathname, /^\/api\/plan(?:\/chapter\/(?<id>\d+))?$/);
  if (params) return handlePlan(request, { ...auth, env, executionCtx, params });

  params = match(pathname, /^\/api\/tasks(?:\/(?<id>[^/]+))?$/);
  if (params) return handleTasks(request, { ...auth, env, executionCtx, params });

  params = match(pathname, /^\/api\/notifications(?:\/(?<id>[^/]+))?$/);
  if (params) return handleNotifications(request, { ...auth, env, executionCtx, params });

  return notFound();
}

async function routeAdmin(request, env, pathname, executionCtx) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  let params = match(pathname, /^\/api\/admin\/appointments(?:\/(?<id>[^/]+))?$/);
  if (params) return handleAppointments(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/creditors(?:\/(?<creditorId>[^/]+))?$/);
  if (params) return handleCreditors(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/departments(?:\/(?<deptId>[^/]+))?$/);
  if (params) return handleDepartments(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/members\/(?<action>invite)$/);
  if (params) return handleDepartments(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/members\/(?<memberId>[^/]+)\/department$/);
  if (params) return handleDepartments(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/employees(?:\/(?<empId>[^/]+))?$/);
  if (params) return handleEmployees(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/messages\/(?<action>unread)(?:\/(?<clientId>[^/]+))?$/);
  if (params) return handleMessages(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/messages\/(?<action>seen)\/(?<clientId>[^/]+)$/);
  if (params) return handleMessages(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/messages\/(?<action>poll)$/);
  if (params) return handleMessages(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/change-request$/);
  if (params) return handleDataChangeRequests(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/change-requests$/);
  if (params) return handleDataChangeRequests(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/document-requests(?:\/(?<action>suggestions))?$/);
  if (params) return handleDocumentRequests(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/document-requests\/(?<reqId>[^/]+)$/);
  if (params) return handleDocumentRequests(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/(?<resource>logs|stats)$/);
  if (params) return handleAdminSystem(request, { ...auth, env, executionCtx, params, scope: 'admin' });

  return notFound();
}

export default {
  async fetch(request, env, executionCtx) {
    if (request.method === 'OPTIONS') {
      return withCors(request, noContent(), env);
    }

    const url = new URL(request.url);
    let response;

    if (request.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/healthz')) {
      response = json({ status: 'ok', ts: new Date().toISOString(), runtime: 'cloudflare-worker' });
      return withCors(request, response, env);
    }

    if (url.pathname.startsWith('/api/admin/')) {
      response = await routeAdmin(request, env, url.pathname, executionCtx);
      return withCors(request, response, env);
    }

    if (url.pathname.startsWith('/api/')) {
      response = await routeAuthenticated(request, env, url.pathname, executionCtx);
      return withCors(request, response, env);
    }

    return withCors(request, notFound(), env);
  },
};