import { authorizeAdminRequest, createForbiddenOriginResponse } from '../../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { blacklistToken } from '../../../../src/shared/jwt.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../../src/shared/response.js';

const ALLOWED_METHODS = 'POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin');
  const corsPolicy = getAdminCorsPolicy(origin, env, ALLOWED_METHODS);

  if (corsPolicy.hasOrigin && !corsPolicy.isOriginAllowed) {
    return createForbiddenOriginResponse(corsPolicy.headers);
  }

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsPolicy.headers);
  }

  if (request.method !== 'POST') {
    return methodNotAllowedResponse(corsPolicy.headers, ALLOWED_METHODS);
  }

  const rateLimitResponse = await checkAdminRateLimit(env, request, corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const authResult = await authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    if (authResult.authType === 'jwt') {
      await blacklistToken(authResult.token, env);
    }

    await createAdminActionStatement(env.DB, {
      actionType: 'logout',
      targetType: 'admin_user',
      targetId: authResult.user?.id ?? null,
      details: { username: authResult.user?.username ?? authResult.actor },
      performedBy: authResult.actor,
      performedAt: new Date().toISOString(),
      ipAddress: getClientIP(request),
    }).run();

    return successResponse({ message: '已成功登出' }, { headers: authResult.corsHeaders });
  } catch (error) {
    console.error('Admin auth logout route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
