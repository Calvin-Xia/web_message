import { getAdminCorsPolicy } from '../../../../src/shared/corsConfig.js';
import { createPasswordResetToken, getAdminUserByUsername } from '../../../../src/shared/adminUsers.js';
import { sendPasswordResetEmail } from '../../../../src/shared/email.js';
import { createAdminActionStatement } from '../../../../src/shared/issueData.js';
import { parseJsonBody } from '../../../../src/shared/request.js';
import { checkRateLimit, getClientIP } from '../../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../../src/shared/response.js';
import { forgotPasswordSchema, formatZodError } from '../../../../src/shared/validation.js';

const ALLOWED_METHODS = 'POST, OPTIONS';
const GENERIC_RESPONSE = { message: '如果该用户名存在，重置邮件已发送' };

async function recordForgotPasswordAction(env, { user, username, request, now }) {
  try {
    await createAdminActionStatement(env.DB, {
      actionType: 'password_reset_requested',
      targetType: 'admin_user',
      targetId: user?.id ?? null,
      details: { username },
      performedBy: user?.username ?? username,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();
  } catch (error) {
    console.error('Failed to record password reset request audit:', error);
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

  const rateLimitResponse = await checkRateLimit(env, request, 'adminForgotPassword', corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const parsedBody = await parseJsonBody(request, corsPolicy.headers);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = forgotPasswordSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: corsPolicy.headers });
    }

    const { username } = validationResult.data;
    const user = await getAdminUserByUsername(env.DB, username);
    const now = new Date().toISOString();

    if (user && Number(user.is_enabled) === 1) {
      const { token, tokenHash } = await createPasswordResetToken(env.DB, user.id, {
        now: new Date(now),
      });
      const emailResult = await sendPasswordResetEmail({
        env,
        requestUrl: request.url,
        username: user.username,
        resetToken: token,
        idempotencyKey: `admin-reset/${user.id}/${tokenHash}`,
      });

      if (!emailResult.success && !emailResult.skipped) {
        console.error('Admin password reset email failed:', {
          userId: user.id,
          username: user.username,
          error: emailResult.error,
          status: emailResult.status ?? null,
        });
      }
    }

    await recordForgotPasswordAction(env, {
      user,
      username,
      request,
      now,
    });

    return successResponse(GENERIC_RESPONSE, { headers: corsPolicy.headers });
  } catch (error) {
    console.error('Admin forgot password route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsPolicy.headers });
  }
}
