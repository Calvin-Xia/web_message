import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('tracking page navigation', () => {
  it('links the public feed action to the updated public sync list', () => {
    const html = readFileSync(new URL('../tracking.html', import.meta.url), 'utf8');

    expect(html).toContain('href="/?page=1&sortField=updatedAt&sortOrder=desc#publicFeed">查看公开同步</a>');
  });
});
