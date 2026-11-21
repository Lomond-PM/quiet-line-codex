'use strict';
// Standalone geometry/footprint checks; no file writes, profile or artwork use.
// comparisonPNG() returns a labeled PNG Buffer for an integrator to inspect.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const CORE = require('../lib/core.cjs');
const OIL = require('../lib/oil.cjs');
const options = { brush: 'oil', seed: 31, weight: 4.5, pressure: 0, wobble: 0, texture: 0, padding: 0 };
const stroke = { type: 'stroke', points: [[.3, .5], [.7, .5]], color: '#e7cfa3', registration: 0, overshoot: 0, width: 8, opacity: .9 };
function primitive(extra = {}, brush = 'oil') {
  return CORE.buildItems([{ ...stroke, ...extra }], { ...options, brush }, 180).primitives[0];
}
function paint(extra = {}) {
  const p = primitive({ cap: 'round', ...extra });
  const state = OIL.createOilState(180, 180, 1, { seed: 31 });
  OIL.paintOilStroke(new Uint8Array(180 * 180 * 4), 180, 180, 1, p,
    { seed: 31, wetness: 0, load: 1, impasto: .65 }, state);
  return state;
}
const sum = a => a.reduce((s, v) => s + v, 0);
const digest = a => createHash('sha256').update(JSON.stringify(a)).digest('hex');
function runTests() {
  // Any one advanced parameter opts into controlled oil. Preserve the
  // existing hard shoulder unless the caller explicitly requests softer paint.
  const activators = [
    { controls: [{}, {}] }, { flow: 1 }, { tip: 'round' }, { tip: 'flat' },
    { aspect: .3 }, { angle: 15 }, { tilt: .1 }, { cap: 'round' },
    { cap: 'flat' }, { cap: 'taper' }
  ];
  for (const extra of activators) {
    assert.equal(primitive(extra).hardness, 1, `${JSON.stringify(extra)}: preserve existing implicit oil shoulder`);
    for (const hardness of [0, .35, .65, 1]) {
      assert.equal(primitive({ ...extra, hardness }).hardness, hardness, 'explicit hardness must win, including endpoints');
    }
  }
  assert.equal(primitive().controls, undefined, 'legacy oil remains opt-in and untouched');
  assert.equal(primitive({ flow: 1 }, 'oilknife').hardness, 1, 'knife keeps its deliberately hard default');

  // Changing the shoulder must not silently redefine cap or taper geometry.
  const round = primitive({ cap: 'round' }), flat = primitive({ cap: 'flat' });
  const taper = primitive({ cap: 'taper' }), implicit = primitive({ flow: 1 });
  assert.equal(round.cap, 'round'); assert.equal(flat.cap, 'flat'); assert.equal(taper.cap, 'taper');
  assert.deepEqual(round.widthsL, flat.widthsL, 'explicit round/flat retain full-width end-cap contract');
  assert.equal(taper.widthsL[0], 0); assert.equal(taper.widthsL.at(-1), 0);
  assert.ok(Math.abs(implicit.widthsL[0] / flat.widthsL[0] - .62) < 1e-12, 'do not invent a new taper default');
  assert.ok(Math.abs(implicit.widthsL.at(-1) / flat.widthsL.at(-1) - .58) < 1e-12);
  const lift = primitive({ controls: [{ pressure: 0 }, { pressure: 1 }] });
  assert.equal(lift.widthsL[0], 0, 'a zero-pressure endpoint still lifts');
  assert.equal(sum(paint({ controls: [{ pressure: 0 }, { pressure: 0 }] }).cov), 0);

  // Fingerprints captured from the unmodified v1.4.0 core. Lock old paths and
  // all non-oil media, rather than merely comparing the new renderer to itself.
  const baseline = {
    ink: ['338101fa2594d6a9f26e7923d1f2b0e6c948633f2b53dccd6df2305c334166a9', '8614c942ea419fde80e0d61496de69f5484fad18a4215e7105aedef369985156'],
    fountain: ['04b769973c81beeb8310db769c4f37bd74ba8cca5feb0b39e5cca30635ef76ae', 'b1d66a9b3130f79e11369e538c04667aed840460ac0e2fb4b6d47e9c3853073c'],
    pencil: ['01912c23ce1dcd2ee5be565632799004d3216e96eaf89551c8491303cd23ed9f', 'b1688262ca5256238b4a364db1b8beca2acd3df39f7ac2e95b9807c212c79e68'],
    charcoal: ['ec6b2408de51a301aa21b987d4ace7c74f816be586d0231accb6cd05d48ca66d', '90f720d3c87e0745155b819762a94ee9362080a81120ebe0a9257035fd2ebb34'],
    brush: ['a93033b514f932f16e4fe901321bf5566e4223503ed859ea6a64eea88b855022', '5093ef39266b302c3df6e53282990d65ac09a6eabe441f70ee778cd6b9d8a67a'],
    marker: ['d2a8d9f1368ddf488c41db53ec78605cc18eba66a058345a338440366b5c9e90', '4f9a378dc9795bc293537a1391647f982c0cf039eeb9d27335d10afa56cb3b60'],
    oil: ['b7f84e30d1ff9710f21207d2c9816c3a9e3f946094c6539ccd05dbf338eae646', '4d15bd6dd0c052d351be0f895122edc41886b0ac0ab09fcab846f5f3d5445e99'],
    oilknife: ['aa6dcc84d78bfe209832e6257bc69449737bd8496ebffb5d6d6a7461b1949baf', 'd68645a44519264604fcb629b8603fd7665a7f093c3d0ebde6052044502158d3']
  };
  const fixtureOptions = { seed: 31, weight: 4.5, pressure: .4, wobble: .3, texture: .4, padding: .02 };
  const points = [[.18, .5], [.4, .35], [.55, .7], [.82, .5]];
  const fixture = extra => [.5, 3, 30].map(width => ({ type: 'stroke', points, color: '#985c3d', width, opacity: .9, ...extra }));
  for (const [brush, [legacy, controlled]] of Object.entries(baseline)) {
    assert.equal(digest(CORE.buildItems(fixture({}), { ...fixtureOptions, brush }, 320).primitives), legacy, `${brush}: legacy fingerprint unchanged`);
    const extra = { flow: 1, cap: 'flat' };
    assert.equal(digest(CORE.buildItems(fixture(extra), { ...fixtureOptions, brush }, 320).primitives), controlled,
      `${brush}: controlled default fingerprint unchanged`);
  }
  const explicit = ['round', 'flat', 'taper'].flatMap(cap => [0, .45, 1].flatMap(hardness => fixture({ cap, hardness })));
  assert.equal(digest(CORE.buildItems(explicit, { ...fixtureOptions, brush: 'oil' }, 320).primitives),
    '8d0c65b9119af889b71753bca338387b383db290f0cf4303d9aa2b4193d554d0', 'all explicit oil cap/hardness geometry remains byte-identical');

  const existingDefault = paint(), explicitSoft = paint({ hardness: .65 });
  const hard = paint({ hardness: 1 }), soft = paint({ hardness: 0 });
  assert.deepEqual(existingDefault.cov, hard.cov, 'the established default hard shoulder must remain unchanged');
  assert.deepEqual(existingDefault.hgt, hard.hgt);
  assert.ok(sum(soft.cov) < sum(explicitSoft.cov) && sum(explicitSoft.cov) < sum(hard.cov), 'explicit .65 shoulder lies between feather-soft and full hard disc');
  const metrics = {
    coverageSum: { hardness0: sum(soft.cov), explicit065: sum(explicitSoft.cov), default1: sum(hard.cov) },
    heightSum: { explicit065: sum(explicitSoft.hgt), default1: sum(hard.hgt) }
  };
  console.log('oil-shape-regression: existing defaults, explicit softer shoulders, cap semantics, pressure lift, 8 legacy and 8 controlled brush fingerprints passed');
  console.log(JSON.stringify(metrics));
  return metrics;
}

