import { describe, expect, it } from 'vitest';
import { parseJsonBody } from '../src/shared/request.js';
import { methodNotAllowedResponse, notFoundResponse, successResponse } from '../src/shared/response.js';

describe('request and response helpers', () => {
  it('returns a structured error when json parsing fails', async () => {
    const response = await parseJsonBody(new Request('http://localhost/api/issues', {
      method: 'POST',
      body: '{bad-json',
      headers: {
        'Content-Type': 'application/json',
      },
    }));

    expect(response.ok).toBe(false);
    expect(response.response.status).toBe(400);
  });

  it('builds standard success and error-style responses', async () => {
    const success = successResponse({ ok: true });
    const missing = notFoundResponse('不存在');
    const method = methodNotAllowedResponse({}, 'GET');

    expect(await success.json()).toEqual({ success: true, data: { ok: true } });
    expect(missing.status).toBe(404);
    expect(method.status).toBe(405);
    expect(method.headers.get('Allow')).toBe('GET');
  });
});
