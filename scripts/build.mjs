#!/usr/bin/env node
// scripts/build.mjs
// Bundles each extension entry point independently (Chrome extensions load
// plain scripts, not a module graph) and copies static assets into dist/.

import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const isWatch = process.argv.includes('--watch');

async function clean() {
  if (existsSync(dist)) {
    await rm(dist, { recursive: true, force: true });
  }
  await mkdir(dist, { recursive: true });
}

async function copyStaticAssets() {
  await cp(path.join(root, 'public'), dist, { recursive: true });
}

const entries = [
  { in: 'src/entrypoints/background/background.ts', out: 'background' },
  { in: 'src/entrypoints/offscreen/offscreen.ts', out: 'offscreen' },
  { in: 'src/entrypoints/popup/popup.ts', out: 'popup' },
  { in: 'src/entrypoints/options/options.ts', out: 'options' },
  // The worklet bundle inlines the RNNoise WASM binary (as base64, via the
  // @jitsi/rnnoise-wasm "sync" build) so it stays a single classic script
  // addModule() can load with no extra network fetch or manifest wiring.
  { in: 'src/entrypoints/worklet/noise-processor.ts', out: 'noise-processor' }
];

function optionsFor(entryPoint, out) {
  return {
    entryPoints: [path.join(root, entryPoint)],
    outfile: path.join(dist, `${out}.js`),
    bundle: true,
    format: 'iife',
    target: 'chrome110',
    platform: 'browser',
    sourcemap: true,
    minify: !isWatch,
    logLevel: 'info'
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
    console.log('\nWatching for changes...');
    return;
  }

  await Promise.all(entries.map(({ in: entryPoint, out }) => build(optionsFor(entryPoint, out))));
  console.log(`\nBuild complete → ${path.relative(root, dist)}/`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
