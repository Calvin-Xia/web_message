import { describe, expect, it } from 'vitest';
import { CAMPUS_MAP_VIEWBOX, createCampusProjector } from '../src/shared/campusMapProjection.js';

describe('campus map projection', () => {
  it('uses a vertical campus viewbox so the map can fill mobile width', () => {
    expect(CAMPUS_MAP_VIEWBOX.width / CAMPUS_MAP_VIEWBOX.height).toBeLessThan(1);
  });

  it('preserves local geographic aspect ratio instead of stretching to the viewport', () => {
    const bbox = [114.3488916, 30.5273597, 114.370205, 30.5474371];
    const project = createCampusProjector(bbox, {
      width: 960,
      height: 620,
      padding: 30,
    });
    const northwest = project([bbox[0], bbox[3]]);
    const northeast = project([bbox[2], bbox[3]]);
    const southwest = project([bbox[0], bbox[1]]);
    const xSpan = northeast.x - northwest.x;
    const ySpan = southwest.y - northwest.y;
    const midLatitude = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
    const expectedRatio = ((bbox[2] - bbox[0]) * Math.cos(midLatitude)) / (bbox[3] - bbox[1]);

    expect(xSpan / ySpan).toBeCloseTo(expectedRatio, 4);
    expect(northwest.y).toBeCloseTo(30, 4);
    expect(southwest.y).toBeCloseTo(590, 4);
    expect(northwest.x).toBeGreaterThan(180);
    expect(northeast.x).toBeLessThan(780);
  });
});
