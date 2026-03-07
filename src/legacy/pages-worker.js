/*
 * Archived former root-level _worker.js entry.
 * Kept only as historical reference after the repo was standardized on Pages Functions.
 * This file is not part of the supported deployment path.
 */
import { checkRateLimit } from '../shared/rateLimit.js';
import { verifyAdminKey, getCorsHeaders, createUnauthorizedResponse } from '../shared/auth.js';
import { parseJsonBody } from '../shared/request.js';

const cspHeader = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    try {
      if (path === '/' || path === '/index.html') {
        const html = await env.ASSETS.fetch(new Request('https://example.com/index.html'));
        return new Response(html.body, {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Content-Security-Policy': cspHeader,
          },
        });
      }

      if (path === '/admin.html') {
        const html = await env.ASSETS.fetch(new Request('https://example.com/admin.html'));
        return new Response(html.body, {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Content-Security-Policy': cspHeader,
          },
        });
      }

      if (path === '/styles.css') {
        const css = await env.ASSETS.fetch(new Request('https://example.com/styles.css'));
        return new Response(css.body, {
          headers: {
            'Content-Type': 'text/css;charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      if (path === '/storage/Beian.png') {
        const png = await env.ASSETS.fetch(new Request('https://example.com/storage/Beian.png'));
        return new Response(png.body, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      if (path === '/health' || path === '/health.html') {
        const html = await env.ASSETS.fetch(new Request('https://example.com/health.html'));
        return new Response(html.body, {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Content-Security-Policy': cspHeader,
          },
        });
      }

      if (path === '/api/health' && request.method === 'GET') {
        try {
          await env.DB.prepare('SELECT 1').first();
          return new Response(
            JSON.stringify({
              status: 'ok',
              timestamp: new Date().toISOString(),
              services: {
                database: 'connected',
              },
            }),
            {
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        } catch (error) {
          return new Response(
            JSON.stringify({
              status: 'degraded',
              timestamp: new Date().toISOString(),
              services: {
                database: 'error',
              },
              error: env.ENVIRONMENT === 'production' ? 'Database connection failed' : error.message,
            }),
            {
              status: 503,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }
      }

      if (path === '/api/issues' && request.method === 'GET') {
        const rateLimitResponse = await checkRateLimit(env, request, 'getIssues', corsHeaders);
        if (rateLimitResponse) {
          return rateLimitResponse;
        }

        const { results } = await env.DB.prepare(
          'SELECT id, issue, created_at FROM issues ORDER BY created_at ASC LIMIT 100'
        ).all();

        return new Response(JSON.stringify({ messages: results }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      if (path === '/api/issues' && request.method === 'POST') {
        const rateLimitResponse = await checkRateLimit(env, request, 'postIssue', corsHeaders);
        if (rateLimitResponse) {
          return rateLimitResponse;
        }

        const parsedBody = await parseJsonBody(request, corsHeaders);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }

        const data = parsedBody.data;
        const { issue, name, student_id, isInformationPublic, isReport } = data;

        if (!issue) {
          return new Response(
            JSON.stringify({ error: '问题内容不能为空' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        if (!name) {
          return new Response(
            JSON.stringify({ error: '姓名不能为空' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        if (name.length > 20) {
          return new Response(
            JSON.stringify({ error: '姓名不能超过20个字符' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        if (!student_id) {
          return new Response(
            JSON.stringify({ error: '学号不能为空' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        const studentIdPattern = /^\d{4}$|^\d{5}$|^\d{13}$/;
        if (!studentIdPattern.test(student_id)) {
          return new Response(
            JSON.stringify({ error: '学号必须为4位、5位或13位数字' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        if (issue.length > 1000) {
          return new Response(
            JSON.stringify({ error: '问题内容不能超过1000个字符' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        }

        const result = await env.DB.prepare(
          'INSERT INTO issues (issue, isInformationPublic, name, student_id, isReport, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
        )
          .bind(issue, isInformationPublic || 'no', name, student_id, isReport || 'no')
          .run();

        if (result.success) {
          return new Response(
            JSON.stringify({
              success: true,
              message: '问题提交成功',
            }),
            {
              headers: {
                'Content-Type': 'application/json',
                ...corsHeaders,
              },
            }
          );
        } else {
          throw new Error('保存问题失败');
        }
      }

      if (path === '/api/admin/issues' && request.method === 'GET') {
        const origin = request.headers.get('Origin');
        const adminCorsHeaders = getCorsHeaders(origin, env);

        const authHeader = request.headers.get('Authorization');
        const authResult = verifyAdminKey(authHeader, env);

        if (!authResult.valid) {
          return createUnauthorizedResponse(authResult.error, adminCorsHeaders);
        }

        try {
          const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
          const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize')) || 20));
          const offset = (page - 1) * pageSize;

          const statsResult = await env.DB.prepare(
            `SELECT
              COUNT(*) as total,
              SUM(CASE WHEN isInformationPublic = 'yes' THEN 1 ELSE 0 END) as publicCount,
              SUM(CASE WHEN isReport = 'yes' THEN 1 ELSE 0 END) as reportCount,
              SUM(CASE
                WHEN created_at >= datetime('now', 'start of day')
                 AND created_at < datetime('now', 'start of day', '+1 day') THEN 1
                ELSE 0
              END) as todayCount
            FROM issues`
          ).first();
          const stats = {
            total: Number(statsResult?.total) || 0,
            publicCount: Number(statsResult?.publicCount) || 0,
            reportCount: Number(statsResult?.reportCount) || 0,
            todayCount: Number(statsResult?.todayCount) || 0,
            todayTimezone: 'UTC',
          };
          const totalPages = Math.ceil(stats.total / pageSize);

          const { results } = await env.DB.prepare(
            'SELECT id, issue, name, student_id, isInformationPublic, isReport, created_at FROM issues ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).bind(pageSize, offset).all();

          return new Response(JSON.stringify({
            issues: results,
            pagination: {
              page,
              pageSize,
              total: stats.total,
              totalPages,
            },
            stats,
          }), {
            headers: {
              'Content-Type': 'application/json',
              ...adminCorsHeaders,
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
                ...adminCorsHeaders,
              },
            }
          );
        }
      }

      if (path === '/api/admin/issues' && request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin');
        const adminCorsHeaders = getCorsHeaders(origin, env);
        return new Response(null, {
          headers: adminCorsHeaders,
        });
      }

      return new Response('Not Found', {
        status: 404,
        headers: corsHeaders,
      });
    } catch (error) {
      console.error('Error:', error);
      const isProduction = env.ENVIRONMENT === 'production';
      return new Response(
        JSON.stringify({ 
          error: isProduction ? '服务器内部错误' : '服务器错误: ' + error.message 
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
  },
};

