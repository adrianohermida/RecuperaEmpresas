'use strict';

const { ADMIN_EMAILS, AUTH_EMAIL_REDIRECTS, SUPABASE_SERVICE_KEY, sb } = require('./config');
const { findUserByEmail } = require('./db');

async function seedAdminAccounts() {
  if (!SUPABASE_SERVICE_KEY) {
    console.warn('[SEED] Pulando seed — VITE_SUPABASE_SERVICE_ROLE não definido.');
    return;
  }

  for (const email of ADMIN_EMAILS) {
    try {
      const { data: listData } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const authUsers = listData?.users || [];
      let authUser = authUsers.find((user) => user.email?.toLowerCase() === email.toLowerCase());

      if (!authUser) {
        const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
          redirectTo: AUTH_EMAIL_REDIRECTS.inviteUser,
          data: { name: email.split('@')[0], company: 'Recupera Empresas' },
        });
        if (inviteErr) {
          console.warn(`[SEED] Erro Supabase Auth ao convidar ${email}:`, inviteErr.message);
          continue;
        }
        authUser = invited.user;
        console.log(`[SEED] Convite Supabase enviado: ${email}`);
      }

      if (!authUser?.id) continue;
      const existing = await findUserByEmail(email);
      if (!existing) {
        await sb.from('re_users').insert({
          id: authUser.id,
          name: authUser.user_metadata?.name || email.split('@')[0],
          email,
          company: 'Recupera Empresas',
          is_admin: true,
        });
        console.log(`[SEED] Perfil admin criado: ${email}`);
      } else {
        const updates = {};
        if (existing.id !== authUser.id) updates.id = authUser.id;
        if (!existing.is_admin) updates.is_admin = true;
        if (Object.keys(updates).length) {
          if (updates.id) {
            try { await sb.from('re_users').insert({ ...existing, ...updates }); } catch {}
            try { await sb.from('re_users').delete().eq('id', existing.id); } catch {}
          } else {
            await sb.from('re_users').update(updates).eq('id', existing.id);
          }
          console.log(`[SEED] Perfil admin sincronizado: ${email}`);
        }
      }
    } catch (err) {
      console.warn(`[SEED] Erro ao processar ${email}:`, err.message);
    }
  }
}

module.exports = {
  seedAdminAccounts,
};