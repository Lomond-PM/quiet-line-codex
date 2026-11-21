/* ============================================================
   Oil-paint cost invariance check.

   The simulation keeps finished strokes as pixels plus a per-pixel
   paint film that the next stroke can pick up. Adding a stroke
   samples and writes only the brush's footprint. This benchmark
   applies the same short brush stroke 240 times and reports median
   cost early and late in the run; the per-stroke number should stay
   flat.

   node examples/oil-benchmark.cjs
   ============================================================ */
'use strict';

const CORE = require('../lib/core.cjs');
const RASTER = require('../lib/raster.cjs');

const W = 1200;
const H = 800;
const SS = 2;
const N = 240;
const palette = ['#b95035', '#47647e', '#c59d57', '#4f6c5d', '#f3ead7', '#8f3d43'];

const sketch = {
  items: [
    CORE.stroke([
      [0.40, 0.48], [0.44, 0.43], [0.48, 0.45], [0.52, 0.39], [0.56, 0.41]
    ], { width: 3.2, color: '#b95035', opacity: 0.95 })
  ]
};
const built = CORE.buildSketch(sketch, {
  seed: 271, weight: 3.0, wobble: 0.5, pressure: 0.6, texture: 0.4,
  padding: 0.02, brush: 'oil', surface: 'linen'
}, { width: W, height: H });
const base = built.primitives.find(p => p.kind === 'stroke' && p.brush === 'oil');
if (!base) throw new Error('oil primitive not found');

const ink = new Uint8Array(W * SS * H * SS * 4);
const state = RASTER.createOilState(W * SS, H * SS, SS);

function shifted(primitive, dx, dy, color) {
  return {
    centers: primitive.centers.map(p => [p[0] + dx, p[1] + dy]),
    widthsL: primitive.widthsL.slice(),
    widthsR: primitive.widthsR.slice(),
    outline: primitive.outline.map(p => [p[0] + dx, p[1] + dy]),
    color: color.slice(),
    alpha: primitive.alpha,
    group: primitive.group,
    brush: primitive.brush
  };
}

const timings = [];
const rng = (() => {
  let s = 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
})();

for (let i = 0; i < N; i++) {
  const dx = (rng() - 0.5) * W * 0.66;
  const dy = (rng() - 0.5) * H * 0.62;
  const primitive = shifted(base, dx, dy, CORE.hexToRgb(palette[i % palette.length]));
  const t0 = process.hrtime.bigint();
  RASTER.paintOilStroke(ink, W * SS, H * SS, SS, primitive, {
    wetness: 0.6, impasto: 0.65, load: 0.72, knife: false, seed: i + 1
  }, state);
  const t1 = process.hrtime.bigint();
  timings.push(Number(t1 - t0) / 1e6);
}

function median(values) {
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

const early = median(timings.slice(10, 50));
const middle = median(timings.slice(100, 140));
const late = median(timings.slice(200, N));
console.log(JSON.stringify({
  strokes: N,
  canvas: [W, H],
  brush: 'oil',
  medianMs: { early: +early.toFixed(2), after100: +middle.toFixed(2), after200: +late.toFixed(2) },
  ratioLateToEarly: +(late / early).toFixed(2),
  note: 'Same brush and footprint; the only difference is how many finished strokes are already in the buffer.'
}, null, 2));
