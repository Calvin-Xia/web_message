import {
  authorizeAdminRequest,
  createForbiddenOriginResponse,
  requireAdminRole,
} from '../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../src/shared/corsConfig.js';
import { getAdminUserByUsername, mapAdminUser } from '../../../src/shared/adminUsers.js';
import { createAdminActionStatement } from '../../../src/shared/issueData.js';
import { hashPassword } from '../../../src/shared/password.js';
import { parseJsonBody } from '../../../src/shared/request.js';
import { checkAdminRateLimit, getClientIP } from '../../../src/shared/rateLimit.js';
import { createOptionsResponse, errorResponse, methodNotAllowedResponse, successResponse } from '../../../src/shared/response.js';
import { createUserSchema, formatZodError } from '../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

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

  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowedResponse(corsPolicy.headers, ALLOWED_METHODS);
  }

  const rateLimitResponse = await checkAdminRateLimit(env, request, corsPolicy.headers);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const authResult = requireAdminRole(await authorizeAdminRequest(request, env, ALLOWED_METHODS));
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    if (request.method === 'GET') {
      const rows = await env.DB.prepare(`
        SELECT id, username, display_name, role, is_enabled, last_login_at, created_at, updated_at
        FROM admin_users
        ORDER BY username COLLATE NOCASE ASC, id ASC
      `).all();

      return successResponse({
        items: (rows.results || []).map(mapAdminUser),
      }, { headers: authResult.corsHeaders });
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = createUserSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    const existingUser = await getAdminUserByUsername(env.DB, payload.username);
    if (existingUser) {
      return errorResponse('用户名已存在', { status: 409, headers: authResult.corsHeaders });
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(payload.password);
    const insertResult = await env.DB.prepare(`
      INSERT INTO admin_users (username, password_hash, display_name, role, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(payload.username, passwordHash, payload.displayName, payload.role, 1, now, now)
      .run();
    const userId = insertResult.meta.last_row_id;
    const createdUser = await env.DB.prepare('SELECT * FROM admin_users WHERE id = ? LIMIT 1')
      .bind(userId)
      .first();

    await createAdminActionStatement(env.DB, {
      actionType: 'user_created',
      targetType: 'admin_user',
      targetId: userId,
      details: {
        username: payload.username,
        role: payload.role,
      },
      performedBy: authResult.actor,
      performedAt: now,
      ipAddress: getClientIP(request),
    }).run();

    return successResponse(mapAdminUser(createdUser), {
      status: 201,
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin users route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
