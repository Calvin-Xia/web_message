import { SignJWT, decodeJwt, jwtVerify } from 'jose';

const DEFAULT_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const REMEMBER_ME_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_BLACKLIST_PREFIX = 'blacklist:';

function getJwtSecret(env) {
  const secret = env.ADMIN_JWT_SECRET || env.JWT_SECRET;
  if (!secret) {
    throw new Error('ADMIN_JWT_SECRET not configured');
  }

  return new TextEncoder().encode(secret);
}

function getTokenBlacklistStore(env) {
  return env.TOKEN_BLACKLIST_KV || env.AUTH_KV || env.RATE_LIMIT_KV || null;
}

function getTokenTtlSeconds(rememberMe) {
  return rememberMe ? REMEMBER_ME_TOKEN_TTL_SECONDS : DEFAULT_TOKEN_TTL_SECONDS;
}

function toEpochSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createTokenHash(token) {
  return sha256Hex(token);
}

export async function generateToken(env, user, { rememberMe = false, now = new Date() } = {}) {
  const issuedAt = toEpochSeconds(now);
  const expiresAtSeconds = issuedAt + getTokenTtlSeconds(rememberMe);
  const expiresAt = new Date(expiresAtSeconds * 1000).toISOString();
  const token = await new SignJWT({
    userId: user.id,
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(getJwtSecret(env));

  return { token, expiresAt };
}

export async function isTokenBlacklisted(token, env) {
  const store = getTokenBlacklistStore(env);
  if (!store) {
    return false;
  }

  const tokenHash = await createTokenHash(token);
  return Boolean(await store.get(`${TOKEN_BLACKLIST_PREFIX}${tokenHash}`));
}

export async function blacklistToken(token, env, { now = new Date() } = {}) {
  const store = getTokenBlacklistStore(env);
  if (!store) {
    return false;
  }

  let expirationTtl = DEFAULT_TOKEN_TTL_SECONDS;
  try {
    const payload = decodeJwt(token);
    if (payload.exp) {
      expirationTtl = Math.max(1, payload.exp - toEpochSeconds(now));
    }
  } catch {
    expirationTtl = DEFAULT_TOKEN_TTL_SECONDS;
  }

  const tokenHash = await createTokenHash(token);
  await store.put(`${TOKEN_BLACKLIST_PREFIX}${tokenHash}`, '1', { expirationTtl });
  return true;
}

export async function verifyToken(token, env) {
  if (!token) {
    return { valid: false, error: '缺少授权信息' };
  }

  if (await isTokenBlacklisted(token, env)) {
    return { valid: false, error: '令牌已失效' };
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env), {
      algorithms: ['HS256'],
    });

    if (!payload.userId || !payload.username || !['handler', 'admin'].includes(payload.role)) {
      return { valid: false, error: '令牌无效或已过期' };
    }

    return {
      valid: true,
      user: {
        id: Number(payload.userId),
        username: String(payload.username),
        role: String(payload.role),
      },
      payload,
    };
  } catch {
    return { valid: false, error: '令牌无效或已过期' };
  }
}

export {
  DEFAULT_TOKEN_TTL_SECONDS,
  REMEMBER_ME_TOKEN_TTL_SECONDS,
};
