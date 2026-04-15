import { describe, expect, it } from 'vitest';
import {
  getAdminCorsPolicy,
  LOOPBACK_ADMIN_HOSTS,
  PRODUCTION_ADMIN_EXACT_ORIGINS,
  PRODUCTION_PAGES_HOST,
} from '../src/shared/corsConfig.js';

describe('admin CORS policy', () => {
  it('keeps the trusted origin sets explicit', () => {
    expect(PRODUCTION_ADMIN_EXACT_ORIGINS).toEqual(new Set([
      'https://issue.calvin-xia.cn',
      'https://demo.calvin-xia.cn',
      'https://web-message-board.pages.dev',
    ]));
    expect(PRODUCTION_ADMIN_EXACT_ORIGINS.has('https://issue-origin.calvin-xia.cn')).toBe(false);
    expect(PRODUCTION_PAGES_HOST).toBe('web-message-board.pages.dev');
    expect(LOOPBACK_ADMIN_HOSTS).toEqual(new Set(['localhost', '127.0.0.1']));
  });

  it('allows loopback origins outside production and supports requests without origin', () => {
    const localPolicy = getAdminCorsPolicy('http://localhost:8788', { ENVIRONMENT: 'development' });
    const loopbackPolicy = getAdminCorsPolicy('http://127.0.0.1:8788', { ENVIRONMENT: 'preview' });
    const credentialPolicy = getAdminCorsPolicy('http://user:pass@localhost:8788', { ENVIRONMENT: 'development' });
    const defaultEnvPolicy = getAdminCorsPolicy('http://localhost:8788');
    const noOriginPolicy = getAdminCorsPolicy(null, { ENVIRONMENT: 'development' });

    expect(localPolicy.isOriginAllowed).toBe(true);
    expect(localPolicy.headers['Access-Control-Allow-Origin']).toBe('http://localhost:8788');
    expect(loopbackPolicy.isOriginAllowed).toBe(true);
    expect(loopbackPolicy.headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:8788');
    expect(credentialPolicy.isOriginAllowed).toBe(true);
    expect(credentialPolicy.normalizedOrigin).toBe('http://localhost:8788');
    expect(credentialPolicy.headers['Access-Control-Allow-Origin']).toBe('http://localhost:8788');
    expect(defaultEnvPolicy.isOriginAllowed).toBe(true);
    expect(noOriginPolicy.hasOrigin).toBe(false);
    expect(noOriginPolicy.headers.Vary).toBe('Origin');
  });

  it('allows configured production origins and rejects removed origins', () => {
    for (const origin of PRODUCTION_ADMIN_EXACT_ORIGINS) {
      const policy = getAdminCorsPolicy(origin, { ENVIRONMENT: 'production' });

      expect(policy.isOriginAllowed).toBe(true);
      expect(policy.headers['Access-Control-Allow-Origin']).toBe(origin);
    }

    const removedPolicy = getAdminCorsPolicy('https://issue-origin.calvin-xia.cn', { ENVIRONMENT: 'production' });
    expect(removedPolicy.isOriginAllowed).toBe(false);
    expect(removedPolicy.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('accepts only single-level Pages branches in production', () => {
    const branchPolicy = getAdminCorsPolicy(`https://feature.${PRODUCTION_PAGES_HOST}`, { ENVIRONMENT: 'production' });
    const nestedBranchPolicy = getAdminCorsPolicy(`https://feature.preview.${PRODUCTION_PAGES_HOST}`, { ENVIRONMENT: 'production' });

    expect(branchPolicy.isOriginAllowed).toBe(true);
    expect(nestedBranchPolicy.isOriginAllowed).toBe(false);
  });

  it('rejects invalid schemes, ports, and untrusted production origins', () => {
    const invalidPolicy = getAdminCorsPolicy('file:///tmp/test', { ENVIRONMENT: 'development' });
    const evilPolicy = getAdminCorsPolicy('https://evil.example.com', { ENVIRONMENT: 'production' });
    const portPolicy = getAdminCorsPolicy('https://web-message-board.pages.dev:8443', { ENVIRONMENT: 'production' });

    expect(invalidPolicy.isOriginAllowed).toBe(false);
    expect(invalidPolicy.normalizedOrigin).toBeNull();
    expect(evilPolicy.isOriginAllowed).toBe(false);
    expect(portPolicy.isOriginAllowed).toBe(false);
  });
});