async function comparisonPNG() {
  const sharp = require('sharp');
  const { renderPNG } = require('../lib/raster.cjs');
  const examples = [
    ['Short round stroke', { points: [[.4, .5], [.6, .5]], width: 7, cap: 'round' }],
    ['Flat brush dab', { points: [[.37, .5], [.63, .5]], width: 9, cap: 'flat', tip: 'flat', angle: 90, aspect: .4 }],
    ['Default ends, flow only', { points: [[.28, .5], [.72, .5]], width: 6, flow: 1 }],
    ['Controlled curved highlight', { points: [[.28, .55], [.48, .43], [.72, .5]], width: 3,
      controls: [{ pressure: .15 }, { pressure: 1 }, { pressure: .05 }], cap: 'taper' }]
  ];
  const tiles = [];
  for (let row = 0; row < examples.length; row++) {
    const [title, extra] = examples[row];
    for (let col = 0; col < 2; col++) {
      const item = { ...stroke, ...extra, ...(col === 1 ? { hardness: .65 } : {}) };
      const built = CORE.buildItems([item], { ...options, surface: 'charcoal' }, 320);
      const png = renderPNG(built, { width: 320, height: 320, seed: 31, surface: 'charcoal', grain: 0,
        wetness: 0, load: 1, impasto: .65 }).png;
      const crop = await sharp(png).extract({ left: 10, top: 111, width: 300, height: 98 }).png().toBuffer();
      const label = Buffer.from(`<svg width="320" height="152"><rect width="100%" height="100%" fill="#f5f1e7"/><text x="10" y="18" font-family="Arial" font-size="12">${title}</text><text x="10" y="36" font-family="Arial" font-size="12">${col ? 'Option: explicit hardness=.65' : 'Unchanged default: hardness=1'}</text></svg>`);
      tiles.push({ input: await sharp(label).composite([{ input: crop, left: 10, top: 44 }]).png().toBuffer(), left: col * 320, top: row * 152 });
    }
  }
  return sharp({ create: { width: 640, height: examples.length * 152, channels: 3, background: '#f5f1e7' } }).composite(tiles).png().toBuffer();
}
module.exports = { runTests, comparisonPNG };
if (require.main === module) runTests();
