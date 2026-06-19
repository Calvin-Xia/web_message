import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectRoot, 'assets');

if (!outputDir.startsWith(`${projectRoot}${sep}`)) {
  throw new Error('Refusing to clean a JavaScript output directory outside the project.');
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({
  absWorkingDir: projectRoot,
  entryPoints: {
    'public-app': 'public-app.js',
    'admin-app': 'admin-app.js',
    'health-app': 'health-app.js',
    'login-app': 'login-app.js',
    'side-nav': 'side-nav.js',
    'ux-runtime': 'ux-runtime.js',
  },
  outdir: outputDir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
});
