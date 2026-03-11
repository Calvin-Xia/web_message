import { parseJsonValue } from './utils.js';

const RATE_LIMIT_CONFIG = {
  postIssue: {
    maxRequests: 10,
    periodSeconds: 60,
    blockDuration: 300,
  },
  getIssues: {
    maxRequests: 60,
    periodSeconds: 60,
    blockDuration: 60,
  },
  adminRead: {
    maxRequests: 180,
    periodSeconds: 60,
    blockDuration: 60,
  },
  adminWrite: {
    maxRequests: 60,
    periodSeconds: 60,
    blockDuration: 120,
  },
};

function createRateLimitResponse(corsHeaders, retryAfterSeconds) {
  return new Response(
    JSON.stringify({
      error: '请求过于频繁，请稍后再试',
      retryAfter: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        ...corsHeaders,
      },
    }
  );
}

function getRetryAfterSeconds(blockedUntil, now = Date.now()) {
  return Math.max(1, Math.ceil((blockedUntil - now) / 1000));
}

function parseBlockedUntil(blockValue) {
  if (!blockValue) {
    return null;
  }

  const parsedValue = parseJsonValue(blockValue, null);
  const blockedUntil = Number(parsedValue?.blockedUntil);
  if (Number.isFinite(blockedUntil)) {
    return blockedUntil;
  }

  const numericValue = Number.parseInt(blockValue, 10);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  return null;
}

function getRateLimitStore(env) {
  return env.RATE_LIMIT_STORE ?? env.DB ?? null;
}

async function checkRateLimitWithD1(store, clientIp, endpoint, config, corsHeaders = {}) {
  const now = Date.now();
  const periodMs = config.periodSeconds * 1000;
  const windowStartedAt = Math.floor(now / periodMs) * periodMs;
  const blockedUntil = now + (config.blockDuration * 1000);

  const row = await store.prepare(`
    INSERT INTO rate_limit_state (
      endpoint, client_ip, window_started_at, request_count, blocked_until, updated_at
    ) VALUES (?, ?, ?, 1, NULL, ?)
    ON CONFLICT(endpoint, client_ip) DO UPDATE SET
      request_count = CASE
        WHEN rate_limit_state.blocked_until IS NOT NULL AND rate_limit_state.blocked_until > ? THEN rate_limit_state.request_count
        WHEN rate_limit_state.window_started_at = excluded.window_started_at THEN rate_limit_state.request_count + 1
        ELSE 1
      END,
      window_started_at = CASE
        WHEN rate_limit_state.blocked_until IS NOT NULL AND rate_limit_state.blocked_until > ? THEN rate_limit_state.window_started_at
        ELSE excluded.window_started_at
      END,
      blocked_until = CASE
        WHEN rate_limit_state.blocked_until IS NOT NULL AND rate_limit_state.blocked_until > ? THEN rate_limit_state.blocked_until
        WHEN rate_limit_state.window_started_at = excluded.window_started_at AND rate_limit_state.request_count + 1 > ? THEN ?
        ELSE NULL
      END,
      updated_at = excluded.updated_at
    RETURNING request_count, blocked_until, window_started_at
  `)
    .bind(
      endpoint,
      clientIp,
      windowStartedAt,
      now,
      now,
      now,
      now,
      config.maxRequests,
      blockedUntil,
    )
    .first();

  const activeBlockedUntil = Number(row?.blocked_until);
  if (Number.isFinite(activeBlockedUntil) && activeBlockedUntil > now) {
    return createRateLimitResponse(corsHeaders, getRetryAfterSeconds(activeBlockedUntil, now));
  }

  return null;
}

async function checkRateLimitWithKv(kv, request, endpoint, config, corsHeaders = {}) {
  const now = Date.now();
  const ip = getClientIP(request);
  const baseKey = `ratelimit:${endpoint}:${ip}`;
  const countKey = `${baseKey}:count`;
  const blockKey = `${baseKey}:block`;

  const blockValue = await kv.get(blockKey);
  const blockedUntil = parseBlockedUntil(blockValue);

  if (blockValue) {
    if (blockedUntil && blockedUntil > now) {
      return createRateLimitResponse(corsHeaders, getRetryAfterSeconds(blockedUntil, now));
    }

    await kv.delete(blockKey);
  }

  const countValue = await kv.get(countKey);
  const parsedCount = Number.parseInt(countValue || '0', 10);
  const currentCount = Number.isFinite(parsedCount) ? parsedCount : 0;

  if (currentCount >= config.maxRequests) {
    const nextBlockedUntil = now + (config.blockDuration * 1000);

    await kv.put(
      blockKey,
      JSON.stringify({ blockedUntil: nextBlockedUntil }),
      {
        expirationTtl: config.blockDuration,
      }
    );
    await kv.delete(countKey);

    return createRateLimitResponse(corsHeaders, getRetryAfterSeconds(nextBlockedUntil, now));
  }

  await kv.put(countKey, String(currentCount + 1), {
    expirationTtl: config.periodSeconds,
  });

  return null;
}

export async function checkRateLimit(env, request, endpoint, corsHeaders = {}) {
  const config = RATE_LIMIT_CONFIG[endpoint];
  if (!config) {
    console.warn(`Unknown endpoint: ${endpoint}, skipping rate limit`);
    return null;
  }

  const store = getRateLimitStore(env);
  if (store?.prepare) {
    try {
      return await checkRateLimitWithD1(store, getClientIP(request), endpoint, config, corsHeaders);
    } catch (error) {
      console.error('D1 rate limit check failed:', error);
    }
  }

  if (env.RATE_LIMIT_KV) {
    try {
      return await checkRateLimitWithKv(env.RATE_LIMIT_KV, request, endpoint, config, corsHeaders);
    } catch (error) {
      console.error('Legacy KV rate limit check failed:', error);
      return null;
    }
  }

  console.warn('No rate limit store configured, skipping rate limit');
  return null;
}

export function getAdminRateLimitEndpoint(method) {
  return method === 'GET' ? 'adminRead' : 'adminWrite';
}

export async function checkAdminRateLimit(env, request, corsHeaders = {}) {
  return checkRateLimit(env, request, getAdminRateLimitEndpoint(request.method), corsHeaders);
}

export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

export { RATE_LIMIT_CONFIG };
