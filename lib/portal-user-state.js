'use strict';

const { sb } = require('./config');

const DEFAULT_PROFILE = {
  phone: '',
  bio: '',
  qualifications: '',
  competencies: [],
  social_links: {
    linkedin: '',
    instagram: '',
    website: '',
    whatsapp: '',
  },
  signature_html: '',
  avatar_data_url: '',
  tenant_links: [],
};

const DEFAULT_PREFERENCES = {
  notifMessages: true,
  notifNewClients: true,
  notifSteps: true,
  prefCompactTable: false,
  prefShowProgress: true,
  prefOpenKanbanByDefault: true,
  prefCollapseFiltersOnMobile: true,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeText(value, maxLength = 1000) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeTag(value) {
  return sanitizeText(value, 40);
}

function sanitizeTagList(values) {
  const list = Array.isArray(values)
    ? values
    : String(values || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  return [...new Set(list.map(sanitizeTag).filter(Boolean))].slice(0, 24);
}

function sanitizeSocialLinks(value) {
  const input = asObject(value);
  return {
    linkedin: sanitizeText(input.linkedin, 200),
    instagram: sanitizeText(input.instagram, 200),
    website: sanitizeText(input.website, 200),
    whatsapp: sanitizeText(input.whatsapp, 60),
  };
}

function sanitizeTenantLinks(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const record = asObject(item);
      return {
        type: sanitizeText(record.type, 40),
        label: sanitizeText(record.label, 120),
        tenant_id: sanitizeText(record.tenant_id || record.tenantId, 80),
        role: sanitizeText(record.role, 60),
      };
    })
    .filter((item) => item.type || item.label || item.tenant_id)
    .slice(0, 12);
}

function sanitizeAvatarDataUrl(value) {
  const dataUrl = String(value || '').trim();
  if (!dataUrl) return '';
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(dataUrl)) return '';
  if (dataUrl.length > 900000) return '';
  return dataUrl;
}

function sanitizeSignatureHtml(value) {
  return String(value || '').trim().slice(0, 12000);
}

function normalizeProfile(profile) {
  const input = asObject(profile);
  return {
    phone: sanitizeText(input.phone, 40),
    bio: sanitizeText(input.bio, 1200),
    qualifications: sanitizeText(input.qualifications, 1600),
    competencies: sanitizeTagList(input.competencies),
    social_links: sanitizeSocialLinks(input.social_links || input.socialLinks),
    signature_html: sanitizeSignatureHtml(input.signature_html || input.signatureHtml),
    avatar_data_url: sanitizeAvatarDataUrl(input.avatar_data_url || input.avatarDataUrl),
    tenant_links: sanitizeTenantLinks(input.tenant_links || input.tenantLinks),
  };
}

function normalizePreferences(preferences) {
  const input = asObject(preferences);
  return {
    notifMessages: input.notifMessages !== false,
    notifNewClients: input.notifNewClients !== false,
    notifSteps: input.notifSteps !== false,
    prefCompactTable: !!input.prefCompactTable,
    prefShowProgress: input.prefShowProgress !== false,
    prefOpenKanbanByDefault: input.prefOpenKanbanByDefault !== false,
    prefCollapseFiltersOnMobile: input.prefCollapseFiltersOnMobile !== false,
  };
}

async function loadPortalUserState(userId) {
  const { data } = await sb.from('re_onboarding').select('*').eq('user_id', userId).maybeSingle();
  const payload = asObject(data?.data);
  return {
    onboarding: data || null,
    profile: { ...clone(DEFAULT_PROFILE), ...normalizeProfile(payload.portal_profile) },
    preferences: { ...clone(DEFAULT_PREFERENCES), ...normalizePreferences(payload.portal_preferences) },
  };
}

async function savePortalUserState(userId, patch = {}) {
  const current = await loadPortalUserState(userId);
  const nextProfile = patch.profile
    ? { ...current.profile, ...normalizeProfile({ ...current.profile, ...patch.profile }) }
    : current.profile;
  const nextPreferences = patch.preferences
    ? { ...current.preferences, ...normalizePreferences({ ...current.preferences, ...patch.preferences }) }
    : current.preferences;

  const currentData = asObject(current.onboarding?.data);
  const nextData = {
    ...currentData,
    portal_profile: nextProfile,
    portal_preferences: nextPreferences,
  };

  await sb.from('re_onboarding').upsert({
    user_id: userId,
    step: current.onboarding?.step ?? 1,
    status: current.onboarding?.status ?? 'nao_iniciado',
    completed: current.onboarding?.completed ?? false,
    data: nextData,
    last_activity: new Date().toISOString(),
    completed_at: current.onboarding?.completed_at ?? null,
  }, { onConflict: 'user_id' });

  return {
    profile: nextProfile,
    preferences: nextPreferences,
  };
}

module.exports = {
  DEFAULT_PROFILE,
  DEFAULT_PREFERENCES,
  loadPortalUserState,
  normalizeProfile,
  normalizePreferences,
  savePortalUserState,
};