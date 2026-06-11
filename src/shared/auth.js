import {
  DEFAULT_ADMIN_METHODS,
  getAdminCorsPolicy,
} from './corsConfig.js';
import { verifyToken } from './jwt.js';

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

function createJsonErrorResponse(error, status, corsHeaders) {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...corsHeaders,
    },
  });
}

function createAdminNoStoreHeaders(corsHeaders) {
  return {
    ...corsHeaders,
    'Cache-Control': 'no-store',
  };
}

export function createUnauthorizedResponse(error, corsHeaders) {
  return createJsonErrorResponse(error, 401, corsHeaders);
}

export function createForbiddenOriginResponse(corsHeaders) {
  return createJsonErrorResponse('来源不受信任', 403, corsHeaders);
}

export function createForbiddenRoleResponse(corsHeaders) {
  return createJsonErrorResponse('权限不足', 403, corsHeaders);
}

function getBearerToken(authHeader) {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

export async function authorizeAdminRequest(request, env, methods = DEFAULT_ADMIN_METHODS) {
  const origin = request.headers.get('Origin');
  const corsPolicy = getAdminCorsPolicy(origin, env, methods);

  if (corsPolicy.hasOrigin && !corsPolicy.isOriginAllowed) {
    return {
      ok: false,
      corsHeaders: corsPolicy.headers,
      response: createForbiddenOriginResponse(corsPolicy.headers),
    };
  }

  const authHeader = request.headers.get('Authorization');
  const bearerToken = getBearerToken(authHeader);
  if (bearerToken) {
    const tokenResult = await verifyToken(bearerToken, env);
    if (tokenResult.valid) {
      return {
        ok: true,
        corsHeaders: createAdminNoStoreHeaders(corsPolicy.headers),
        actor: tokenResult.user.username,
        authType: 'jwt',
        user: tokenResult.user,
        token: bearerToken,
      };
    }
  }

  const sharedKeyResult = verifyAdminKey(authHeader, env);
  if (!sharedKeyResult.valid) {
    return {
      ok: false,
      corsHeaders: corsPolicy.headers,
      response: createUnauthorizedResponse(sharedKeyResult.error, corsPolicy.headers),
    };
  }

  return {
    ok: true,
    corsHeaders: createAdminNoStoreHeaders(corsPolicy.headers),
    actor: 'admin',
    authType: 'shared_key',
    user: {
      id: null,
      username: 'admin',
      role: 'admin',
    },
  };
}

export function requireAdminRole(authResult) {
  if (!authResult.ok) {
    return authResult;
  }

  if (authResult.user?.role === 'admin') {
    return authResult;
  }

  return {
    ok: false,
    corsHeaders: authResult.corsHeaders,
    response: createForbiddenRoleResponse(authResult.corsHeaders),
  };
}

// Compatibility export only; new CORS callers should import from corsConfig.js directly.
export {
  getAdminCorsPolicy,
  LOOPBACK_ADMIN_HOSTS,
  PRODUCTION_ADMIN_EXACT_ORIGINS,
  PRODUCTION_PAGES_HOST,
} from './corsConfig.js';
