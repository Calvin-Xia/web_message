import { describe, expect, it } from 'vitest';
import { generateUniqueTrackingCode } from '../src/shared/tracking.js';

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
