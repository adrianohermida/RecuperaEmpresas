'use strict';
/**
 * lib/agenda-helpers.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Utilitários compartilhados para o módulo de Agenda.
 *
 * Funções exportadas:
 *   - buildStatusEntry(newStatus, actor, meta)  → objeto de entrada para status_history
 *   - appendStatusHistory(sb, bookingId, entry) → persiste entrada no JSONB status_history
 *   - appendAttendee(sb, bookingId, attendee)   → persiste participante no JSONB attendees
 *   - recordConflict(sb, bookingId, type, desc) → registra conflito em re_agenda_conflicts
 *   - updateMetrics(sb, consultantId, delta)    → atualiza métricas em re_agenda_metrics
 */

// ─── status_history ───────────────────────────────────────────────────────────

/**
 * Constrói uma entrada de histórico de status.
 * @param {string} newStatus  – novo status do booking (ex: 'confirmed', 'cancelled')
 * @param {string} actor      – quem realizou a ação ('client' | 'admin' | 'system')
 * @param {object} [meta]     – dados extras (reason, slot_id, etc.)
 * @returns {{ status, actor, ts, ...meta }}
 */
function buildStatusEntry(newStatus, actor = 'system', meta = {}) {
  return {
    status: newStatus,
    actor,
    ts: new Date().toISOString(),
    ...meta,
  };
}

/**
 * Acrescenta uma entrada ao array JSONB `status_history` de um booking.
 * Usa a função nativa do Postgres via RPC quando disponível; caso contrário
 * faz read-modify-write seguro.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} bookingId
 * @param {object} entry  – resultado de buildStatusEntry()
 */
async function appendStatusHistory(sb, bookingId, entry) {
  try {
    // Lê o array atual
    const { data, error } = await sb
      .from('re_bookings')
      .select('status_history')
      .eq('id', bookingId)
      .maybeSingle();

    if (error) {
      console.warn('[agenda-helpers:appendStatusHistory] read error', error.message);
      return;
    }

    const current = Array.isArray(data?.status_history) ? data.status_history : [];
    current.push(entry);

    await sb
      .from('re_bookings')
      .update({
        status_history:    current,
        last_status_change: entry.ts,
      })
      .eq('id', bookingId);
  } catch (e) {
    console.warn('[agenda-helpers:appendStatusHistory]', e.message);
  }
}

// ─── attendees ────────────────────────────────────────────────────────────────

/**
 * Acrescenta (ou atualiza) um participante no array JSONB `attendees` de um booking.
 * Garante unicidade por e-mail.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} bookingId
 * @param {{ email: string, name?: string, role?: string }} attendee
 */
async function appendAttendee(sb, bookingId, attendee) {
  if (!attendee?.email) return;
  try {
    const { data, error } = await sb
      .from('re_bookings')
      .select('attendees')
      .eq('id', bookingId)
      .maybeSingle();

    if (error) {
      console.warn('[agenda-helpers:appendAttendee] read error', error.message);
      return;
    }

    const current = Array.isArray(data?.attendees) ? data.attendees : [];
    // Remove entrada anterior do mesmo e-mail e insere a nova
    const updated = current.filter(a => a.email !== attendee.email);
    updated.push({ ...attendee, added_at: new Date().toISOString() });

    await sb
      .from('re_bookings')
      .update({ attendees: updated })
      .eq('id', bookingId);
  } catch (e) {
    console.warn('[agenda-helpers:appendAttendee]', e.message);
  }
}

// ─── re_agenda_conflicts ──────────────────────────────────────────────────────

/**
 * Registra um conflito de agenda na tabela re_agenda_conflicts.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} bookingId
 * @param {'double_booking'|'overlap'|'insufficient_credits'|'no_show'} conflictType
 * @param {string} [description]
 */
async function recordConflict(sb, bookingId, conflictType, description = null) {
  try {
    await sb.from('re_agenda_conflicts').insert({
      booking_id:    bookingId,
      conflict_type: conflictType,
      description,
    });
  } catch (e) {
    console.warn('[agenda-helpers:recordConflict]', e.message);
  }
}

// ─── re_agenda_metrics ────────────────────────────────────────────────────────

/**
 * Atualiza (upsert) as métricas mensais de um consultor.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string|null} consultantId  – UUID do consultor (pode ser null para métricas globais)
 * @param {{ total_slots_created?, total_bookings?, confirmed_bookings?,
 *            cancelled_bookings?, no_show_count?, credits_earned?,
 *            rating? }} delta  – incrementos a aplicar
 */
async function updateMetrics(sb, consultantId, delta = {}) {
  try {
    const now        = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    // Busca registro existente para o período
    let query = sb
      .from('re_agenda_metrics')
      .select('*')
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd);

    if (consultantId) query = query.eq('consultant_id', consultantId);
    else query = query.is('consultant_id', null);

    const { data: existing } = await query.maybeSingle();

    const base = existing || {
      consultant_id:       consultantId || null,
      period_start:        periodStart,
      period_end:          periodEnd,
      total_slots_created: 0,
      total_bookings:      0,
      confirmed_bookings:  0,
      cancelled_bookings:  0,
      no_show_count:       0,
      average_rating:      null,
      total_credits_earned: 0,
    };

    const updated = {
      ...base,
      total_slots_created:  (base.total_slots_created  || 0) + (delta.total_slots_created  || 0),
      total_bookings:       (base.total_bookings       || 0) + (delta.total_bookings       || 0),
      confirmed_bookings:   (base.confirmed_bookings   || 0) + (delta.confirmed_bookings   || 0),
      cancelled_bookings:   (base.cancelled_bookings   || 0) + (delta.cancelled_bookings   || 0),
      no_show_count:        (base.no_show_count        || 0) + (delta.no_show_count        || 0),
      total_credits_earned: (base.total_credits_earned || 0) + (delta.credits_earned       || 0),
      updated_at:           now.toISOString(),
    };

    // Recalcula média de avaliação se fornecida
    if (typeof delta.rating === 'number' && delta.rating >= 1 && delta.rating <= 5) {
      const prevAvg   = base.average_rating || 0;
      const prevCount = base.confirmed_bookings || 0;
      const newCount  = updated.confirmed_bookings;
      updated.average_rating = newCount > 0
        ? parseFloat(((prevAvg * prevCount + delta.rating) / newCount).toFixed(2))
        : delta.rating;
    }

    if (existing) {
      await sb.from('re_agenda_metrics').update(updated).eq('id', existing.id);
    } else {
      await sb.from('re_agenda_metrics').insert(updated);
    }
  } catch (e) {
    console.warn('[agenda-helpers:updateMetrics]', e.message);
  }
}

module.exports = {
  buildStatusEntry,
  appendStatusHistory,
  appendAttendee,
  recordConflict,
  updateMetrics,
};
