'use strict';
const { sb } = require('./config');

function extractMissingColumnName(message) {
  const text = String(message || '');
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i,
    /Could not find the ['"]?([a-zA-Z0-9_]+)['"]? column/i,
    /record\s+['"]?(?:new|old)['"]?\s+has no field\s+['"]?([a-zA-Z0-9_]+)['"]?/i,
    /schema cache.*column\s+['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function isSchemaCompatibilityError(message, hints = []) {
  const text = String(message || '').toLowerCase();
  // Permission/auth errors are not schema compatibility errors
  if (text.includes('permission denied') || text.includes('insufficient privileges') ||
      text.includes('violates row-level security') || text.includes('jwt')) return false;
  const hasSchemaSignal = [
    'does not exist',
    'could not find',
    'schema cache',
    'has no field',
  ].some((signal) => text.includes(signal));

  if (!hasSchemaSignal) return false;
  if (!hints.length) return true;
  return hints.some((hint) => text.includes(String(hint).toLowerCase()));
}

function isCompanyMembersSchemaError(message) {
  return isSchemaCompatibilityError(message, ['re_company_users', 'company_id', 'password_hash', 'invited_at', 'last_login', 'role', 'active']);
}

function buildRouteDiagnostic(route, error, attempts = []) {
  return {
    route,
    lastError: String(error?.message || error || ''),
    attempts: attempts.map((attempt, index) => ({
      index: index + 1,
      requiredColumns: attempt.requiredColumns || [],
      returningColumns: attempt.returningColumns || [],
      payloadKeys: Object.keys(attempt.payload || {}),
    })),
  };
}

async function selectWithColumnFallback(table, options) {
  let columns = [...(options.columns || [])];
  let orderBy = [...(options.orderBy || [])];
  const requiredColumns = new Set(options.requiredColumns || []);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = sb.from(table).select(columns.join(','));
    if (typeof options.apply === 'function') query = options.apply(query);
    if (orderBy[0]) query = query.order(orderBy[0], { ascending: options.ascending ?? true });

    const { data, error } = await query;
    if (!error) return { data, error: null, columns, order: orderBy[0] || null };

    const missingColumn = extractMissingColumnName(error.message);
    if (!missingColumn) return { data: null, error, columns, order: orderBy[0] || null };

    if (columns.includes(missingColumn) && !requiredColumns.has(missingColumn)) {
      columns = columns.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do select: ${missingColumn}`);
      continue;
    }

    if (orderBy.includes(missingColumn)) {
      orderBy = orderBy.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do order: ${missingColumn}`);
      continue;
    }

    return { data: null, error, columns, order: orderBy[0] || null };
  }

  return { data: null, error: new Error(`Falha ao consultar ${table} com fallback de schema.`), columns, order: orderBy[0] || null };
}

async function insertWithColumnFallback(table, payload, options = {}) {
  const candidate = { ...payload };
  const requiredColumns = new Set(options.requiredColumns || []);
  let returningColumns = [...(options.returningColumns || [])];
  const requiredReturningColumns = new Set(options.requiredReturningColumns || []);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = sb.from(table).insert(candidate);
    if (returningColumns.length) query = query.select(returningColumns.join(','));
    else query = query.select();
    const { data, error } = await query.single();
    if (!error) return { data, error: null, payload: candidate };

    const missingColumn = extractMissingColumnName(error.message);
    if (missingColumn && returningColumns.includes(missingColumn) && !requiredReturningColumns.has(missingColumn)) {
      returningColumns = returningColumns.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do retorno do insert: ${missingColumn}`);
      continue;
    }

    if (!missingColumn || !(missingColumn in candidate) || requiredColumns.has(missingColumn)) {
      return { data: null, error, payload: candidate };
    }

    delete candidate[missingColumn];
    console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do insert: ${missingColumn}`);
  }

  return { data: null, error: new Error(`Falha ao inserir em ${table} com fallback de schema.`), payload: candidate };
}

async function updateWithColumnFallback(table, match, payload, options = {}) {
  let candidate = { ...payload };
  const requiredColumns = new Set(options.requiredColumns || []);
  let returningColumns = [...(options.returningColumns || [])];
  const requiredReturningColumns = new Set(options.requiredReturningColumns || []);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let query = sb.from(table).update(candidate);
    Object.entries(match || {}).forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    if (returningColumns.length) query = query.select(returningColumns.join(','));
    else query = query.select();
    const { data, error } = await query.single();
    if (!error) return { data, error: null, payload: candidate };

    const missingColumn = extractMissingColumnName(error.message);
    if (missingColumn && returningColumns.includes(missingColumn) && !requiredReturningColumns.has(missingColumn)) {
      returningColumns = returningColumns.filter((column) => column !== missingColumn);
      console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do retorno do update: ${missingColumn}`);
      continue;
    }

    if (!missingColumn || !(missingColumn in candidate) || requiredColumns.has(missingColumn)) {
      return { data: null, error, payload: candidate };
    }

    delete candidate[missingColumn];
    console.warn(`[SCHEMA FALLBACK] ${table}: coluna ausente removida do update: ${missingColumn}`);
  }

  return { data: null, error: new Error(`Falha ao atualizar ${table} com fallback de schema.`), payload: candidate };
}

module.exports = {
  extractMissingColumnName,
  isSchemaCompatibilityError,
  isCompanyMembersSchemaError,
  buildRouteDiagnostic,
  selectWithColumnFallback,
  insertWithColumnFallback,
  updateWithColumnFallback,
};
