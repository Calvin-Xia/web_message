const DEFAULT_BBOX = [114.30, 30.49, 114.39, 30.57];
const MIN_SPAN = 0.000001;

export const CAMPUS_MAP_VIEWBOX = {
  width: 640,
  height: 700,
  padding: 36,
};

function normalizeBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return DEFAULT_BBOX;
  }

  const values = bbox.map((value) => Number(value));
  return values.every(Number.isFinite) ? values : DEFAULT_BBOX;
}

export function createCampusProjector(bbox, options = {}) {
  const [west, south, east, north] = normalizeBBox(bbox);
  const width = Math.max(1, Number(options.width) || 960);
  const height = Math.max(1, Number(options.height) || 620);
  const padding = Math.max(0, Number(options.padding) || 0);
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const longitudeSpan = Math.max(MIN_SPAN, east - west);
  const latitudeSpan = Math.max(MIN_SPAN, north - south);
  const midLatitudeRadians = ((south + north) / 2) * (Math.PI / 180);
  const longitudeScale = Math.max(0.1, Math.cos(midLatitudeRadians));
  const projectedWidth = longitudeSpan * longitudeScale;
  const projectedHeight = latitudeSpan;
  const scale = Math.min(innerWidth / projectedWidth, innerHeight / projectedHeight);
  const drawnWidth = projectedWidth * scale;
  const drawnHeight = projectedHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  return ([longitude, latitude]) => ({
    x: offsetX + (Number(longitude) - west) * longitudeScale * scale,
    y: offsetY + (north - Number(latitude)) * scale,
  });
}
