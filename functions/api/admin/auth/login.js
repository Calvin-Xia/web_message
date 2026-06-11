import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { getAdminUserByUsername, mapAdminUser } from '../../../../src/shared/adminUsers.js';
import { generateToken } from '../../../../src/shared/jwt.js';
import { verifyPassword } from '../../../../src/shared/password.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../../src/shared/response.js';
import { checkRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { formatZodError, loginSchema } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'POST, OPTIONS';

async function recordLoginAction(env, {
  actionType,
  user = null,
  username,
  request,
  now,
}) {
  try {
    await createAdminActionStatement(env.DB, {
      actionType,
      targetType: 'admin_user',
      targetId: user?.id ?? null,
      details: { username },
      performedBy: user?.username ?? username,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();
  } catch (error) {
    console.error('Failed to record admin login audit:', error);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin');
  const corsPolicy = getAdminCorsPolicy(origin, env, ALLOWED_METHODS);

  if (corsPolicy.hasOrigin && !corsPolicy.isOriginAllowed) {
    return errorResponse('来源不受信任', { status: 403, headers: corsPolicy.headers });
  }

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsPolicy.headers);
  }

  if (request.method !== 'POST') {
    return methodNotAllowedResponse(corsPolicy.headers, ALLOWED_METHODS);
  }

  const rateLimitResponse = await checkRateLimit(env, request, 'adminLogin', corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const parsedBody = await parseJsonBody(request, corsPolicy.headers);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = loginSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: corsPolicy.headers });
    }

    const payload = validationResult.data;
    const user = await getAdminUserByUsername(env.DB, payload.username);
    const passwordMatches = user ? await verifyPassword(payload.password, user.password_hash) : false;
    const now = new Date().toISOString();

    if (!user || !passwordMatches) {
      await recordLoginAction(env, {
        actionType: 'login_failed',
        username: payload.username,
        request,
        now,
      });
      return errorResponse('用户名或密码错误', { status: 401, headers: corsPolicy.headers });
    }

    if (Number(user.is_enabled) !== 1) {
      await recordLoginAction(env, {
        actionType: 'login_blocked',
        user,
        username: payload.username,
        request,
        now,
      });
      return errorResponse('账号已禁用', { status: 403, headers: corsPolicy.headers });
    }

    await env.DB.batch([
      env.DB.prepare('UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .bind(now, now, user.id),
      createAdminActionStatement(env.DB, {
        actionType: 'login_success',
        targetType: 'admin_user',
        targetId: user.id,
        details: { username: user.username },
        performedBy: user.username,
        performedAt: now,
        ipAddress: getClientIP(request),
      }),
    ]);

    const { token, expiresAt } = await generateToken(env, user, {
      rememberMe: payload.rememberMe,
    });

    return successResponse({
      token,
      expiresAt,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    }, { headers: corsPolicy.headers });
  } catch (error) {
    console.error('Admin auth login route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsPolicy.headers });
  }
}
