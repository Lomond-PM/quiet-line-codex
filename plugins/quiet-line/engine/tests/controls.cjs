'use strict';
// Standalone: node tests/controls.cjs (no GUI or plugin runtime required).
const assert = require('node:assert/strict');
const CORE = require('../lib/core.cjs');
const OIL = require('../lib/oil.cjs');
const options = { brush: 'oil', seed: 31, weight: 16, pressure: 0, wobble: 0, texture: 0, padding: 0 };
const item = { type: 'stroke', points: [[0.2, 0.5], [0.8, 0.5]], registration: 0, overshoot: 0, width: 1, opacity: 0.9 };
function build(extra = {}, brush = 'oil') {
  return CORE.buildItems([{ ...item, ...extra }], { ...options, brush }, 180);
}
function primitive(extra) { return build(extra).primitives[0]; }
function paint(extra = {}, opts = {}) {
  const built = build({ cap: 'flat', ...extra });
  const state = OIL.createOilState(180, 180, 1, { seed: 31 });
  OIL.paintOilStroke(new Uint8Array(180 * 180 * 4), 180, 180, 1, built.primitives[0], { seed: 31, load: 1, ...opts }, state);
  return state;
}
function sum(a) { return a.reduce((x, y) => x + y, 0); }
function bounds(state) {
  let x0 = 180, y0 = 180, x1 = -1, y1 = -1;
  for (let y = 0; y < 180; y++) for (let x = 0; x < 180; x++) if (state.cov[y * 180 + x]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function region(state, xa, xb) {
  let result = 0;
  for (let y = 0; y < 180; y++) for (let x = xa; x < xb; x++) result += state.cov[y * 180 + x];
  return result;
}
// Validate object-array contract, ranges, and missing-field defaults.
for (const controls of [[], [1, 2], [null, {}], [{ pressure: 1.1 }, {}], [{ width: -1 }, {}], [{ angle: 361 }, {}], [{ opacity: NaN }, {}], [{ tilt: 2 }, {}]]) {
  assert.throws(() => build({ controls }));
}
for (const extra of [{ hardness: -0.1 }, { flow: 2 }, { aspect: 0 }, { tip: 'square' }, { cap: 'butt' }]) assert.throws(() => build(extra));
const defaults = primitive({ controls: [{}, {}] });
assert.deepEqual(defaults.controls[0], { pressure: 1, width: 1, opacity: 1, angle: 0, tilt: 0 });
assert.equal(primitive({}).controls, undefined, 'legacy branch stays opt-in');
assert.deepEqual(build().primitives, build().primitives, 'legacy output remains deterministic');
// Uneven input segment lengths: a control at x=.25 must not move to the
// midpoint just because it is control number 1 of 3.
const uneven = primitive({ points: [[0.2, 0.5], [0.25, 0.5], [0.8, 0.5]], controls: [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], cap: 'flat' });
let peak = 0;
for (let i = 1; i < uneven.controls.length; i++) if (uneven.controls[i].opacity > uneven.controls[peak].opacity) peak = i;
assert.ok(Math.abs(uneven.centers[peak][0] - 45) < 2, 'controls follow geometric arc length');
const angles = primitive({ controls: [{ angle: 170 }, { angle: -170 }] }).controls;
assert.ok(Math.abs(Math.abs(angles[Math.floor(angles.length / 2)].angle) - 180) < 1, 'angle crosses 180, not 0');
for (const field of ['pressure', 'width', 'opacity']) {
  assert.equal(sum(paint({ controls: [{ [field]: 0 }, { [field]: 0 }] }).cov), 0, `${field}=0 leaves no oil`);
}
assert.equal(sum(paint({ flow: 0 }).cov), 0, 'flow zero has no deposition');
assert.ok(sum(paint({ flow: 0.2 }).cov) < sum(paint({ flow: 1 }).cov), 'flow controls pigment deposit');
assert.ok(sum(paint({ hardness: 0 }).cov) < sum(paint({ hardness: 1 }).cov), 'soft edge deposits less');
const opacity = paint({ controls: [{ opacity: 0 }, { opacity: 1 }] });
assert.ok(region(opacity, 110, 135) > region(opacity, 45, 70) * 1.4, 'spatial opacity survives oil resampling');
const pressure = paint({ controls: [{ pressure: 0.05 }, { pressure: 1 }] });
assert.ok(region(pressure, 110, 135) > region(pressure, 45, 70) * 1.4, 'spatial pressure changes width and deposit');
const width = paint({ controls: [{ width: 0.05 }, { width: 2 }] });
assert.ok(region(width, 110, 135) > region(width, 45, 70) * 1.4, 'spatial width is not averaged away');
function regionHeight(state, xa, xb) {
  let low = 180, high = -1;
  for (let y = 0; y < 180; y++) for (let x = xa; x < xb; x++) if (state.cov[y * 180 + x]) {
    low = Math.min(low, y); high = Math.max(high, y);
  }
  return high - low + 1;
}
const turningNib = paint({ tip: 'flat', aspect: 0.1, controls: [{ angle: 0 }, { angle: 90 }] });
assert.ok(regionHeight(turningNib, 120, 130) > regionHeight(turningNib, 45, 55) * 1.3, 'per-point angle changes local footprint after oil densification');
// A short gesture exposes nib dimensions rather than hiding them in the sweep.
const short = { points: [[0.49, 0.5], [0.51, 0.5]], tip: 'flat', aspect: 0.12, hardness: 1, cap: 'round' };
const horizontal = bounds(paint({ ...short, angle: 0 }));
const vertical = bounds(paint({ ...short, angle: 90 }));
assert.ok(horizontal.w > horizontal.h * 1.5, 'flat nib major axis is horizontal at angle 0');
assert.ok(vertical.h > horizontal.h * 1.5, 'rotation changes actual footprint');
const tilted = bounds(paint({ ...short, angle: 0, tilt: 1 }));
assert.ok(tilted.h > horizontal.h, 'tilt increases flat contact depth');
const flat = bounds(paint({ cap: 'flat' }));
const round = bounds(paint({ cap: 'round' }));
assert.ok(round.w > flat.w, 'round caps extend beyond butt planes');
const taper = primitive({ cap: 'taper' });
assert.equal(taper.widthsL[0], 0, 'taper starts at zero width');
assert.equal(taper.widthsL.at(-1), 0, 'taper ends at zero width');
// Non-oil alpha is spatial, not a single average over the stroke.
const ink = build({ controls: [{ opacity: 0 }, { opacity: 1 }], cap: 'flat' }, 'ink').primitives;
assert.ok(ink.length > 50);
assert.ok(ink.at(-1).alpha > ink[0].alpha * 10);
assert.equal(sum(build({ controls: [{ width: 0 }, { width: 0 }] }, 'ink').primitives.flatMap(p => p.widthsL)), 0);
// Controlled oil rounds sharp corners without averaging away control stops.
const sharp = { points: [[0.2, 0.75], [0.5, 0.25], [0.8, 0.75]], cap: 'flat',
  controls: [{ pressure: 1, opacity: 1 }, { pressure: 0, opacity: 0 }, { pressure: 1, opacity: 1 }] };
const rounded = primitive(sharp);
let maxTurn = 0;
for (let i = 2; i < rounded.centers.length - 2; i++) {
  const [a, b, c] = rounded.centers.slice(i - 1, i + 2);
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (len > 0.01) maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / len))));
}
assert.ok(maxTurn < 0.35, `sharp angle is rounded locally, max per-sample turn=${maxTurn}`);
const narrow = CORE.buildItems([{ ...item, ...sharp }], { ...options, weight: 1 }, 180).primitives[0];
assert.deepEqual(rounded.controls, narrow.controls, 'geometry smoothing never averages attribute anchors');
const zeroPlateau = primitive({ points: [[0.2, 0.5], [0.4, 0.5], [0.6, 0.5], [0.8, 0.5]],
  controls: [{ pressure: 1 }, { pressure: 0 }, { pressure: 0 }, { pressure: 1 }] });
