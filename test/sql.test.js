import { describe, expect, it } from 'vitest';
import { createContainsLikePattern, escapeLikePattern } from '../src/shared/sql.js';

describe('escapeLikePattern', () => {
  it('escapes SQLite LIKE wildcards and the escape character itself', () => {
    expect(escapeLikePattern('100%_done\\path')).toBe('100\\%\\_done\\\\path');
  });
});

describe('createContainsLikePattern', () => {
  it('wraps escaped input with wildcard markers', () => {
    expect(createContainsLikePattern('ab%c_d')).toBe('%ab\\%c\\_d%');
  });
});
