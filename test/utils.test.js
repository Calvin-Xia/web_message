import { describe, expect, it } from 'vitest';
import { getAdminRateLimitEndpoint } from '../src/shared/rateLimit.js';
import { parseJsonValue } from '../src/shared/utils.js';

describe('parseJsonValue', () => {
  it('returns parsed JSON when input is valid', () => {
    expect(parseJsonValue('{"ok":true}', null)).toEqual({ ok: true });
  });

  it('returns fallback when input is invalid', () => {
    expect(parseJsonValue('{bad', { ok: false })).toEqual({ ok: false });
  });
});

describe('getAdminRateLimitEndpoint', () => {
  it('uses the read bucket for GET requests', () => {
    expect(getAdminRateLimitEndpoint('GET')).toBe('adminRead');
  });

  it('uses the write bucket for non-GET requests', () => {
    expect(getAdminRateLimitEndpoint('PATCH')).toBe('adminWrite');
    expect(getAdminRateLimitEndpoint('POST')).toBe('adminWrite');
  });
});
