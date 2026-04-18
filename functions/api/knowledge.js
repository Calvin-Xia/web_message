import { checkRateLimit } from '../../src/shared/rateLimit.js';
import { mapKnowledgeItem } from '../../src/shared/knowledgeData.js';
import { successResponse, errorResponse, createOptionsResponse, createPublicCorsHeaders, methodNotAllowedResponse } from '../../src/shared/response.js';

const ALLOWED_METHODS = 'GET, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = createPublicCorsHeaders(ALLOWED_METHODS);

  if (request.method === 'OPTIONS') {
    return createOptionsResponse(corsHeaders);
  }

  if (request.method !== 'GET') {
    return methodNotAllowedResponse(corsHeaders, ALLOWED_METHODS);
  }

  const rateLimitResponse = await checkRateLimit(env, request, 'getIssues', corsHeaders);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const rows = await env.DB.prepare(`
      SELECT id, title, tag, content, sort_order, is_enabled, created_at, updated_at
      FROM knowledge_items
      WHERE is_enabled = 1
      ORDER BY sort_order ASC, id ASC
    `).all();

    return successResponse({
      items: (rows.results || []).map(mapKnowledgeItem),
    }, {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('Public knowledge route failed:', error);
    const message = env.ENVIRONMENT === 'production' ? '服务器内部错误' : `服务器错误: ${error.message}`;
    return errorResponse(message, { status: 500, headers: corsHeaders });
  }
}
