import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('_headers security config', () => {
  it('applies the static page CSP to the root route as well as html files', () => {
    const headers = readFileSync('_headers', 'utf8');

    expect(headers).toMatch(/^\/\r?\n\s+Content-Security-Policy:/m);
    expect(headers).toMatch(/^\/\*\.html\r?\n\s+Content-Security-Policy:/m);
  });
});
