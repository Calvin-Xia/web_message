import { verifyAdminKey, getCorsHeaders, createUnauthorizedResponse } from '../../../src/shared/auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  if (url.pathname === '/api/admin/issues' && request.method === 'GET') {
    const authHeader = request.headers.get('Authorization');
    const authResult = verifyAdminKey(authHeader, env);

    if (!authResult.valid) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    try {
      const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize')) || 20));
      const offset = (page - 1) * pageSize;

      const countResult = await env.DB.prepare(
        'SELECT COUNT(*) as total FROM issues'
      ).first();
      const total = countResult?.total || 0;
      const totalPages = Math.ceil(total / pageSize);

      const { results } = await env.DB.prepare(
        'SELECT id, issue, name, student_id, isInformationPublic, isReport, created_at FROM issues ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).bind(pageSize, offset).all();

      return new Response(JSON.stringify({ 
        issues: results,
        pagination: {
          page,
          pageSize,
          total,
          totalPages
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    } catch (error) {
      console.error('Database error:', error);
      const isProduction = env.ENVIRONMENT === 'production';
      return new Response(
        JSON.stringify({ 
          error: isProduction ? '服务器内部错误' : '数据库错误: ' + error.message 
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }
  }

  return new Response('Not Found', {
    status: 404,
    headers: corsHeaders,
  });
}
