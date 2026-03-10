export async function parseJsonBody(request, corsHeaders = {}) {
  try {
    const data = await request.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ success: false, error: '请求体不是合法 JSON' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            ...corsHeaders,
          },
        }
      ),
    };
  }
}
