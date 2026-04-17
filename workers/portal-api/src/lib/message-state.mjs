const adminMsgSeen = new Map();

function getMemoryState(adminId) {
  if (!adminMsgSeen.has(adminId)) adminMsgSeen.set(adminId, {});
  return adminMsgSeen.get(adminId);
}

function getBinding(env) {
  const binding = env.ADMIN_MESSAGE_STATE;
  if (binding && typeof binding.get === 'function' && typeof binding.put === 'function') {
    return binding;
  }
  return null;
}

function storageKey(adminId) {
  return `admin-message-seen:${adminId}`;
}

export async function readSeenState(env, adminId) {
  const binding = getBinding(env);
  if (!binding) {
    return { state: getMemoryState(adminId), persistent: false };
  }

  const raw = await binding.get(storageKey(adminId));
  if (!raw) return { state: {}, persistent: true };

  try {
    const parsed = JSON.parse(raw);
    return { state: parsed && typeof parsed === 'object' ? parsed : {}, persistent: true };
  } catch {
    return { state: {}, persistent: true };
  }
}

export async function markSeenState(env, adminId, clientId, timestamp = new Date().toISOString()) {
  const binding = getBinding(env);
  if (!binding) {
    const state = getMemoryState(adminId);
    state[clientId] = timestamp;
    return { state, persistent: false, timestamp };
  }

  const { state } = await readSeenState(env, adminId);
  state[clientId] = timestamp;
  await binding.put(storageKey(adminId), JSON.stringify(state));
  return { state, persistent: true, timestamp };
}