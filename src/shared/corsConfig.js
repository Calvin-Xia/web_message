export const PRODUCTION_ADMIN_EXACT_ORIGINS = new Set([
  'https://issue.calvin-xia.cn',
  'https://demo.calvin-xia.cn',
  'https://web-message-board.pages.dev',
]);

export const PRODUCTION_PAGES_HOST = 'web-message-board.pages.dev';
export const LOOPBACK_ADMIN_HOSTS = new Set(['localhost', '127.0.0.1']);
export const DEFAULT_ADMIN_METHODS = 'GET, POST, PATCH, OPTIONS';

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

export function getAdminCorsPolicy(origin, env = {}, methods = DEFAULT_ADMIN_METHODS) {
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
  const isProduction = (env.ENVIRONMENT || 'development') === 'production';
  const isOriginAllowed = isProduction ? isTrustedProductionOrigin(url) : isTrustedNonProductionOrigin(url);

  return {
    hasOrigin: true,
    isOriginAllowed,
    normalizedOrigin,
    headers: buildAdminCorsHeaders(isOriginAllowed ? normalizedOrigin : null, methods),
  };
}
