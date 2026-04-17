export function formatSvgNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

function isCoordinatePair(coordinate) {
  return Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(Number(coordinate[0]))
    && Number.isFinite(Number(coordinate[1]));
}

function coordinateToSvgPoint(coordinate, project) {
  const point = project(coordinate);
  return `${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`;
}

function lineStringToPath(coordinates, project, closePath = false) {
  const points = Array.isArray(coordinates) ? coordinates.filter(isCoordinatePair) : [];
  if (!points.length) {
    return '';
  }

  const path = points.map((coordinate, index) => `${index === 0 ? 'M' : 'L'} ${coordinateToSvgPoint(coordinate, project)}`).join(' ');
  return closePath ? `${path} Z` : path;
}

function polygonToPath(rings, project) {
  return Array.isArray(rings)
    ? rings.map((ring) => lineStringToPath(ring, project, true)).filter(Boolean).join(' ')
    : '';
}

export function geometryToPath(geometry, project) {
  if (!geometry || typeof geometry.type !== 'string' || typeof project !== 'function') {
    return '';
  }

  switch (geometry.type) {
    case 'Polygon':
      return polygonToPath(geometry.coordinates, project);
    case 'MultiPolygon':
      return Array.isArray(geometry.coordinates)
        ? geometry.coordinates.map((polygon) => polygonToPath(polygon, project)).filter(Boolean).join(' ')
        : '';
    case 'LineString':
      return lineStringToPath(geometry.coordinates, project);
    case 'MultiLineString':
      return Array.isArray(geometry.coordinates)
        ? geometry.coordinates.map((line) => lineStringToPath(line, project)).filter(Boolean).join(' ')
        : '';
    default:
      return '';
  }
}

export function geometryToPoint(geometry, project) {
  if (!geometry || typeof geometry.type !== 'string' || typeof project !== 'function') {
    return null;
  }

  if (geometry.type === 'Point' && isCoordinatePair(geometry.coordinates)) {
    return project(geometry.coordinates);
  }

  if (geometry.type === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
    const coordinate = geometry.coordinates.find(isCoordinatePair);
    return coordinate ? project(coordinate) : null;
  }

  return null;
}
