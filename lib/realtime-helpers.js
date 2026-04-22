'use strict';

/**
 * BP-FE-03: Realtime Helpers para Typing Indicators e Presença
 * Gerencia indicadores de digitação e presença de usuários em tempo real
 */

const { sb } = require('./config');

/**
 * Registra que um usuário está digitando em um capítulo
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} typingUserId - ID do usuário que está digitando
 * @param {string} typingUserName - Nome do usuário que está digitando
 * @param {string} typingUserRole - Role do usuário (consultor, cliente)
 */
async function recordTypingIndicator(userId, chapterId, typingUserId, typingUserName, typingUserRole) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5000).toISOString(); // 5 segundos
  
  try {
    const { error } = await sb.from('re_plan_typing_indicators').upsert({
      user_id: userId,
      chapter_id: chapterId,
      typing_user_id: typingUserId,
      typing_user_name: typingUserName,
      typing_user_role: typingUserRole,
      created_at: now,
      expires_at: expiresAt,
    }, {
      onConflict: 'user_id,chapter_id,typing_user_id',
    });
    
    if (error) {
      console.warn('[realtime-helpers] Erro ao registrar typing indicator:', error);
    }
  } catch (err) {
    console.warn('[realtime-helpers] Erro ao registrar typing indicator:', err.message);
  }
}

/**
 * Remove o indicador de digitação de um usuário
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} typingUserId - ID do usuário
 */
async function clearTypingIndicator(userId, chapterId, typingUserId) {
  try {
    const { error } = await sb.from('re_plan_typing_indicators').delete()
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('typing_user_id', typingUserId);
    
    if (error) {
      console.warn('[realtime-helpers] Erro ao limpar typing indicator:', error);
    }
  } catch (err) {
    console.warn('[realtime-helpers] Erro ao limpar typing indicator:', err.message);
  }
}

/**
 * Obtém todos os indicadores de digitação ativos para um capítulo
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @returns {Promise<object[]>} Lista de usuários digitando
 */
async function getActiveTypingIndicators(userId, chapterId) {
  const now = new Date().toISOString();
  
  try {
    const { data, error } = await sb.from('re_plan_typing_indicators')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .gt('expires_at', now);
    
    if (error) {
      console.warn('[realtime-helpers] Erro ao obter typing indicators:', error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.warn('[realtime-helpers] Erro ao obter typing indicators:', err.message);
    return [];
  }
}

/**
 * Registra a presença de um usuário em um capítulo
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} presenceUserId - ID do usuário
 * @param {string} presenceUserName - Nome do usuário
 * @param {string} presenceUserRole - Role do usuário (consultor, cliente)
 */
async function recordPresence(userId, chapterId, presenceUserId, presenceUserName, presenceUserRole) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30000).toISOString(); // 30 segundos
  
  try {
    const { error } = await sb.from('re_plan_presence').upsert({
      user_id: userId,
      chapter_id: chapterId,
      presence_user_id: presenceUserId,
      presence_user_name: presenceUserName,
      presence_user_role: presenceUserRole,
      last_seen_at: now,
      expires_at: expiresAt,
    }, {
      onConflict: 'user_id,chapter_id,presence_user_id',
    });
    
    if (error) {
      console.warn('[realtime-helpers] Erro ao registrar presença:', error);
    }
  } catch (err) {
    console.warn('[realtime-helpers] Erro ao registrar presença:', err.message);
  }
}

/**
 * Remove a presença de um usuário
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @param {string} presenceUserId - ID do usuário
 */
async function clearPresence(userId, chapterId, presenceUserId) {
  try {
    const { error } = await sb.from('re_plan_presence').delete()
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('presence_user_id', presenceUserId);
    
    if (error) {
      console.warn('[realtime-helpers] Erro ao limpar presença:', error);
    }
  } catch (err) {
    console.warn('[realtime-helpers] Erro ao limpar presença:', err.message);
  }
}

/**
 * Obtém todos os usuários presentes em um capítulo
 * @param {string} userId - ID do cliente
 * @param {number} chapterId - ID do capítulo
 * @returns {Promise<object[]>} Lista de usuários presentes
 */
async function getActivePresence(userId, chapterId) {
  const now = new Date().toISOString();
  
  try {
    const { data, error } = await sb.from('re_plan_presence')
      .select('*')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .gt('expires_at', now);
    
    if (error) {
      console.warn('[realtime-helpers] Erro ao obter presença:', error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.warn('[realtime-helpers] Erro ao obter presença:', err.message);
    return [];
  }
}

module.exports = {
  recordTypingIndicator,
  clearTypingIndicator,
  getActiveTypingIndicators,
  recordPresence,
  clearPresence,
  getActivePresence,
};
