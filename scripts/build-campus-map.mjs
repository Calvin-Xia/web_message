#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCampusMapData } from '../src/shared/campusMapRules.js';

const [, , inputPath, outputPath = 'storage/campus-care-map.json'] = process.argv;

if (!inputPath) {
  console.error('Usage: npm run build:map -- <path-to-geojson> [output-path]');
  process.exit(1);
}

async function main() {
  const sourcePath = path.resolve(process.cwd(), inputPath);
  const targetPath = path.resolve(process.cwd(), outputPath);
  const source = await readFile(sourcePath, 'utf8');
  const geojson = JSON.parse(source);
  const campusMap = buildCampusMapData(geojson);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(campusMap, null, 2)}\n`);

  console.log(`Wrote ${campusMap.features.length} campus map features to ${targetPath}`);
}

main().catch((error) => {
  console.error(`Failed to build campus map: ${error.message}`);
  process.exit(1);
});
