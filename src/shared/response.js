const DEFAULT_PUBLIC_METHODS = 'GET, POST, OPTIONS';
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
};

export function createPublicCorsHeaders(methods = DEFAULT_PUBLIC_METHODS) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function createOptionsResponse(headers) {
  return new Response(null, { headers });
}

export function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  });
}

export function successResponse(data, options = {}) {
  return jsonResponse({ success: true, data }, options);
}

export function errorResponse(error, { status = 400, headers = {} } = {}) {
  return jsonResponse({ success: false, error }, { status, headers });
}

export function methodNotAllowedResponse(headers, allowedMethods) {
  return errorResponse('Method not allowed', {
    status: 405,
    headers: {
      Allow: allowedMethods,
      ...headers,
    },
  });
}

export function notFoundResponse(message = '资源不存在', headers = {}) {
  return errorResponse(message, { status: 404, headers });
}
