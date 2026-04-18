function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJsonPart(input) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(input)));
}

async function signHmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

export async function signJwt(payload, secret, options = {}) {
  if (!secret) throw new Error('JWT secret ausente.');

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Number(options.expiresIn || 7 * 24 * 60 * 60);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    iat: now,
    exp: now + expiresIn,
    ...payload,
  };

  const encodedHeader = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const encodedSignature = await signHmac(secret, `${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

export async function verifyJwt(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let payload;

  try {
    header = decodeJsonPart(encodedHeader);
    payload = decodeJsonPart(encodedPayload);
  } catch {
    return null;
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

  const expected = await signHmac(secret, `${encodedHeader}.${encodedPayload}`);
  if (expected !== encodedSignature) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) return null;
  if (payload.nbf && now < payload.nbf) return null;
  return payload;
}