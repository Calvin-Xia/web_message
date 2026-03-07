export async function parseJsonBody(request, corsHeaders = {}) {
  try {
    const data = await request.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: '请求体不是合法 JSON' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      ),
    };
  }
}