import { describe, expect, it } from 'vitest';

import {
  DISTRESS_TYPE_VALUES,
  SCENE_TAG_VALUES,
} from '../src/shared/constants.js';
import {
  distressTypeLabels,
  sceneTagLabels,
} from '../src/shared/labels.js';

describe('shared labels', () => {
  it('covers every counseling enum value used by the API', () => {
    expect(Object.keys(distressTypeLabels).sort()).toEqual([...DISTRESS_TYPE_VALUES].sort());
    expect(Object.keys(sceneTagLabels).sort()).toEqual([...SCENE_TAG_VALUES].sort());
  });

  it('provides display text for counseling fields', () => {
    expect(Object.values(distressTypeLabels).every((label) => label.length > 0)).toBe(true);
    expect(Object.values(sceneTagLabels).every((label) => label.length > 0)).toBe(true);
  });
});
