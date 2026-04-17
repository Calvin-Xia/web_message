export const CAMPUS_MAP_DATA_ERROR_MESSAGE = '校园地图数据格式无效';

export async function readCampusMapResponse(response) {
  if (!response?.ok) {
    throw new Error(CAMPUS_MAP_DATA_ERROR_MESSAGE);
  }

  let campusMap;
  try {
    campusMap = await response.json();
  } catch {
    throw new Error(CAMPUS_MAP_DATA_ERROR_MESSAGE);
  }

  if (!Array.isArray(campusMap?.features) || !Array.isArray(campusMap.bbox)) {
    throw new Error(CAMPUS_MAP_DATA_ERROR_MESSAGE);
  }

  return campusMap;
}
