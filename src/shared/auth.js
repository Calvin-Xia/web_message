const PRODUCTION_ADMIN_EXACT_ORIGINS = new Set([
  'https://issue.calvin-xia.cn',
  'https://issue-origin.calvin-xia.cn',
  'https://web-message-board.pages.dev',
]);

const PRODUCTION_PAGES_HOST = 'web-message-board.pages.dev';
const LOOPBACK_ADMIN_HOSTS = new Set(['localhost', '127.0.0.1']);
const DEFAULT_ADMIN_METHODS = 'GET, POST, PATCH, OPTIONS';

export function getAdminKeyFromEnv(env) {
  return env.ADMIN_SECRET_KEY || null;
}

export function verifyAdminKey(authHeader, env) {
  const adminKey = getAdminKeyFromEnv(env);

  if (!adminKey) {
    console.error('ADMIN_SECRET_KEY not configured in environment');
    return { valid: false, error: '服务器配置错误' };
  }

  if (!authHeader) {
    return { valid: false, error: '缺少授权信息' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: '授权格式错误' };
  }

  if (parts[1] === adminKey) {
    return { valid: true };
  }

  return { valid: false, error: '密钥无效' };
}

function buildAdminCorsHeaders(allowedOrigin = null, methods = DEFAULT_ADMIN_METHODS) {
  const headers = {
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  return headers;
}

function normalizeOrigin(origin) {
  if (!origin) {
    return null;
  }

  try {
    const url = new URL(origin);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function hasSingleLevelSubdomain(hostname, baseHostname) {
  const hostnameParts = hostname.split('.');
  const baseParts = baseHostname.split('.');

  if (hostnameParts.length !== baseParts.length + 1) {
    return false;
  }

  return hostnameParts.slice(1).join('.') === baseHostname;
}

function isTrustedProductionOrigin(url) {
  if (url.protocol !== 'https:' || url.port !== '') {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return PRODUCTION_ADMIN_EXACT_ORIGINS.has(url.origin) || hasSingleLevelSubdomain(hostname, PRODUCTION_PAGES_HOST);
}

function isTrustedNonProductionOrigin(url) {
  const hostname = url.hostname.toLowerCase();
  return LOOPBACK_ADMIN_HOSTS.has(hostname);
}

export function getAdminCorsPolicy(origin, env, methods = DEFAULT_ADMIN_METHODS) {
  const hasOrigin = typeof origin === 'string' && origin.trim() !== '';

  if (!hasOrigin) {
    return {
      hasOrigin: false,
      isOriginAllowed: false,
      normalizedOrigin: null,
      headers: buildAdminCorsHeaders(null, methods),
    };
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return {
      hasOrigin: true,
      isOriginAllowed: false,
      normalizedOrigin: null,
      headers: buildAdminCorsHeaders(null, methods),
    };
  }

  const url = new URL(normalizedOrigin);
  const isProduction = env.ENVIRONMENT === 'production';
  const isOriginAllowed = isProduction ? isTrustedProductionOrigin(url) : isTrustedNonProductionOrigin(url);

  return {
    hasOrigin: true,
    isOriginAllowed,
    normalizedOrigin,
    headers: buildAdminCorsHeaders(isOriginAllowed ? normalizedOrigin : null, methods),
  };
}

function createJsonErrorResponse(error, status, corsHeaders) {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...corsHeaders,
    },
  });
}

export function createUnauthorizedResponse(error, corsHeaders) {
  return createJsonErrorResponse(error, 401, corsHeaders);
}

export function createForbiddenOriginResponse(corsHeaders) {
  return createJsonErrorResponse('来源不受信任', 403, corsHeaders);
}

export function authorizeAdminRequest(request, env, methods = DEFAULT_ADMIN_METHODS) {
  const origin = request.headers.get('Origin');
  const corsPolicy = getAdminCorsPolicy(origin, env, methods);

  if (corsPolicy.hasOrigin && !corsPolicy.isOriginAllowed) {
    return {
      ok: false,
      corsHeaders: corsPolicy.headers,
      response: createForbiddenOriginResponse(corsPolicy.headers),
    };
  }

  const authResult = verifyAdminKey(request.headers.get('Authorization'), env);
  if (!authResult.valid) {
    return {
      ok: false,
      corsHeaders: corsPolicy.headers,
      response: createUnauthorizedResponse(authResult.error, corsPolicy.headers),
    };
  }

  return {
    ok: true,
    corsHeaders: corsPolicy.headers,
    actor: 'admin',
  };
}

export {
  LOOPBACK_ADMIN_HOSTS,
  PRODUCTION_ADMIN_EXACT_ORIGINS,
  PRODUCTION_PAGES_HOST,
};
