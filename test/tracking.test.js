import { describe, expect, it } from 'vitest';
import { generateUniqueTrackingCode, insertWithUniqueTrackingCode } from '../src/shared/tracking.js';

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
});
