import { describe, expect, it } from 'vitest';
import {
  generateTrackingCode,
  generateUniqueTrackingCode,
  generateUniqueTrackingCodeForDb,
  insertWithUniqueTrackingCode,
  isTrackingCodeConflictError,
} from '../src/shared/tracking.js';
import { createD1Database } from './helpers/fakeCloudflare.js';

describe('generateTrackingCode', () => {
  it('returns an 8-character code from the allowed alphabet', () => {
    const code = generateTrackingCode();

    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });
});

describe('isTrackingCodeConflictError', () => {
  it('detects tracking code conflicts from strings, errors, and nested causes', () => {
    expect(isTrackingCodeConflictError('UNIQUE constraint failed: issues.tracking_code')).toBe(true);
    expect(isTrackingCodeConflictError(new Error('UNIQUE constraint failed: issues.tracking_code'))).toBe(true);
    expect(isTrackingCodeConflictError({
      cause: {
        message: 'D1_ERROR: UNIQUE constraint failed: issues.tracking_code',
      },
    })).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isTrackingCodeConflictError(new Error('database locked'))).toBe(false);
    expect(isTrackingCodeConflictError(null)).toBe(false);
  });
});

describe('generateUniqueTrackingCode', () => {
  it('retries when a code collides', async () => {
    const generated = ['ABCD23EF', 'FGHJ45KL'];
    const code = await generateUniqueTrackingCode(
      async (value) => value === 'ABCD23EF',
      {
        maxAttempts: 3,
        codeFactory: () => generated.shift(),
      },
    );

    expect(code).toBe('FGHJ45KL');
  });

  it('throws after exhausting attempts', async () => {
    await expect(generateUniqueTrackingCode(async () => true, {
      maxAttempts: 2,
      codeFactory: () => 'ABCD23EF',
    })).rejects.toThrow('追踪编号生成失败');
  });
});

describe('insertWithUniqueTrackingCode', () => {
  it('retries when insert hits a unique tracking code conflict', async () => {
    const generated = ['ABCD23EF', 'FGHJ45KL'];
    let attempts = 0;

    const result = await insertWithUniqueTrackingCode(async (trackingCode) => {
      attempts += 1;
      if (trackingCode === 'ABCD23EF') {
        throw new Error('D1_ERROR: UNIQUE constraint failed: issues.tracking_code');
      }

      return { ok: true, trackingCode };
    }, {
      maxAttempts: 3,
      codeFactory: () => generated.shift(),
    });

    expect(attempts).toBe(2);
    expect(result).toEqual({
      trackingCode: 'FGHJ45KL',
      result: { ok: true, trackingCode: 'FGHJ45KL' },
    });
  });

  it('throws a tracking code error after exhausting insert retries', async () => {
    await expect(insertWithUniqueTrackingCode(async () => {
      throw new Error('UNIQUE constraint failed: issues.tracking_code');
    }, {
      maxAttempts: 2,
      codeFactory: () => 'ABCD23EF',
    })).rejects.toThrow('追踪编号生成失败');
  });

  it('rethrows non-conflict insert errors immediately', async () => {
    await expect(insertWithUniqueTrackingCode(async () => {
      throw new Error('database locked');
    }, {
      maxAttempts: 2,
      codeFactory: () => 'ABCD23EF',
    })).rejects.toThrow('database locked');
  });
});

describe('generateUniqueTrackingCodeForDb', () => {
  it('checks the database for existing tracking codes', async () => {
    const db = createD1Database();
    db.issues.push({
      id: 1,
      tracking_code: 'ABCD23EF',
    });
    const generated = ['ABCD23EF', 'FGHJ45KL'];

    const code = await generateUniqueTrackingCodeForDb(db, {
      maxAttempts: 3,
      codeFactory: () => generated.shift(),
    });

    expect(code).toBe('FGHJ45KL');
  });
});
