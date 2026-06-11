import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import {
  getAdminUserById,
  getValidPasswordResetToken,
  markPasswordResetTokenUsed,
} from '../../../../src/shared/adminUsers.js';
import { hashPassword } from '../../../../src/shared/password.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../../src/shared/response.js';
import { formatZodError, resetPasswordSchema } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'POST, OPTIONS';

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

  const rateLimitResponse = await checkAdminRateLimit(env, request, corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const parsedBody = await parseJsonBody(request, corsPolicy.headers);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = resetPasswordSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: corsPolicy.headers });
    }

    const { token, newPassword } = validationResult.data;
    const resetToken = await getValidPasswordResetToken(env.DB, token);
    if (!resetToken) {
      return errorResponse('重置令牌无效或已过期', { status: 400, headers: corsPolicy.headers });
    }

    const user = await getAdminUserById(env.DB, resetToken.user_id);
    if (!user) {
      return errorResponse('重置令牌无效或已过期', { status: 400, headers: corsPolicy.headers });
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(newPassword);
    await env.DB.batch([
      env.DB.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .bind(passwordHash, now, user.id),
      env.DB.prepare('UPDATE admin_password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
        .bind(now, resetToken.token_hash),
      createAdminActionStatement(env.DB, {
        actionType: 'password_reset_completed',
        targetType: 'admin_user',
        targetId: user.id,
        details: { username: user.username },
        performedBy: user.username,
        performedAt: now,
        ipAddress: getClientIP(request),
      }),
    ]);

    return successResponse({ message: '密码重置成功，请使用新密码登录' }, { headers: corsPolicy.headers });
  } catch (error) {
    console.error('Admin reset password route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsPolicy.headers });
  }
}
