#!/usr/bin/env node
// scripts/zip.mjs
// Usage:
//   node scripts/zip.mjs                                        → dist/ → mic-noise-canceller.zip
//   node scripts/zip.mjs dist-firefox mic-noise-canceller-firefox.zip
import { readdir, stat, readFile, rm } from 'node:fs/promises';
import { zipSync } from 'fflate';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const [, , distArg, outArg] = process.argv;
const dist = path.resolve(root, distArg ?? 'dist');
const outZip = path.resolve(root, outArg ?? 'mic-noise-canceller.zip');

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function getAllFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return getAllFiles(full);
      }
      return full;
    })
  );
  return results.flat();
}

if (!(await exists(dist))) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

try {
  await rm(outZip, { force: true });
} catch {
  // ignore
}

const files = await getAllFiles(dist);
const entries = files.filter((f) => !f.endsWith('.map'));

const zipData = {};
for (const file of entries) {
  const data = await readFile(file);
  const name = path.relative(dist, file).replace(/\\/g, '/');
  zipData[name] = new Uint8Array(data);
}

const zipped = zipSync(zipData);
await rm(outZip, { force: true });
const { writeFile } = await import('node:fs/promises');
await writeFile(outZip, Buffer.from(zipped));
console.log(`\nPackaged → ${path.relative(root, outZip)}`);
