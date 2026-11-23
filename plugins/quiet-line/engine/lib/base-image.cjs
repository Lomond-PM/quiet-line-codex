'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { MAX_CANVAS_SIDE } = require('./core.cjs');

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 32 * 1000 * 1000;

function dimension(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CANVAS_SIDE) {
    throw new Error(`${label} must be an integer between 1 and ${MAX_CANVAS_SIDE} when base_image is used`);
  }
  return n;
}

/** Decode a local, static bitmap. Existing paint is a dry, flattened layer. */
async function loadBaseImage(cwd, requested, args = {}) {
  if (typeof requested !== 'string' || !requested.trim()) throw new Error('base_image must be a non-empty local image path');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requested)) throw new Error('base_image must be a local file, not a URL');
  const sourcePath = path.resolve(cwd, requested.trim());
  const handle = await fs.open(sourcePath, 'r');
  let data;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('base_image must be a regular image file');
    if (stat.size > MAX_BYTES) throw new Error('base_image exceeds the 32 MiB input limit');
    data = await handle.readFile();
    if (data.length > MAX_BYTES) throw new Error('base_image exceeds the 32 MiB input limit');
  } finally { await handle.close(); }
  const decode = { limitInputPixels: MAX_PIXELS, failOn: 'error' };
  let meta;
  try { meta = await sharp(data, decode).metadata(); }
  catch (error) { throw new Error(`Cannot decode base_image: ${error.message}`); }
  if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error('base_image supports static PNG, JPEG and WebP images');
  if ((meta.pages || 1) !== 1) throw new Error('Animated or multipage base_image is not supported; provide a static image');
  const rotated = meta.orientation >= 5 && meta.orientation <= 8;
  const sourceWidth = rotated ? meta.height : meta.width;
  const sourceHeight = rotated ? meta.width : meta.height;
  if (!(sourceWidth > 0 && sourceHeight > 0) || sourceWidth * sourceHeight > MAX_PIXELS) throw new Error('base_image exceeds the 32 megapixel input limit');

  let width, height;
  if (args.size != null) {
    width = args.width == null ? dimension(args.size, 'size') : dimension(args.width, 'width');
    height = args.height == null ? dimension(args.size, 'size') : dimension(args.height, 'height');
  } else if (args.width != null && args.height != null) {
    width = dimension(args.width, 'width'); height = dimension(args.height, 'height');
  } else if (args.width != null) {
    width = dimension(args.width, 'width'); height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  } else if (args.height != null) {
    height = dimension(args.height, 'height'); width = Math.max(1, Math.round(height * sourceWidth / sourceHeight));
  } else {
    const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(sourceWidth, sourceHeight));
    width = Math.max(1, Math.round(sourceWidth * scale)); height = Math.max(1, Math.round(sourceHeight * scale));
  }
  dimension(width, 'width'); dimension(height, 'height');
  // auto-orient before resizing, respecting camera EXIF orientation.
  const decoded = await sharp(data, decode).rotate().resize(width, height, { fit: 'fill' })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height || decoded.info.channels !== 4) throw new Error('Unexpected decoded base_image layout');
  // sharp returns a Node Buffer (a Uint8Array subclass). Normalize at the
  // decoder boundary so rendering and strict wet-state snapshots share the
  // same owned, exact Uint8Array representation without changing any pixels.
  const rgba = new Uint8Array(decoded.data);
  return { path: sourcePath, sourceWidth, sourceHeight, width, height, rgba,
    resized: sourceWidth !== width || sourceHeight !== height };
}

async function checkOutputDirectory(root, directory) {
  let existing = directory;
  for (;;) {
    try {
      const relative = path.relative(root, await fs.realpath(existing));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('output directory resolves outside the session working directory');
      }
      return;
    } catch (error) {
      const parent = path.dirname(existing);
      if (error.code !== 'ENOENT' || existing === parent) throw error;
      existing = parent;
    }
  }
}

/** Use exclusive creation for fresh drawings and continuations alike. */
async function writeDrawing(cwd, target, png, { explicitOutput = false } = {}) {
  const directory = path.dirname(target);
  const root = await fs.realpath(cwd);
  await checkOutputDirectory(root, directory);
  await fs.mkdir(directory, { recursive: true });
  await checkOutputDirectory(root, directory);
  const ext = path.extname(target), stem = target.slice(0, -ext.length);
  for (let n = 1; n <= 1000; n++) {
    const next = n === 1 ? target : `${stem}-${n}${ext}`;
    try { await fs.writeFile(next, png, { flag: 'wx' }); return next; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (explicitOutput) throw new Error('output already exists; choose a new PNG path. Quiet Line never overwrites the original or another image');
    }
  }
  throw new Error('Cannot allocate a new drawing filename; choose an explicit new output path');
}

module.exports = { loadBaseImage, writeDrawing };
