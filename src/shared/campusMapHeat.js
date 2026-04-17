import { SCENE_TAG_VALUES } from './constants.js';

export function calculateSceneHeatLevel(total, maxTotal) {
  const normalizedTotal = Math.max(0, Number(total) || 0);
  const normalizedMax = Math.max(0, Number(maxTotal) || 0);

  if (normalizedTotal === 0 || normalizedMax === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil((normalizedTotal / normalizedMax) * 4));
}

export function normalizeSceneHeat(sceneHotspots = []) {
  const source = new Map(
    sceneHotspots
      .filter((item) => item?.scene && SCENE_TAG_VALUES.includes(item.scene))
      .map((item) => [item.scene, {
        scene: item.scene,
        total: Math.max(0, Number(item.total) || 0),
        pending: Math.max(0, Number(item.pending) || 0),
      }]),
  );

  const maxTotal = Math.max(0, ...SCENE_TAG_VALUES.map((scene) => source.get(scene)?.total || 0));
  const byScene = Object.fromEntries(SCENE_TAG_VALUES.map((scene) => {
    const stats = source.get(scene) || {
      scene,
      total: 0,
      pending: 0,
    };

    return [scene, {
      ...stats,
      heatLevel: calculateSceneHeatLevel(stats.total, maxTotal),
    }];
  }));

  return {
    maxTotal,
    byScene,
  };
}
