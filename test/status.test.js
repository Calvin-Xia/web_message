import { describe, expect, it } from 'vitest';
import { canTransitionStatus, STATUS_VALUES } from '../src/shared/constants.js';

const allowedTransitions = [
  ['submitted', 'submitted'],
  ['submitted', 'in_review'],
  ['submitted', 'closed'],
  ['in_review', 'in_review'],
  ['in_review', 'in_progress'],
  ['in_review', 'closed'],
  ['in_progress', 'in_progress'],
  ['in_progress', 'resolved'],
  ['in_progress', 'closed'],
  ['resolved', 'resolved'],
  ['resolved', 'closed'],
  ['resolved', 'in_progress'],
  ['closed', 'closed'],
];

describe('canTransitionStatus', () => {
  it('allows documented transitions and same-state idempotent updates', () => {
    for (const [fromStatus, toStatus] of allowedTransitions) {
      expect(canTransitionStatus(fromStatus, toStatus)).toBe(true);
    }
  });

  it('rejects every undocumented transition', () => {
    for (const fromStatus of STATUS_VALUES) {
      for (const toStatus of STATUS_VALUES) {
        const expected = allowedTransitions.some(([from, to]) => from === fromStatus && to === toStatus);
        expect(canTransitionStatus(fromStatus, toStatus)).toBe(expected);
      }
    }
  });
});
