const ALLOWED_ORIGINS = [
  'https://web-message-board.pages.dev',
  'https://issue.calvin-xia.cn',
];

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

export function getCorsHeaders(origin, env) {
  const isProduction = env.ENVIRONMENT === 'production';
  
  if (isProduction) {
    if (origin && ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      };
    }
    
    return {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
  }
  
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function createUnauthorizedResponse(error, corsHeaders) {
  return new Response(
    JSON.stringify({ error }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    }
  );
}

export { ALLOWED_ORIGINS };
