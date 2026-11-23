'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const sharp = require('sharp');
const CORE = require('./core.cjs');
const { encodePNG, paintPaper } = require('./raster.cjs');
const { loadBaseImage } = require('./base-image.cjs');
const { loadPaintState, savePaintState } = require('./paint-state.cjs');
const { loadDryState, saveDryState } = require('./dry-state.cjs');

const MAGIC = Buffer.from('QLMIX001');
// Ordinary marks occupy the gaps between the two persistent pigment layers.
const flatKeys = ['flatBelow', 'flatBetween', 'flatAbove'];
const fields = ['base', 'wet', 'dry', 'wetView', 'dryView', ...flatKeys, 'order'];
const headerSize = MAGIC.length + fields.length * 4;
const stackOrders = [['wetView', 'dryView'], ['dryView', 'wetView']];

const oilBrush = brush => brush === 'oil' || brush === 'oilknife';
const dryBrush = brush => brush === 'pencil' || brush === 'charcoal';

function unpack(buffer) {
  if (buffer.length < headerSize || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Invalid mixed project state signature');
  }
  let offset = headerSize;
  const state = {};
  for (const [index, key] of fields.entries()) {
    const length = buffer.readUInt32LE(MAGIC.length + index * 4);
    if (length > buffer.length - offset) throw new Error('Invalid mixed project state length');
    if (length) state[key] = buffer.subarray(offset, offset + length);
    offset += length;
  }
  if (offset !== buffer.length || !state.base || !!state.wet !== !!state.wetView ||
      !!state.dry !== !!state.dryView) {
    throw new Error('Invalid mixed project state');
  }
  return state;
}

