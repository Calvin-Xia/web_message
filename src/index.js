import indexHtml from '../index.html';
import stylesCss from '../styles.css';

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
        return new Response(indexHtml, {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
          },
        });
      }

      if (path === '/styles.css') {
        return new Response(stylesCss, {
          headers: {
            'Content-Type': 'text/css;charset=UTF-8',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      if (path === '/api/issues' && request.method === 'GET') {
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
        const data = await request.json();
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

      return new Response('Not Found', {
        status: 404,
        headers: corsHeaders,
      });
    } catch (error) {
      console.error('Error:', error);
      return new Response(
        JSON.stringify({ error: '服务器错误: ' + error.message }),
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
