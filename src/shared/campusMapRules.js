export const CAMPUS_MAP_VERSION = 1;

export const WUHAN_CAMPUS_BOUNDS = {
  west: 114.30,
  south: 30.49,
  east: 114.39,
  north: 30.57,
};

const RELEVANT_TAG_KEYS = [
  '@id',
  'building',
  'amenity',
  'leisure',
  'highway',
  'landuse',
  'natural',
  'tourism',
  'type',
];

const DORMITORY_NAME_PATTERN = /宿舍|公寓|(?:\d+|[一二三四五六七八九十百]+)舍/;
const CLASSROOM_NAME_PATTERN = /教学楼|学院|教室|讲堂|课堂|实验楼|科技楼|研究生院|本科生院/;
const LIBRARY_NAME_PATTERN = /图书馆/;
const CAFETERIA_NAME_PATTERN = /食堂|餐厅/;
const PLAYGROUND_NAME_PATTERN = /操场|体育馆|运动场|风雨馆/;
const SELF_STUDY_NAME_PATTERN = /自习|阅览/;

function getProperties(feature) {
  return feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
}

function getName(properties) {
  return String(properties.name || properties['name:zh'] || properties.official_name || properties.alt_name || '').trim();
}

function hasName(properties, pattern) {
  return pattern.test(getName(properties));
}

function collectCoordinates(value, coordinates = []) {
  if (!Array.isArray(value)) {
    return coordinates;
  }

  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    coordinates.push(value);
    return coordinates;
  }

  value.forEach((item) => collectCoordinates(item, coordinates));
  return coordinates;
}

export function getGeometryBounds(geometry) {
  const coordinates = collectCoordinates(geometry?.coordinates);
  if (!coordinates.length) {
    return null;
  }

  return coordinates.reduce((bounds, [longitude, latitude]) => ({
    west: Math.min(bounds.west, longitude),
    south: Math.min(bounds.south, latitude),
    east: Math.max(bounds.east, longitude),
    north: Math.max(bounds.north, latitude),
  }), {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  });
}

export function isInsideCampusBounds(feature, bounds = WUHAN_CAMPUS_BOUNDS) {
  const featureBounds = getGeometryBounds(feature?.geometry);
  if (!featureBounds) {
    return false;
  }

  return featureBounds.west >= bounds.west
    && featureBounds.east <= bounds.east
    && featureBounds.south >= bounds.south
    && featureBounds.north <= bounds.north;
}

export function isAdministrativeBoundary(feature) {
  const properties = getProperties(feature);
  return properties.boundary === 'administrative' || properties.type === 'boundary';
}

export function isShenzhenOutlier(feature) {
  const properties = getProperties(feature);
  if (properties['addr:city'] === '深圳') {
    return true;
  }

  const bounds = getGeometryBounds(feature?.geometry);
  return getName(properties) === '武汉大学' && bounds != null && bounds.south < 29;
}

export function classifyCampusFeature(feature) {
  const properties = getProperties(feature);

  if (properties.building === 'dormitory' || hasName(properties, DORMITORY_NAME_PATTERN)) {
    return 'dormitory';
  }

  if (hasName(properties, SELF_STUDY_NAME_PATTERN)) {
    return 'self_study';
  }

  if (properties.amenity === 'library' || properties.building === 'library' || hasName(properties, LIBRARY_NAME_PATTERN)) {
    return 'library';
  }

  if (properties.amenity === 'canteen' || hasName(properties, CAFETERIA_NAME_PATTERN)) {
    return 'cafeteria';
  }

  if (
    ['sports_centre', 'sports_hall', 'track'].includes(properties.leisure)
    || ['sports_hall', 'grandstand'].includes(properties.building)
    || hasName(properties, PLAYGROUND_NAME_PATTERN)
  ) {
    return 'playground';
  }

  if (properties.building === 'university' || hasName(properties, CLASSROOM_NAME_PATTERN)) {
    return 'classroom';
  }

  return null;
}

export function getCampusFeatureKind(feature) {
  const geometryType = feature?.geometry?.type || '';
  if (geometryType.includes('Polygon')) {
    return 'area';
  }

  if (geometryType.includes('LineString')) {
    return 'line';
  }

  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    return 'point';
  }

  return 'geometry';
}

export function extractCampusTags(properties = {}) {
  return Object.fromEntries(
    RELEVANT_TAG_KEYS
      .filter((key) => properties[key] != null && properties[key] !== '')
      .map((key) => [key, properties[key]]),
  );
}

export function mapCampusFeature(feature, index = 0) {
  if (!feature?.geometry) {
    return null;
  }

  if (isAdministrativeBoundary(feature) || isShenzhenOutlier(feature) || !isInsideCampusBounds(feature)) {
    return null;
  }

  const scene = classifyCampusFeature(feature);
  if (!scene) {
    return null;
  }

  const properties = getProperties(feature);
  return {
    id: String(properties['@id'] || properties.id || `campus-feature-${index}`),
    geometry: feature.geometry,
    scene,
    kind: getCampusFeatureKind(feature),
    name: getName(properties) || null,
    tags: extractCampusTags(properties),
  };
}

export function calculateCampusMapBounds(features) {
  const initialBounds = {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  };

  const bounds = features.reduce((currentBounds, feature) => {
    const featureBounds = getGeometryBounds(feature.geometry);
    if (!featureBounds) {
      return currentBounds;
    }

    return {
      west: Math.min(currentBounds.west, featureBounds.west),
      south: Math.min(currentBounds.south, featureBounds.south),
      east: Math.max(currentBounds.east, featureBounds.east),
      north: Math.max(currentBounds.north, featureBounds.north),
    };
  }, initialBounds);

  if (!Number.isFinite(bounds.west)) {
    return [
      WUHAN_CAMPUS_BOUNDS.west,
      WUHAN_CAMPUS_BOUNDS.south,
      WUHAN_CAMPUS_BOUNDS.east,
      WUHAN_CAMPUS_BOUNDS.north,
    ];
  }

  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

export function buildCampusMapData(geojson) {
  const features = Array.isArray(geojson?.features)
    ? geojson.features.map((feature, index) => mapCampusFeature(feature, index)).filter(Boolean)
    : [];

  return {
    version: CAMPUS_MAP_VERSION,
    bbox: calculateCampusMapBounds(features),
    features,
  };
}
