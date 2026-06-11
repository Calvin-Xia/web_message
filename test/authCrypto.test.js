import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
} from '../src/shared/password.js';
import {
  blacklistToken,
  generateToken,
  isTokenBlacklisted,
  verifyToken,
} from '../src/shared/jwt.js';
import { createRateLimitKv } from './helpers/fakeCloudflare.js';

describe('password helpers', () => {
  it('hashes passwords with bcrypt and verifies only matching passwords', async () => {
    const hash = await hashPassword('Secure123!');

    expect(hash).not.toBe('Secure123!');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('Secure123!', hash)).toBe(true);
    expect(await verifyPassword('Wrong123!', hash)).toBe(false);
  });
});

describe('JWT helpers', () => {
  it('generates and verifies a 24 hour admin token', async () => {
    const env = {
      ADMIN_JWT_SECRET: 'test-jwt-secret-32-characters-long',
      RATE_LIMIT_KV: createRateLimitKv(),
    };
    const issuedAt = new Date('2099-01-01T00:00:00.000Z');

    const result = await generateToken(env, {
      id: 1,
      username: 'admin',
      role: 'admin',
    }, {
      now: issuedAt,
    });
    const verified = await verifyToken(result.token, env);

    expect(result.expiresAt).toBe('2099-01-02T00:00:00.000Z');
    expect(verified.valid).toBe(true);
    expect(verified.user).toMatchObject({
      id: 1,
      username: 'admin',
      role: 'admin',
    });
  });

  it('extends remember-me tokens to seven days and rejects blacklisted tokens', async () => {
    const env = {
      ADMIN_JWT_SECRET: 'test-jwt-secret-32-characters-long',
      RATE_LIMIT_KV: createRateLimitKv(),
    };
    const issuedAt = new Date('2099-01-01T00:00:00.000Z');
    const { token, expiresAt } = await generateToken(env, {
      id: 2,
      username: 'handler',
      role: 'handler',
    }, {
      rememberMe: true,
      now: issuedAt,
    });

    await blacklistToken(token, env, { now: issuedAt });
    const verified = await verifyToken(token, env);

    expect(expiresAt).toBe('2099-01-08T00:00:00.000Z');
    expect(await isTokenBlacklisted(token, env)).toBe(true);
    expect(verified).toEqual({ valid: false, error: '令牌已失效' });
  });
});
