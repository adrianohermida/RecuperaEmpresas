'use strict';
const crypto = require('crypto');
const { GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_TZ } = require('./config');

// ─── Google Calendar (service account via REST) ───────────────────────────────
let _gcToken = null, _gcTokenExp = 0;

async function _gcAccessToken() {
  if (_gcToken && Date.now() < _gcTokenExp - 60_000) return _gcToken;
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) return null;
  try {
    const now     = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: GOOGLE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud:  'https://oauth2.googleapis.com/token',
      iat:  now, exp: now + 3600,
    })).toString('base64url');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(GOOGLE_PRIVATE_KEY, 'base64url');
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${sig}` }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    _gcToken = d.access_token; _gcTokenExp = Date.now() + d.expires_in * 1000;
    return _gcToken;
  } catch (e) { console.warn('[GCAL] auth:', e.message); return null; }
}

async function gcCreateEvent({ summary, description, start, end, attendeeEmail }) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const token = await _gcAccessToken();
  if (!token) return null;
  try {
    const body = {
      summary, description: description || '',
      start: { dateTime: start, timeZone: GOOGLE_CALENDAR_TZ },
      end:   { dateTime: end,   timeZone: GOOGLE_CALENDAR_TZ },
      reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 30 }] },
    };
    if (attendeeEmail) body.attendees = [{ email: attendeeEmail }];
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?sendUpdates=all`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    if (!res.ok) { console.warn('[GCAL] create:', await res.text()); return null; }
    return (await res.json()).id;
  } catch (e) { console.warn('[GCAL] create:', e.message); return null; }
}

async function gcPatchEvent(eventId, patch) {
  if (!GOOGLE_CALENDAR_ID || !eventId) return;
  const token = await _gcAccessToken();
  if (!token) return;
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}?sendUpdates=all`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
  ).catch(e => console.warn('[GCAL] patch:', e.message));
}

async function gcDeleteEvent(eventId) {
  if (!GOOGLE_CALENDAR_ID || !eventId) return;
  const token = await _gcAccessToken();
  if (!token) return;
  await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}?sendUpdates=all`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  ).catch(e => console.warn('[GCAL] delete:', e.message));
}

module.exports = {
  _gcToken,
  _gcTokenExp,
  _gcAccessToken,
  gcCreateEvent,
  gcPatchEvent,
  gcDeleteEvent,
};
