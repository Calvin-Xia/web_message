const PRODUCTION_ADMIN_EXACT_ORIGINS = new Set([
  'https://issue.calvin-xia.cn',
  'https://issue-origin.calvin-xia.cn',
  'https://web-message-board.pages.dev',
]);

const PRODUCTION_PAGES_HOST = 'web-message-board.pages.dev';
const LOOPBACK_ADMIN_HOSTS = new Set(['localhost', '127.0.0.1']);

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

  const providedKey = parts[1];

  if (providedKey === adminKey) {
    return { valid: true };
  }

  return { valid: false, error: '密钥无效' };
}

function buildAdminCorsHeaders(allowedOrigin = null) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
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

  const normalizedOrigin = url.origin;
  const hostname = url.hostname.toLowerCase();

  return (
    PRODUCTION_ADMIN_EXACT_ORIGINS.has(normalizedOrigin) ||
    hasSingleLevelSubdomain(hostname, PRODUCTION_PAGES_HOST)
  );
}

function isTrustedNonProductionOrigin(url) {
  const hostname = url.hostname.toLowerCase();
  return LOOPBACK_ADMIN_HOSTS.has(hostname);
}

export function getAdminCorsPolicy(origin, env) {
  const hasOrigin = typeof origin === 'string' && origin.trim() !== '';

  if (!hasOrigin) {
    return {
      hasOrigin: false,
      isOriginAllowed: false,
      normalizedOrigin: null,
      headers: buildAdminCorsHeaders(),
    };
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedOrigin) {
    return {
      hasOrigin: true,
      isOriginAllowed: false,
      normalizedOrigin: null,
      headers: buildAdminCorsHeaders(),
    };
  }

  const url = new URL(normalizedOrigin);
  const isProduction = env.ENVIRONMENT === 'production';
  const isOriginAllowed = isProduction
    ? isTrustedProductionOrigin(url)
    : isTrustedNonProductionOrigin(url);

  return {
    hasOrigin: true,
    isOriginAllowed,
    normalizedOrigin,
    headers: buildAdminCorsHeaders(isOriginAllowed ? normalizedOrigin : null),
  };
}

export function getCorsHeaders(origin, env) {
  return getAdminCorsPolicy(origin, env).headers;
}

function createJsonErrorResponse(error, status, corsHeaders) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json',
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

export {
  LOOPBACK_ADMIN_HOSTS,
  PRODUCTION_ADMIN_EXACT_ORIGINS,
  PRODUCTION_PAGES_HOST,
};
