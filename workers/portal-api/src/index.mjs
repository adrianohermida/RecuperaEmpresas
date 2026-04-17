import { requireAdmin, requireAuth } from './lib/auth.mjs';
import { applyCors, json, noContent, notFound } from './lib/http.mjs';
import { handleAdminSystem } from './routes/admin-system.mjs';
import { handleAppointments } from './routes/appointments.mjs';
import { handleCreditors } from './routes/creditors.mjs';
import { handleDepartments } from './routes/departments.mjs';
import { handleEmployees } from './routes/employees.mjs';
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

async function routeAuthenticated(request, env, pathname) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  let params = match(pathname, /^\/api\/appointments(?:\/(?<id>[^/]+))?$/);
  if (params) return handleAppointments(request, { ...auth, params, scope: 'user' });

  params = match(pathname, /^\/api\/creditors(?:\/(?<id>[^/]+))?$/);
  if (params) return handleCreditors(request, { ...auth, params, scope: 'user' });

  params = match(pathname, /^\/api\/departments(?:\/(?<id>[^/]+))?$/);
  if (params) return handleDepartments(request, { ...auth, params, scope: 'user' });

  params = match(pathname, /^\/api\/employees(?:\/(?<id>[^/]+))?$/);
  if (params) return handleEmployees(request, { ...auth, params, scope: 'user' });

  params = match(pathname, /^\/api\/plan(?:\/chapter\/(?<id>\d+))?$/);
  if (params) return handlePlan(request, { ...auth, params });

  params = match(pathname, /^\/api\/tasks(?:\/(?<id>[^/]+))?$/);
  if (params) return handleTasks(request, { ...auth, params });

  params = match(pathname, /^\/api\/notifications(?:\/(?<id>[^/]+))?$/);
  if (params) return handleNotifications(request, { ...auth, params });

  return notFound();
}

async function routeAdmin(request, env, pathname) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  let params = match(pathname, /^\/api\/admin\/appointments(?:\/(?<id>[^/]+))?$/);
  if (params) return handleAppointments(request, { ...auth, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/creditors(?:\/(?<creditorId>[^/]+))?$/);
  if (params) return handleCreditors(request, { ...auth, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/departments(?:\/(?<deptId>[^/]+))?$/);
  if (params) return handleDepartments(request, { ...auth, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/members\/(?<memberId>[^/]+)\/department$/);
  if (params) return handleDepartments(request, { ...auth, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/client\/(?<clientId>[^/]+)\/employees(?:\/(?<empId>[^/]+))?$/);
  if (params) return handleEmployees(request, { ...auth, params, scope: 'admin' });

  params = match(pathname, /^\/api\/admin\/(?<resource>logs|stats)$/);
  if (params) return handleAdminSystem(request, { ...auth, params, scope: 'admin' });

  return notFound();
}

export default {
  async fetch(request, env) {
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
      response = await routeAdmin(request, env, url.pathname);
      return withCors(request, response, env);
    }

    if (url.pathname.startsWith('/api/')) {
      response = await routeAuthenticated(request, env, url.pathname);
      return withCors(request, response, env);
    }

    return withCors(request, notFound(), env);
  },
};