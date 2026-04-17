import { describe, expect, it } from 'vitest';
import { createCampusProjector } from '../src/shared/campusMapProjection.js';
import { geometryToPath, geometryToPoint } from '../src/shared/campusMapGeometry.js';

const project = createCampusProjector([114.3, 30.49, 114.39, 30.57], {
  width: 640,
  height: 700,
  padding: 36,
});

describe('campus map geometry helpers', () => {
  it('returns an empty path for missing, malformed, or unsupported path geometries', () => {
    expect(geometryToPath(null, project)).toBe('');
    expect(geometryToPath({ type: 'Polygon', coordinates: null }, project)).toBe('');
    expect(geometryToPath({ type: 'LineString', coordinates: [['bad', 30.5]] }, project)).toBe('');
    expect(geometryToPath({ type: 'GeometryCollection', geometries: [] }, project)).toBe('');
  });

  it('returns null for malformed point geometries', () => {
    expect(geometryToPoint(null, project)).toBeNull();
    expect(geometryToPoint({ type: 'Point', coordinates: ['bad', 30.5] }, project)).toBeNull();
    expect(geometryToPoint({ type: 'MultiPoint', coordinates: [['bad', 30.5]] }, project)).toBeNull();
  });

  it('creates SVG path data for supported geometry types', () => {
    const path = geometryToPath({
      type: 'LineString',
      coordinates: [
        [114.31, 30.5],
        [114.32, 30.51],
      ],
    }, project);

    expect(path).toMatch(/^M \d+(\.\d+)? \d+(\.\d+)? L \d+(\.\d+)? \d+(\.\d+)?$/);
  });
});
