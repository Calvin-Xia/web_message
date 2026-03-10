import { describe, expect, it } from 'vitest';
import { canTransitionStatus } from '../src/shared/constants.js';

describe('canTransitionStatus', () => {
  it('allows documented transitions', () => {
    expect(canTransitionStatus('submitted', 'in_review')).toBe(true);
    expect(canTransitionStatus('in_progress', 'resolved')).toBe(true);
    expect(canTransitionStatus('resolved', 'closed')).toBe(true);
    expect(canTransitionStatus('resolved', 'in_progress')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransitionStatus('submitted', 'resolved')).toBe(false);
    expect(canTransitionStatus('closed', 'submitted')).toBe(false);
    expect(canTransitionStatus('in_review', 'resolved')).toBe(false);
  });
});
