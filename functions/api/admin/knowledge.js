import { createForbiddenOriginResponse, authorizeAdminRequest } from '../../../src/shared/auth.js';
import { getAdminCorsPolicy } from '../../../src/shared/corsConfig.js';
import { createKnowledgeActionStatement, getKnowledgeItemById, mapKnowledgeItem } from '../../../src/shared/knowledgeData.js';
import { successResponse, errorResponse, createOptionsResponse, methodNotAllowedResponse } from '../../../src/shared/response.js';
import { checkAdminRateLimit, getClientIP } from '../../../src/shared/rateLimit.js';
import { parseJsonBody } from '../../../src/shared/request.js';
import { formatZodError, knowledgeCreateSchema } from '../../../src/shared/validation.js';

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

async function listKnowledgeItems(db) {
  const rows = await db.prepare(`
    SELECT id, title, tag, content, sort_order, is_enabled, created_at, updated_at
    FROM knowledge_items
    ORDER BY sort_order ASC, id ASC
  `).all();

  return (rows.results || []).map(mapKnowledgeItem);
}

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

  const authResult = authorizeAdminRequest(request, env, ALLOWED_METHODS);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    if (request.method === 'GET') {
      return successResponse({
        items: await listKnowledgeItems(env.DB),
      }, { headers: authResult.corsHeaders });
    }

    const parsedBody = await parseJsonBody(request, authResult.corsHeaders);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const validationResult = knowledgeCreateSchema.safeParse(parsedBody.data);
    if (!validationResult.success) {
      return errorResponse(formatZodError(validationResult.error), { status: 400, headers: authResult.corsHeaders });
    }

    const payload = validationResult.data;
    const now = new Date().toISOString();
    const insertResult = await env.DB.prepare(`
      INSERT INTO knowledge_items (
        title, tag, content, sort_order, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        payload.title,
        payload.tag,
        payload.content,
        payload.sortOrder,
        payload.isEnabled ? 1 : 0,
        now,
        now,
      )
      .run();

    const itemId = Number(insertResult?.meta?.last_row_id);
    const createdItem = await getKnowledgeItemById(env.DB, itemId);
    await createKnowledgeActionStatement(env.DB, {
      actionType: 'knowledge_created',
      item: createdItem,
      performedBy: authResult.actor,
      ipAddress: getClientIP(request),
      performedAt: now,
    }).run();

    return successResponse(mapKnowledgeItem(createdItem), {
      status: 201,
      headers: authResult.corsHeaders,
    });
  } catch (error) {
    console.error('Admin knowledge collection route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `数据库错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: authResult.corsHeaders });
  }
}
