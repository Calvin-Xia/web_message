import { describe, expect, it } from 'vitest';
import { createCsvContent, escapeCsvValue } from '../src/shared/csv.js';

describe('escapeCsvValue', () => {
  it('quotes cells that contain separators, quotes or new lines', () => {
    expect(escapeCsvValue('hello,world')).toBe('"hello,world"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('createCsvContent', () => {
  it('prepends UTF-8 BOM and joins rows', () => {
    const csv = createCsvContent(['id', 'content'], [[1, '测试']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('id,content');
    expect(csv).toContain('1,测试');
  });
});
