import { describe, expect, it } from 'vitest';
import { calculateSceneHeatLevel, normalizeSceneHeat } from '../src/shared/campusMapHeat.js';

describe('campus map heat helpers', () => {
  it('builds scene stats from public insight hotspots', () => {
    const result = normalizeSceneHeat([
      { scene: 'dormitory', total: 5, pending: 2 },
      { scene: 'library', total: 1, pending: 0 },
    ]);

    expect(result.maxTotal).toBe(5);
    expect(result.byScene.dormitory).toEqual({
      scene: 'dormitory',
      total: 5,
      pending: 2,
      heatLevel: 4,
    });
    expect(result.byScene.library.heatLevel).toBe(1);
  });

  it('computes stable heat levels for empty, tied, and nonzero totals', () => {
    expect(calculateSceneHeatLevel(0, 0)).toBe(0);
    expect(calculateSceneHeatLevel(3, 3)).toBe(4);
    expect(calculateSceneHeatLevel(1, 4)).toBe(1);
    expect(calculateSceneHeatLevel(2, 4)).toBe(2);
    expect(calculateSceneHeatLevel(4, 4)).toBe(4);
  });

  it('keeps missing scene categories renderable with zero totals', () => {
    const result = normalizeSceneHeat([]);

    expect(result.maxTotal).toBe(0);
    expect(result.byScene.dormitory).toEqual({
      scene: 'dormitory',
      total: 0,
      pending: 0,
      heatLevel: 0,
    });
    expect(result.byScene.self_study).toEqual({
      scene: 'self_study',
      total: 0,
      pending: 0,
      heatLevel: 0,
    });
  });
});
