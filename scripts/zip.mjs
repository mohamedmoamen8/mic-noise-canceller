#!/usr/bin/env node
// scripts/zip.mjs
import { readdir, stat, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const outZip = path.join(root, 'mic-noise-canceller.zip');

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

async function createZip(filePaths, baseDir) {
  const entries = [];

  for (const file of filePaths) {
    const data = await readFile(file);
    const name = path.relative(baseDir, file).replace(/\\/g, '/');
    entries.push({ name, data });
  }

  const parts = [];
  let centralDirSize = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8');
    const header = Buffer.alloc(30 + nameBytes.length);
    let offset = 0;
    header.writeUInt32LE(0x04034b50, offset); offset += 4;
    header.writeUInt16LE(20, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt32LE(0, offset); offset += 4;
    header.writeUInt32LE(entry.data.length, offset); offset += 4;
    header.writeUInt32LE(entry.data.length, offset); offset += 4;
    header.writeUInt16LE(nameBytes.length, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    nameBytes.copy(header, offset);
    parts.push(header, entry.data);
    centralDirSize += 46 + nameBytes.length;
  }

  const centralDir = Buffer.alloc(centralDirSize);
  let cdOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8');
    const header = Buffer.alloc(46 + nameBytes.length);
    let offset = 0;
    header.writeUInt32LE(0x02014b50, offset); offset += 4;
    header.writeUInt16LE(20, offset); offset += 2;
    header.writeUInt16LE(20, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt32LE(0, offset); offset += 4;
    header.writeUInt32LE(entry.data.length, offset); offset += 4;
    header.writeUInt32LE(entry.data.length, offset); offset += 4;
    header.writeUInt16LE(nameBytes.length, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt16LE(0, offset); offset += 2;
    header.writeUInt32LE(0, offset); offset += 4;
    header.writeUInt32LE(0, offset); offset += 4;
    nameBytes.copy(header, offset);
    header.copy(centralDir, cdOffset);
    cdOffset += header.length;
  }

  const centralDirOffset = Buffer.byteLength(Buffer.concat(parts));
  const eocd = Buffer.alloc(22);
  let eocdOffset = 0;
  eocd.writeUInt32LE(0x06054b50, eocdOffset); eocdOffset += 4;
  eocd.writeUInt16LE(0, eocdOffset); eocdOffset += 2;
  eocd.writeUInt16LE(0, eocdOffset); eocdOffset += 2;
  eocd.writeUInt16LE(entries.length, eocdOffset); eocdOffset += 2;
  eocd.writeUInt16LE(entries.length, eocdOffset); eocdOffset += 2;
  eocd.writeUInt32LE(centralDirSize, eocdOffset); eocdOffset += 4;
  eocd.writeUInt32LE(centralDirOffset, eocdOffset); eocdOffset += 4;
  eocd.writeUInt16LE(0, eocdOffset); eocdOffset += 2;

  return Buffer.concat([...parts, centralDir, eocd]);
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

const zipBuffer = await createZip(entries, dist);
await writeFile(outZip, zipBuffer);
console.log(`\nPackaged → ${path.relative(root, outZip)}`);
