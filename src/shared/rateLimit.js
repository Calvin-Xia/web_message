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
  
  const key = `ratelimit:${endpoint}:${ip}`;

  try {
    const currentCount = parseInt(await env.RATE_LIMIT_KV.get(key) || '0');

    if (currentCount >= config.maxRequests) {
      return new Response(
        JSON.stringify({ 
          error: '请求过于频繁，请稍后再试',
          retryAfter: config.blockDuration 
        }),
        { 
          status: 429, 
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': String(config.blockDuration),
            ...corsHeaders,
          } 
        }
      );
    }

    await env.RATE_LIMIT_KV.put(key, String(currentCount + 1), {
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
