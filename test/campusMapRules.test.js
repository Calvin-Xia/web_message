import { describe, expect, it } from 'vitest';
import { classifyCampusFeature, mapCampusFeature } from '../src/shared/campusMapRules.js';

function createFeature(properties, coordinates = [
  [
    [114.3301, 30.5301],
    [114.3304, 30.5301],
    [114.3304, 30.5304],
    [114.3301, 30.5304],
    [114.3301, 30.5301],
  ],
]) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates,
    },
  };
}

describe('campus map rules', () => {
  it('filters administrative boundaries and the Shenzhen outlier', () => {
    const boundary = createFeature({
      '@id': 'relation/3076297',
      boundary: 'administrative',
      name: '武昌区',
    });
    const shenzhenOutlier = createFeature({
      '@id': 'way/220879204',
      'addr:city': '深圳',
      building: 'commercial',
      name: '武汉大学',
    }, [
      [
        [113.9403, 22.5340],
        [113.9408, 22.5340],
        [113.9408, 22.5345],
        [113.9403, 22.5345],
        [113.9403, 22.5340],
      ],
    ]);

    expect(mapCampusFeature(boundary)).toBeNull();
    expect(mapCampusFeature(shenzhenOutlier)).toBeNull();
  });

  it.each([
    [{ '@id': 'way/1', building: 'dormitory', name: '梅园三舍' }, 'dormitory'],
    [{ '@id': 'way/2', building: 'university', name: '工学部1号教学楼' }, 'classroom'],
    [{ '@id': 'way/3', amenity: 'library', building: 'library', name: '武汉大学图书馆' }, 'library'],
    [{ '@id': 'way/4', amenity: 'canteen', building: 'yes', name: '梅园食堂' }, 'cafeteria'],
    [{ '@id': 'way/5', leisure: 'sports_hall', building: 'sports_hall', name: '竹园体育馆' }, 'playground'],
  ])('maps %s to %s', (properties, scene) => {
    const feature = createFeature(properties);

    expect(classifyCampusFeature(feature)).toBe(scene);
    expect(mapCampusFeature(feature)).toMatchObject({
      id: properties['@id'],
      scene,
      name: properties.name,
    });
  });

  it('does not classify road names like 求是大道 as self study space', () => {
    const feature = {
      type: 'Feature',
      properties: {
        '@id': 'way/road',
        highway: 'residential',
        name: '求是大道',
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [114.3301, 30.5301],
          [114.3311, 30.5311],
        ],
      },
    };

    expect(classifyCampusFeature(feature)).toBeNull();
    expect(mapCampusFeature(feature)).toBeNull();
  });
});
