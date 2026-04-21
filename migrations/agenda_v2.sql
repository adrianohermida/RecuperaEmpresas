-- ═══════════════════════════════════════════════════════════════════════════════
-- Agenda v2 — Migrations
-- Execute in Supabase SQL Editor (or via migration tool).
-- All statements use IF NOT EXISTS / IF EXISTS so they are idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. re_agenda_slots — persist Google Calendar event ID and rich fields ────
ALTER TABLE re_agenda_slots ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;
ALTER TABLE re_agenda_slots ADD COLUMN IF NOT EXISTS meet_link          TEXT;
ALTER TABLE re_agenda_slots ADD COLUMN IF NOT EXISTS location           TEXT    DEFAULT 'online';
ALTER TABLE re_agenda_slots ADD COLUMN IF NOT EXISTS description        TEXT;

-- ─── 2. re_bookings — track member identity + reschedule request + reminders ──
--   member_id: which re_company_users row made the booking (NULL = owner booked)
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS member_id                    UUID;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS booker_name                  TEXT;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS booker_email                 TEXT;

--   reschedule request: client asks to move to a different slot
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS reschedule_requested_slot_id UUID;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS reschedule_requested_at      TIMESTAMPTZ;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS reschedule_rejected_at       TIMESTAMPTZ;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS reschedule_reject_reason     TEXT;

--   reminder flags (cron dedup)
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS reminder_sent    BOOLEAN DEFAULT FALSE;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS reminder_1h_sent BOOLEAN DEFAULT FALSE;

--   no_show tracking
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS no_show          BOOLEAN DEFAULT FALSE;
ALTER TABLE re_bookings ADD COLUMN IF NOT EXISTS no_show_at       TIMESTAMPTZ;

-- ─── 3. Indexes for performance ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_re_bookings_user_id
  ON re_bookings(user_id);

CREATE INDEX IF NOT EXISTS idx_re_bookings_slot_id
  ON re_bookings(slot_id);

CREATE INDEX IF NOT EXISTS idx_re_bookings_member_id
  ON re_bookings(member_id) WHERE member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_re_bookings_status
  ON re_bookings(status);

CREATE INDEX IF NOT EXISTS idx_re_agenda_slots_starts_at
  ON re_agenda_slots(starts_at);

CREATE INDEX IF NOT EXISTS idx_re_agenda_slots_calendar_event_id
  ON re_agenda_slots(calendar_event_id) WHERE calendar_event_id IS NOT NULL;

-- ─── 4. Row Level Security: bookings visible to owner OR member of same company
-- (Apply only if RLS is enabled on these tables in your Supabase project)
-- Example policy — adapt to your auth.uid() setup:
--
-- ALTER TABLE re_bookings ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "owner can read own bookings"
--   ON re_bookings FOR SELECT
--   USING (
--     user_id = auth.uid()
--     OR user_id IN (
--       SELECT company_id FROM re_company_users WHERE id = auth.uid()
--     )
--   );
--
-- CREATE POLICY "owner can insert own bookings"
--   ON re_bookings FOR INSERT
--   WITH CHECK (user_id = auth.uid());

-- ─── 5. Helper view: bookings with slot + booker info (optional convenience) ──
CREATE OR REPLACE VIEW re_bookings_full AS
SELECT
  b.*,
  s.starts_at,
  s.ends_at,
  s.title        AS slot_title,
  s.location     AS slot_location,
  s.meet_link    AS slot_meet_link,
  s.duration_min AS slot_duration_min,
  s.credits_cost AS slot_credits_cost,
  u.name         AS client_name,
  u.email        AS client_email,
  u.company      AS client_company,
  m.name         AS member_display_name,
  m.email        AS member_display_email,
  m.role         AS member_role
FROM re_bookings b
LEFT JOIN re_agenda_slots   s ON s.id = b.slot_id
LEFT JOIN re_users          u ON u.id = b.user_id
LEFT JOIN re_company_users  m ON m.id = b.member_id;

-- ─── Done ──────────────────────────────────────────────────────────────────────