assert.ok(zeroPlateau.controls.some(c => c.pressure === 0));
for (let i = 0; i < zeroPlateau.controls.length; i++) if (zeroPlateau.controls[i].pressure === 0) {
  assert.equal(zeroPlateau.widthsL[i], 0, 'smoothing does not spread width across zero-pressure plateau');
}
const defaultOver = CORE.buildItems([{ ...item, overshoot: undefined, controls: [{}, {}] }], options, 180).primitives[0];
const zeroOver = primitive({ controls: [{}, {}], overshoot: 0 });
assert.deepEqual(defaultOver.centers, zeroOver.centers, 'controlled default overshoot is zero');
assert.ok(Math.hypot(...rounded.centers[0].map((x, i) => x - [36, 135][i])) < 0.2, 'rounded path retains first endpoint');
assert.ok(Math.hypot(...rounded.centers.at(-1).map((x, i) => x - [144, 135][i])) < 0.2, 'rounded path retains last endpoint');
// itemOffset guarantees the same seeds/group across resumed build calls.
const items = [item, { ...item, color: 'accent' }];
const single = CORE.buildItems(items, options, 180).primitives;
const first = CORE.buildItems([items[0]], options, 180).primitives;
const second = CORE.buildItems([items[1]], { ...options, itemOffset: 1 }, 180).primitives;
assert.deepEqual([...first, ...second], single);
// Newly accepted widths must reach geometry (not silently clamp to 3),
// and only that new range may use cheaper contact-relative oil sampling.
assert.equal(primitive({ width: 3 }).broadStroke, undefined);
assert.equal(primitive({ width: 30 }).broadStroke, true);
assert.ok(Math.max(...primitive({ width: 30 }).widthsL) > Math.max(...primitive({ width: 3 }).widthsL) * 9);
for (const brush of ['oil', 'oilknife']) {
  const draw = width => {
    const built = CORE.buildItems([{ ...item, width, cap: 'flat', controls: [{ width: 3 }, { width: 3 }] }],
      { ...options, brush, weight: 4.5 }, 180);
    const state = OIL.createOilState(180, 180, 1, { seed: 31 });
    const result = OIL.paintOilStroke(new Uint8Array(180 * 180 * 4), 180, 180, 1, built.primitives[0], { seed: 31, knife: brush === 'oilknife' }, state);
    return { state, result };
  };
  const narrow = draw(3), wide = draw(30);
  assert.ok(bounds(wide.state).h > bounds(narrow.state).h * 3, `${brush}: wide contact paints a larger area`);
  assert.ok(wide.result.segments < narrow.result.segments / 3, `${brush}: broad contact bounds redundant stamping`);
  assert.ok(wide.result.deposits > 0);
}
console.log('controls: object contract, interpolation, spatial controls, caps, itemOffset, and broad-width geometry/sampling passed');
