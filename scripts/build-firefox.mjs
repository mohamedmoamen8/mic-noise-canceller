#!/usr/bin/env node
// scripts/build-firefox.mjs
// Builds the Firefox (MV2) variant of the extension into dist-firefox/.
//
// Differences from the Chrome build (scripts/build.mjs):
//   - Uses manifest_firefox.json instead of manifest.json
//   - Includes background-firefox.html + background-firefox.js
//   - Omits offscreen.js (Firefox has no offscreen document API)
//   - Omits background.js (replaced by background-firefox.js)
//
// Entry points that are SHARED with Chrome (no changes needed):
//   popup.ts, options.ts, noise-processor.ts

import { build, context } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-firefox');

const isWatch = process.argv.includes('--watch');

async function clean() {
  if (existsSync(dist)) {
    await rm(dist, { recursive: true, force: true });
  }
  await mkdir(dist, { recursive: true });
}

async function copyStaticAssets() {
  // Copy everything from public/ into dist-firefox/
  await cp(path.join(root, 'public'), dist, { recursive: true });

  // Replace manifest.json with the Firefox-specific one.
  const firefoxManifest = await readFile(path.join(root, 'public', 'manifest_firefox.json'), 'utf-8');
  await writeFile(path.join(dist, 'manifest.json'), firefoxManifest);

  // The Firefox background page is already copied as background-firefox.html.
  // manifest_firefox.json references it directly, so no rename needed.
}

const entries = [
  // Firefox-specific merged background + audio pipeline
  { in: 'src/entrypoints/background-firefox/background-firefox.ts', out: 'background-firefox' },
  // Shared entry points (identical to the Chrome build)
  { in: 'src/entrypoints/popup/popup.ts', out: 'popup' },
  { in: 'src/entrypoints/options/options.ts', out: 'options' },
  // The worklet bundle inlines the RNNoise WASM binary (as base64).
  { in: 'src/entrypoints/worklet/noise-processor.ts', out: 'noise-processor' },
];

function optionsFor(entryPoint, out) {
  return {
    entryPoints: [path.join(root, entryPoint)],
    outfile: path.join(dist, `${out}.js`),
    bundle: true,
    format: 'iife',
    // Firefox 109+ supports ES2022; target slightly lower for safety.
    target: 'firefox109',
    platform: 'browser',
    sourcemap: true,
    minify: !isWatch,
    logLevel: 'info',
  };
}

async function buildAll() {
  await clean();
  await copyStaticAssets();

  if (isWatch) {
    const contexts = await Promise.all(
      entries.map(({ in: entryPoint, out }) => context(optionsFor(entryPoint, out)))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('\nWatching for changes (Firefox build)...');
    return;
  }

  await Promise.all(entries.map(({ in: entryPoint, out }) => build(optionsFor(entryPoint, out))));
  console.log(`\nFirefox build complete → ${path.relative(root, dist)}/`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
