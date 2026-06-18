import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDirectory = join(projectRoot, 'node_modules', 'swagger-ui-dist');
const outputDirectory = join(projectRoot, 'docs', 'swagger');
const assetNames = [
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'favicon-16x16.png',
  'favicon-32x32.png',
];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(assetNames.map((assetName) => (
  copyFile(join(sourceDirectory, assetName), join(outputDirectory, assetName))
)));

console.log(`Swagger UI assets copied to ${outputDirectory}`);
