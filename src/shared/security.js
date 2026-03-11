const BASE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
};

const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function isSecureProxyRequest(request) {
  const forwardedProto = request.headers.get('X-Forwarded-Proto');
  if (forwardedProto) {
    return forwardedProto.toLowerCase() === 'https';
  }

  const visitor = request.headers.get('CF-Visitor');
  if (!visitor) {
    return false;
  }

  return visitor.includes('https');
}

export function shouldForceHttps(request, env) {
  if (env.ENVIRONMENT !== 'production') {
    return false;
  }

  const url = new URL(request.url);
  return url.protocol !== 'https:' && !isSecureProxyRequest(request);
}

export function createHttpsRedirectResponse(request) {
  const url = new URL(request.url);
  url.protocol = 'https:';

  return new Response(null, {
    status: 308,
    headers: {
      Location: url.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

export function appendSecurityHeaders(response, request, env, { api = false } = {}) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(key, value);
  }

  if (api) {
    headers.set('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
  }

  if (env.ENVIRONMENT === 'production') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
