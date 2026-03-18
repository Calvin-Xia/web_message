import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendIssueStatusNotification } from '../src/shared/email.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('email helpers', () => {
  it('short-circuits invalid Resend API keys before issuing a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendIssueStatusNotification({
      env: {
        ENVIRONMENT: 'development',
        RESEND_API_KEY: 'invalid-key',
      },
      requestUrl: 'http://localhost/api/admin/issues/1',
      issue: {
        tracking_code: 'ABCD23EF',
        email: 'student@example.com',
        public_summary: '问题已修复并恢复正常。',
      },
      status: 'resolved',
      idempotencyKey: 'issue-notify/1/status-resolved/test',
    });

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      error: 'RESEND_API_KEY has unexpected format',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
