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

  try {
    const parsedValue = JSON.parse(blockValue);
    const blockedUntil = Number(parsedValue?.blockedUntil);
    if (Number.isFinite(blockedUntil)) {
      return blockedUntil;
    }
  } catch {
    const numericValue = Number.parseInt(blockValue, 10);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

export async function checkRateLimit(env, request, endpoint, corsHeaders = {}) {
  if (!env.RATE_LIMIT_KV) {
    console.warn('RATE_LIMIT_KV not configured, skipping rate limit');
    return null;
  }

  const config = RATE_LIMIT_CONFIG[endpoint];
  if (!config) {
    console.warn(`Unknown endpoint: ${endpoint}, skipping rate limit`);
    return null;
  }

  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
             'unknown';

  const baseKey = `ratelimit:${endpoint}:${ip}`;
  const countKey = `${baseKey}:count`;
  const blockKey = `${baseKey}:block`;

  try {
    const now = Date.now();
    const blockValue = await env.RATE_LIMIT_KV.get(blockKey);
    const blockedUntil = parseBlockedUntil(blockValue);

    if (blockValue) {
      if (blockedUntil && blockedUntil > now) {
        return createRateLimitResponse(corsHeaders, getRetryAfterSeconds(blockedUntil, now));
      }

      await env.RATE_LIMIT_KV.delete(blockKey);
    }

    const countValue = await env.RATE_LIMIT_KV.get(countKey);
    const parsedCount = Number.parseInt(countValue || '0', 10);
    const currentCount = Number.isFinite(parsedCount) ? parsedCount : 0;

    if (currentCount >= config.maxRequests) {
      const nextBlockedUntil = now + (config.blockDuration * 1000);

      await env.RATE_LIMIT_KV.put(
        blockKey,
        JSON.stringify({ blockedUntil: nextBlockedUntil }),
        {
          expirationTtl: config.blockDuration,
        }
      );
      await env.RATE_LIMIT_KV.delete(countKey);

      return createRateLimitResponse(corsHeaders, getRetryAfterSeconds(nextBlockedUntil, now));
    }

    await env.RATE_LIMIT_KV.put(countKey, String(currentCount + 1), {
      expirationTtl: config.periodSeconds,
    });

    return null;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return null;
  }
}

export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

export { RATE_LIMIT_CONFIG };