function pack(state) {
  const header = Buffer.alloc(headerSize);
  MAGIC.copy(header);
  const chunks = [header];
  for (const [index, key] of fields.entries()) {
    const bytes = state[key];
    if (!bytes) continue;
    header.writeUInt32LE(bytes.length, MAGIC.length + index * 4);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readLayer(png, width, height) {
  if (!png) return null;
  const { data, info } = await sharp(png, { limitInputPixels: width * height })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height || info.channels !== 4) {
    throw new Error('Mixed project layer dimensions do not match the canvas');
  }
  return data;
}

function paperToRgba(paper) {
  const rgba = new Uint8Array(paper.length / 3 * 4);
  for (let p = 0, q = 0; p < paper.length; p += 3, q += 4) {
    rgba[q] = paper[p];
    rgba[q + 1] = paper[p + 1];
    rgba[q + 2] = paper[p + 2];
    rgba[q + 3] = 255;
  }
  return rgba;
}

function encodeLayer(rgba, width, height) {
  return encodePNG(width, height, rgba, 4);
}

function validateCanvas(info) {
  for (const axis of ['width', 'height']) {
    if (!Number.isInteger(info[axis]) || info[axis] < 1 || info[axis] > CORE.MAX_CANVAS_SIDE) {
      throw new Error('Invalid mixed project canvas dimensions');
    }
  }
}

function readOrder(packed, pixels) {
  if (!packed) return new Uint8Array(pixels);
  const order = zlib.inflateSync(packed, { maxOutputLength: pixels });
  if (order.length !== pixels || order.some(value => value >= stackOrders.length)) {
    throw new Error('Invalid mixed project layer order');
  }
  return order;
}

function sourceOver(dst, src, p, sourceOffset = p) {
  const alpha = src[sourceOffset + 3] / 255;
  const retained = dst[p + 3] / 255 * (1 - alpha);
  const coverage = alpha + retained;
  if (!alpha) return;
  for (let channel = 0; channel < 3; channel++) {
    dst[p + channel] = Math.round((src[sourceOffset + channel] * alpha + dst[p + channel] * retained) / coverage);
  }
  dst[p + 3] = Math.round(coverage * 255);
}

function wetIsCovered(flat, dry, order, p) {
  return !!(flat[2]?.[p + 3] || (order[p / 4] === 0 && (dry?.[p + 3] || flat[1]?.[p + 3])));
}

function movePaint(order, layer, before, after, planes, dirty, coveredWet) {
  const wet = layer === 'wetView';
  const top = wet ? 1 : 0;
  const [below, between] = planes;
  let above = planes[2];
  const deposit = new Uint8Array(4);
  let movedFlat = false;
  for (let i = 0, p = 0; i < order.length; i++, p += 4) {
    const changed = before ? (after[p + 3] !== before[p + 3] || (after[p + 3] &&
      (after[p] !== before[p] || after[p + 1] !== before[p + 1] || after[p + 2] !== before[p + 2]))) : after[p + 3] !== 0;
    if (coveredWet && before[p + 3] && wetIsCovered(planes, coveredWet.dry, order, p)) {
      // Only newly deposited paint belongs above an overlying mark. Reuse the
      // mixed colour but leave the underlying paint film at its original depth.
      const alpha = Math.min(coveredWet.contact[p + 3], coveredWet.maxAlpha);
      if (alpha) {
        deposit.set(after.subarray(p, p + 3));
        deposit[3] = alpha;
        above ??= planes[2] = Buffer.alloc(after.length);
        sourceOver(above, deposit, p, 0);
        dirty[i] = 1;
        movedFlat = true;
      }
      continue;
    }
    if (!changed) continue;
    dirty[i] = 1;
    if (!after[p + 3]) continue;
    // Lifting dry pigment keeps the remaining pigment in its original place.
    if (!wet && after[p + 3] <= (before?.[p + 3] ?? 0)) continue;

    if (order[i] === top) {
      if (above?.[p + 3]) {
        sourceOver(between, above, p);
        above.fill(0, p, p + 4);
        movedFlat = true;
      }
    } else {
      if (between?.[p + 3] || above?.[p + 3]) {
        if (between[p + 3]) sourceOver(below, between, p);
        if (above) between.set(above.subarray(p, p + 4), p);
        else between.fill(0, p, p + 4);
        above?.fill(0, p, p + 4);
        movedFlat = true;
      }
      order[i] = top;
    }
  }
  return movedFlat;
}

function composite(base, views, order, flat, dirty, prior) {
  const rgba = new Uint8Array(prior ?? base);
  const [below, between, above] = flat;
  for (let i = 0, p = 0; i < order.length; i++, p += 4) {
    if (prior && !dirty[i]) continue;
    const [first, second] = stackOrders[order[i]];
    let a = base[p + 3] / 255;
    let r = base[p] * a, g = base[p + 1] * a, b = base[p + 2] * a;
    let changed = false;
    for (const layer of [below, views[first], between, views[second], above]) {
      if (!layer?.[p + 3]) continue;
      changed = true;
      const over = layer[p + 3] / 255, rest = 1 - over;
      r = layer[p] * over + r * rest;
      g = layer[p + 1] * over + g * rest;
      b = layer[p + 2] * over + b * rest;
      a = over + a * rest;
    }
    if (!changed && !prior) continue;
    rgba[p] = a ? Math.round(r / a) : base[p];
    rgba[p + 1] = a ? Math.round(g / a) : base[p + 1];
    rgba[p + 2] = a ? Math.round(b / a) : base[p + 2];
    rgba[p + 3] = Math.round(a * 255);
  }
  return rgba;
}

async function readLegacy(cwd, dir, mode, requested, render, priorPng) {
  const wet = mode === 'wet';
  const snapshot = wet ? await loadPaintState(cwd, requested) : loadDryState(cwd, requested);
  const m = snapshot.metadata;
  const { width, height, seed, surface } = m;
  const brush = wet ? m.brush : m.settings.brush;
  validateCanvas(m);
  const source = wet ? { paint_state: requested } : { dry_state: requested };
  const reference = priorPng ?? await fs.readFile((await render(source)).absolutePath);
  const substrate = wet ? snapshot.baseRGBA ?? paperToRgba(snapshot.paper) : snapshot.substrate;
  const base = encodeLayer(substrate, width, height);
  const empty = new Uint8Array(width * height * 4);
  const input = path.join(dir, wet ? 'legacy.qlpaint' : 'legacy.qldry');
  if (wet) {
    snapshot.paper = null;
    snapshot.baseRGBA = empty;
    await savePaintState(cwd, input, snapshot);
  } else {
    snapshot.substrate = empty;
    saveDryState(cwd, input, snapshot);
  }
  const state = { base, [mode]: await fs.readFile(input) };
  const result = await render(wet ? { paint_state: input } : { dry_state: input });
  state[wet ? 'wetView' : 'dryView'] = await fs.readFile(result.absolutePath);
  return { state, info: { width, height, surface, seed, brush }, priorBrush: brush, reference };
}

async function initialize(cwd, dir, args, previous, render) {
  if (previous?.mode === 'mixed') {
    validateCanvas(previous.info);
    return { state: unpack(previous.state), info: previous.info, priorBrush: previous.info.brush };
  }
  const mode = previous?.mode ?? (args.paint_state != null ? 'wet' : args.dry_state != null ? 'dry' : null);
  if (mode) {
    const requested = previous ? path.join(dir, 'previous.input') : args[mode === 'wet' ? 'paint_state' : 'dry_state'];
    if (previous) await fs.writeFile(requested, previous.state, { flag: 'wx' });
    return readLegacy(cwd, dir, mode, requested, render, previous?.png);
  }
  const imported = args.base_image == null ? null : await loadBaseImage(cwd, args.base_image, args);
  const width = imported?.width ?? args.width ?? args.size ?? 1200;
  const height = imported?.height ?? args.height ?? args.size ?? 1200;
  const surface = args.surface ?? 'warm', seed = args.seed ?? 241;
  validateCanvas({ width, height });
  if (!imported && (width < 320 || height < 320)) throw new Error('new canvas dimensions must be between 320 and ' + CORE.MAX_CANVAS_SIDE);
  if (!Object.hasOwn(CORE.SURFACES, surface)) throw new Error('Unknown drawing surface');
  if (!Number.isInteger(seed) || seed < 1 || seed > 9999) throw new Error('seed must be between 1 and 9999');
  const base = imported?.rgba ?? paperToRgba(paintPaper(width, height, seed ^ 0x1b873593, surface));
  return { state: { base: encodeLayer(base, width, height) }, info: { width, height, surface, seed }, imported };
}

async function drawMixed(cwd, dir, args, previous, execute, exec) {
  let renders = 0, marks = 0;
  async function render(settings, internal = {}) {
    const output = path.join(path.relative(cwd, dir), 'render-' + renders++ + '.png');
    return execute({ ...settings, output }, exec, { projectLayer: true, ...internal });
  }

  const { state, info, priorBrush, imported, reference } = await initialize(cwd, dir, args, previous, render);
  const originalViews = stackOrders[0].map(key => state[key]);
  const { width, height, surface, seed } = info;
  if (previous || args.paint_state != null || args.dry_state != null) {
    for (const key of ['width', 'height', 'surface', 'seed']) {
      if (args[key] != null && args[key] !== info[key]) throw new Error('project canvas fixes ' + key);
    }
    if (args.size != null && (args.size !== width || args.size !== height)) {
      throw new Error('existing project canvas dimensions cannot be resized');
    }
  }
  const dryRequested = args.operations != null || args.dry_media === true;
  const defaultBrush = args.project_material === 'wet' ? 'oil' :
    args.project_material === 'dry' ? 'pencil' : priorBrush ?? 'ink';
  const brush = args.brush ?? (dryRequested ? (dryBrush(priorBrush) ? priorBrush : 'pencil') : defaultBrush);
  if (!Object.hasOwn(CORE.BRUSHES, brush)) throw new Error('Unknown brush');
  if (args.operations != null && args.dry_media === false) throw new Error('dry_media:false conflicts with dry operations');
  if (args.operations != null && args.strokes != null) throw new Error('choose operations or strokes, not both');
  if (args.dry_media === true && !dryBrush(brush) && args.operations == null) {
    throw new Error('dry_media uses pencil or charcoal strokes. Select either brush or use ordered operations.');
  }

  const defaultDry = dryBrush(brush) && args.dry_media !== false;
  const useDry = dryRequested || defaultDry;
  const style = {};
  for (const key of ['grain', 'pressure', 'wobble', 'weight', 'accent', 'title']) {
    if (args[key] !== undefined) style[key] = args[key];
  }
  const canvas = { width, height, seed, surface };
  const views = {};
  const transparentPath = path.join(dir, 'transparent.png');
  const order = readOrder(state.order, width * height);
  const dirty = new Uint8Array(width * height);
  async function transparent() {
    try {
      await fs.access(transparentPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.writeFile(transparentPath, encodeLayer(new Uint8Array(width * height * 4), width, height), { flag: 'wx' });
    }
    return transparentPath;
  }

  let flatPlanes;
  let changedFlat = false;
  async function planes() {
    return flatPlanes ??= await Promise.all(flatKeys.map(key => readLayer(state[key], width, height)));
  }

  async function updateLayer(key, output, captureContact) {
    const before = views[key] ?? await readLayer(state[key], width, height);
    const png = await fs.readFile(output);
    const after = await readLayer(png, width, height);
    const flat = await planes();
    const other = captureContact && before ? views.dryView ?? await readLayer(state.dryView, width, height) : null;
    let coveredWet;
    if (captureContact && before && (flat[1] || flat[2] || other)) {
      for (let p = 0; p < before.length; p += 4) {
        if (before[p + 3] && wetIsCovered(flat, other, order, p)) {
          coveredWet = { dry: other, ...await captureContact() };
          break;
        }
      }
    }
    if (!coveredWet && (before?.equals(after) || (!before && !after.some((value, i) => i % 4 === 3 && value !== 0)))) {
      if (!state[key]) state[key] = png;
      return;
    }
    if (flat[1] || flat[2] || coveredWet) {
      flat[0] ??= Buffer.alloc(width * height * 4);
      flat[1] ??= Buffer.alloc(width * height * 4);
    }
    changedFlat = movePaint(order, key, before, after, flat, dirty, coveredWet) || changedFlat;
    state[key] = png;
    views[key] = after;
  }

  async function flat(patches) {
    const result = await render({
      ...canvas, ...style, brush: oilBrush(brush) ? 'ink' : brush,
      base_image: await transparent(), ...patches
    });
    marks += result.marks;
    const png = await fs.readFile(result.absolutePath);
    const after = await readLayer(png, width, height);
    if (!after.some((value, i) => i % 4 === 3 && value !== 0)) return;
    const flat = await planes();
    const atop = flat[2] ??= Buffer.alloc(after.length);
    for (let p = 0; p < after.length; p += 4) {
      if (after[p + 3]) {
        dirty[p / 4] = 1;
        sourceOver(atop, after, p);
      }
    }
    changedFlat = true;
  }

  async function material(mode, patches) {
    const wet = mode === 'wet';
    const ext = wet ? '.qlpaint' : '.qldry';
    const input = path.join(dir, 'layer-' + renders + ext), output = path.join(dir, 'state-' + renders + ext);
    if (state[mode]) await fs.writeFile(input, state[mode], { flag: 'wx' });
    let oilSettings;
    const result = await render({
      ...canvas, ...style, ...patches,
      ...(state[mode] ? { [wet ? 'paint_state' : 'dry_state']: input } : { base_image: await transparent() }),
      [wet ? 'save_state' : 'save_dry_state']: output
    }, wet ? { observeOilSettings: settings => { oilSettings = settings; } } : undefined);
    state[mode] = await fs.readFile(output);
    marks += result.marks;
    const captureContact = wet && patches.strokes?.length ? async () => {
      const { itemOffset, ...settings } = oilSettings;
      const impression = await render({ ...canvas, ...style, ...patches, ...settings, base_image: await transparent() }, { itemOffset });
      const png = await fs.readFile(impression.absolutePath);
      return {
        contact: await readLayer(png, width, height),
        maxAlpha: Math.round(255 * patches.strokes.reduce((opacity, stroke) => Math.max(opacity, stroke.opacity ?? 0.95), 0))
      };
    } : null;
    await updateLayer(wet ? 'wetView' : 'dryView', result.absolutePath, captureContact);
  }

  if (args.subject && oilBrush(brush)) {
    await material('wet', { brush, subject: args.subject, wetness: args.wetness, impasto: args.impasto, load: args.load });
  } else if (args.subject) {
    await flat({ subject: args.subject });
  }
  if (args.fills?.length) await flat({ fills: args.fills });
  if (useDry && (args.operations?.length || args.strokes?.length)) {
    const actualBrush = dryBrush(brush) ? brush : 'pencil';
    await material('dry', { dry_media: true, brush: actualBrush, operations: args.operations, strokes: args.strokes });
  } else if (oilBrush(brush) && args.strokes?.length) {
    await material('wet', { brush, strokes: args.strokes, wetness: args.wetness, impasto: args.impasto, load: args.load });
  } else if (args.strokes?.length) {
    await flat({ strokes: args.strokes });
  }
  if (args.dots?.length) await flat({ dots: args.dots });

  const flatViews = await planes();
  if (changedFlat) {
    for (const [i, key] of flatKeys.entries()) {
      const plane = flatViews[i];
      state[key] = plane?.some((value, p) => p % 4 === 3 && value !== 0) ? encodeLayer(plane, width, height) : undefined;
    }
  }
  if (order.some(value => value !== 0)) state.order = zlib.deflateSync(order);
  else delete state.order;
  let png = previous?.png ?? reference;
  if (!png || changedFlat || stackOrders[0].some((key, i) => state[key] !== originalViews[i])) {
    const [base] = await Promise.all([
      readLayer(state.base, width, height),
      ...stackOrders[0].map(async key => { views[key] ??= await readLayer(state[key], width, height); })
    ]);
    const prior = await readLayer(png, width, height);
    png = encodeLayer(composite(base, views, order, flatViews, dirty, prior), width, height);
  }
  const title = args.title?.trim() || previous?.info.title || 'Quiet Line painting';
  return {
    state: pack(state), png, info: { width, height, surface, seed, brush, title: title.slice(0, 1000) },
    marks, subject: args.subject ?? 'custom', imported, dryMedia: useDry
  };
}

async function exportMaterial(cwd, dir, state, info, mode) {
  if (!state[mode]) throw new Error('The selected step has no ' + mode + ' material to export');
  const wet = mode === 'wet';
  const ext = wet ? '.qlpaint' : '.qldry';
  const input = path.join(dir, 'export-in' + ext), output = path.join(dir, 'export-out' + ext);
  await fs.writeFile(input, state[mode], { flag: 'wx' });
  const base = new Uint8Array(await readLayer(state.base, info.width, info.height));
  if (wet) {
    const snapshot = await loadPaintState(cwd, input);
    snapshot.baseRGBA = base;
    await savePaintState(cwd, output, snapshot);
  } else {
    const snapshot = loadDryState(cwd, input);
    snapshot.substrate = base;
    saveDryState(cwd, output, snapshot);
  }
  return fs.readFile(output);
}

module.exports = { drawMixed, exportMaterial, pack, unpack };
