'use strict';
/**
 * lib/calendar.js — Google Calendar integration
 *
 * Auth strategy (in order of preference):
 *   1. OAuth2 refresh_token (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_OAUTH_REFRESH_TOKEN)
 *      → Operates as Camila's personal account — can read/write her primary calendar
 *   2. Service account fallback (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY)
 *      → Only works if Camila shared her calendar with the service account
 *
 * All functions return null/undefined on misconfiguration and log a warning
 * rather than throwing — callers treat calendar as optional.
 */

const crypto = require('crypto');
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_OAUTH_REFRESH_TOKEN,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_CALENDAR_ID,
  GOOGLE_CALENDAR_TZ,
  GOOGLE_CALENDAR_WEBHOOK_SECRET,
  BASE_URL,
} = require('./config');

const CAL_ID  = GOOGLE_CALENDAR_ID || 'primary';
const CAL_TZ  = GOOGLE_CALENDAR_TZ || 'America/Sao_Paulo';
const CAL_API = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}`;

// ─── Token cache ──────────────────────────────────────────────────────────────
let _token    = null;
let _tokenExp = 0;

// ─── Auth: OAuth2 refresh_token (preferred) ───────────────────────────────────
async function _oauthAccessToken() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) return null;
  if (_token && Date.now() < _tokenExp - 60_000) return _token;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[GCAL] OAuth2 token refresh failed:', err);
      return null;
    }
    const { access_token, expires_in } = await res.json();
    _token    = access_token;
    _tokenExp = Date.now() + (expires_in || 3600) * 1000;
    return _token;
  } catch (e) {
    console.warn('[GCAL] OAuth2 token error:', e.message);
    return null;
  }
}

// ─── Auth: Service account fallback ──────────────────────────────────────────
async function _serviceAccountToken() {
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return null;
  if (_token && Date.now() < _tokenExp - 60_000) return _token;
  try {
    const now     = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss:   GOOGLE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud:   'https://oauth2.googleapis.com/token',
      iat:   now,
      exp:   now + 3600,
    })).toString('base64url');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(GOOGLE_PRIVATE_KEY, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  `${header}.${payload}.${sig}`,
      }),
    });
    if (!res.ok) return null;
    const { access_token, expires_in } = await res.json();
    _token    = access_token;
    _tokenExp = Date.now() + (expires_in || 3600) * 1000;
    return _token;
  } catch (e) {
    console.warn('[GCAL] service account auth:', e.message);
    return null;
  }
}

/** Returns a valid access token using whichever auth method is configured. */
async function _gcAccessToken() {
  return (await _oauthAccessToken()) || (await _serviceAccountToken());
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function _dt(iso) { return { dateTime: iso, timeZone: CAL_TZ }; }

async function _calFetch(path, method, body) {
  const token = await _gcAccessToken();
  if (!token) return null;
  const url  = path.startsWith('http') ? path : `${CAL_API}${path}`;
  const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    if (method === 'DELETE') return res.ok ? true : null;
    if (!res.ok) { console.warn(`[GCAL] ${method} ${path}:`, await res.text()); return null; }
    return res.json();
  } catch (e) {
    console.warn(`[GCAL] ${method} ${path}:`, e.message);
    return null;
  }
}

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Create a calendar event and request a Google Meet link.
 * Returns the created event object (contains .id and .hangoutLink).
 */
async function gcCreateEvent({ summary, description, start, end, attendeeEmails = [] }) {
  const body = {
    summary,
    description: description || '',
    start: _dt(start),
    end:   _dt(end),
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 30 }],
    },
  };
  if (attendeeEmails.length) {
    body.attendees = attendeeEmails.map(email => ({ email }));
  }
  // conferenceDataVersion=1 is required to get the Meet link back
  const event = await _calFetch(`/events?sendUpdates=all&conferenceDataVersion=1`, 'POST', body);
  return event; // { id, hangoutLink, ... } or null
}

/**
 * Patch an existing calendar event (partial update).
 * Returns the updated event object or null on failure.
 */
async function gcPatchEvent(eventId, patch) {
  if (!eventId) return null;
  return _calFetch(`/events/${eventId}?sendUpdates=all&conferenceDataVersion=1`, 'PATCH', patch);
}

/**
 * Delete a calendar event.
 * Returns true on success, null on failure/misconfiguration.
 */
async function gcDeleteEvent(eventId) {
  if (!eventId) return null;
  return _calFetch(`/events/${eventId}?sendUpdates=all`, 'DELETE');
}

// ─── Read operations ──────────────────────────────────────────────────────────

/**
 * Query free/busy periods for the calendar.
 * Returns an array of { start, end } busy intervals (ISO strings).
 */
async function gcFreeBusy(timeMin, timeMax) {
  const body = {
    timeMin, timeMax,
    timeZone: CAL_TZ,
    items: [{ id: CAL_ID }],
  };
  const data = await _calFetch(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    'POST',
    body
  );
  if (!data) return [];
  return data.calendars?.[CAL_ID]?.busy || [];
}

/**
 * List events in a time range.
 * Returns an array of calendar event objects.
 */
async function gcListEvents(timeMin, timeMax, maxResults = 250) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   String(maxResults),
  });
  const data = await _calFetch(`/events?${params}`, 'GET');
  return data?.items || [];
}

/**
 * Get a single event by ID.
 */
async function gcGetEvent(eventId) {
  if (!eventId) return null;
  return _calFetch(`/events/${eventId}`, 'GET');
}

/**
 * Compute available (free) time windows within working hours,
 * given a list of busy intervals from gcFreeBusy().
 *
 * @param {Array<{start,end}>} busyIntervals
 * @param {string}             dateStr      'YYYY-MM-DD'
 * @param {number}             slotMinutes  duration of each free window (default 60)
 * @param {{start,end}}        workHours    { start: '08:00', end: '18:00' }
 * @returns {Array<{start,end}>}            free slot windows as ISO strings
 */
function computeFreeWindows(busyIntervals, dateStr, slotMinutes = 60, workHours = { start: '08:00', end: '18:00' }) {
  const [wh, wm] = workHours.start.split(':').map(Number);
  const [eh, em] = workHours.end.split(':').map(Number);
  const dayStart = new Date(`${dateStr}T${workHours.start}:00`);
  const dayEnd   = new Date(`${dateStr}T${workHours.end}:00`);

  // Sort and merge busy intervals
  const sorted = busyIntervals
    .map(b => ({ s: new Date(b.start), e: new Date(b.end) }))
    .filter(b => b.e > dayStart && b.s < dayEnd)
    .sort((a, b) => a.s - b.s);

  const merged = [];
  for (const b of sorted) {
    const s = b.s < dayStart ? dayStart : b.s;
    const e = b.e > dayEnd   ? dayEnd   : b.e;
    if (!merged.length || s > merged[merged.length - 1].e) merged.push({ s, e });
    else merged[merged.length - 1].e = e > merged[merged.length - 1].e ? e : merged[merged.length - 1].e;
  }

  // Build free windows
  const free = [];
  let cursor = new Date(dayStart);
  for (const busy of merged) {
    if (cursor < busy.s) {
      const gapMs = busy.s - cursor;
      if (gapMs >= slotMinutes * 60_000) {
        free.push({ start: cursor.toISOString(), end: busy.s.toISOString() });
      }
    }
    if (busy.e > cursor) cursor = new Date(busy.e);
  }
  if (cursor < dayEnd && dayEnd - cursor >= slotMinutes * 60_000) {
    free.push({ start: cursor.toISOString(), end: dayEnd.toISOString() });
  }
  return free;
}

/**
 * Subscribe to push notifications for calendar changes.
 * Call once on server start (or store channelId + expiration to renew).
 * Requires BASE_URL to be a publicly accessible HTTPS URL.
 */
async function gcWatchCalendar(channelId, ttlSeconds = 86400) {
  if (!BASE_URL || BASE_URL.includes('localhost')) return null; // webhooks only work on public URLs
  const body = {
    id:      channelId || crypto.randomUUID(),
    type:    'web_hook',
    address: `${BASE_URL}/api/admin/agenda/google-webhook`,
    token:   GOOGLE_CALENDAR_WEBHOOK_SECRET || undefined,
    params:  { ttl: String(ttlSeconds) },
  };
  return _calFetch(`/events/watch`, 'POST', body);
}

/**
 * Stop a push notification channel.
 */
async function gcStopWatch(channelId, resourceId) {
  const token = await _gcAccessToken();
  if (!token) return null;
  return _calFetch('https://www.googleapis.com/calendar/v3/channels/stop', 'POST', {
    id: channelId,
    resourceId,
  });
}

module.exports = {
  _gcAccessToken,
  gcCreateEvent,
  gcPatchEvent,
  gcDeleteEvent,
  gcFreeBusy,
  gcListEvents,
  gcGetEvent,
  gcWatchCalendar,
  gcStopWatch,
  computeFreeWindows,
  CAL_ID,
  CAL_TZ,
};
