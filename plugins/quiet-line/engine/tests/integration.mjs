import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { apply } from '../index.js';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const CORE = require('../lib/core.cjs');
const RASTER = require('../lib/raster.cjs');
const sharp = require('sharp');
const { loadBaseImage } = require('../lib/base-image.cjs');
const { loadPaintState } = require('../lib/paint-state.cjs');
let tool;
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-line-integration-'));
apply({ tools: {register(t){if(t.name==='quiet_line_draw')tool=t;}}, workingDirectory: {ensure: async()=>cwd}, get(){return undefined;} });
const run = args=>tool.execute(args, {agent:{id:'test'}});
const a = {points:[[.15,.45],[.5,.46],[.85,.4]],color:'#ae3829',width:3,tip:'flat',angle:10,flow:.8,controls:[{pressure:0},{pressure:1},{pressure:0}]};
const b = {points:[[.5,.15],[.48,.5],[.52,.85]],color:'#23578a',width:3,tip:'flat',angle:75,hardness:.35};
const opts = {brush:'oil',surface:'linen',seed:623,size:320,grain:35,weight:4,wobble:0,pressure:0};
const first = await run({...opts,strokes:[a],output:'first.png',save_state:'first.qlpaint'});
assert.ok(first.paintState && fs.existsSync(first.paintState));
const second = await run({paint_state:first.paintState,weight:4,wobble:0,pressure:0,strokes:[b],output:'second.png',save_state:'second.qlpaint'});
const single = await run({...opts,strokes:[a,b],output:'single.png'});
assert.deepEqual(fs.readFileSync(second.absolutePath),fs.readFileSync(single.absolutePath),'tool split calls must match one call');
const empty = await run({paint_state:second.paintState,output:'empty.png'});
assert.deepEqual(fs.readFileSync(empty.absolutePath),fs.readFileSync(second.absolutePath),'empty resume must not repaint');
for (const args of [
 {paint_state:first.paintState,brush:'ink'},
 {paint_state:first.paintState,width:321},
 {paint_state:first.paintState,base_image:'first.png'},
 {...opts,strokes:[{...a,controls:[{}]}]},
 {...opts,strokes:[{...a,controls:[{}, {pressure:2}, {}]}]},
 {...opts,strokes:[{...a,hardness:-1}]},
 {brush:'ink',strokes:[a],save_state:'bad.qlpaint'}
]) await assert.rejects(()=>run(args));
await assert.rejects(()=>run({...opts,strokes:[a],output:'occupied.png',save_state:'first.qlpaint'}),/EEXIST/);
// Real decoder -> tool -> snapshot -> resume coverage. Synthetic Uint8Array
// bases alone missed sharp's Buffer subclass in the original 1.1.0 tests.
const pixels = Buffer.alloc(96 * 64 * 4);
for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
 const i = (y * 96 + x) * 4;
 pixels.set([x * 2, y * 3, 160, x < 24 ? 0 : x < 48 ? 128 : 255], i);
}
for (const format of ['png', 'jpeg', 'webp']) {
 const source = path.join(cwd, `base.${format}`);
 const encoder = sharp(pixels, {raw:{width:96,height:64,channels:4}});
 await (format === 'webp' ? encoder.webp({lossless:true}) : encoder[format]()).toFile(source);
 const original = fs.readFileSync(source);
 for (const brush of ['oil', 'oilknife']) {
  const prefix = `${format}-${brush}`;
  const { size, ...style } = opts;
  // Also cover aspect-preserving resize and inherited non-square dimensions.
  const dimensions = brush === 'oilknife' ? {width:72} : {};
  const baseArgs = {...style,...dimensions,brush,base_image:source};
  const bootstrap = await run({...baseArgs,output:`${prefix}-bootstrap.png`,save_state:`${prefix}-bootstrap.qlpaint`});
  const decoded = await loadBaseImage(cwd, source, dimensions);
  assert.equal(decoded.rgba.constructor, Uint8Array, 'decoder returns canonical owned RGBA, not a Buffer');
  assert.equal(Buffer.isBuffer(decoded.rgba),false);
  assert.equal(decoded.rgba.length,decoded.width * decoded.height * 4);
  const expected = await sharp(original).rotate().resize(decoded.width,decoded.height,{fit:'fill'})
   .toColourspace('srgb').ensureAlpha().raw().toBuffer();
  assert.deepEqual(Buffer.from(decoded.rgba),expected,'RGBA normalization preserves decoded bytes');
  const state = loadPaintState(cwd,bootstrap.paintState);
  assert.equal(state.baseRGBA.constructor,Uint8Array);
  assert.equal(state.paper,null,'base-backed state must not add a paper layer');
  assert.deepEqual(state.baseRGBA,decoded.rgba,'saved base retains RGBA bytes, including alpha');
  assert.equal(state.metadata.width,decoded.width);
  assert.equal(state.metadata.height,decoded.height);
  const plain = await run({...baseArgs,output:`${prefix}-plain.png`});
  assert.deepEqual(fs.readFileSync(bootstrap.absolutePath),fs.readFileSync(plain.absolutePath),'capture does not alter dry overpainting output');
  const bootstrapPixels = await sharp(bootstrap.absolutePath).ensureAlpha().raw().toBuffer();
  assert.deepEqual(bootstrapPixels,expected,'empty bootstrap preserves pixels and transparency');
  const marked = await run({...baseArgs,strokes:[a],output:`${prefix}-marked.png`,save_state:`${prefix}-marked.qlpaint`});
  const resumed = await run({paint_state:marked.paintState,strokes:[b],output:`${prefix}-resumed.png`,save_state:`${prefix}-resumed.qlpaint`});
  const whole = await run({...baseArgs,strokes:[a,b],output:`${prefix}-whole.png`});
  assert.deepEqual(fs.readFileSync(resumed.absolutePath),fs.readFileSync(whole.absolutePath),`${prefix}: real-image split wet painting matches single call`);
  const emptyBase = await run({paint_state:resumed.paintState,output:`${prefix}-empty.png`});
  assert.deepEqual(fs.readFileSync(emptyBase.absolutePath),fs.readFileSync(resumed.absolutePath),'empty real-image resume is stable');
  assert.deepEqual(fs.readFileSync(source),original,'source image is never modified');
 }
}
console.log('base-image state: PASS — real PNG/JPEG/WebP, oil/oilknife, empty bootstrap, resize, RGBA and split equality');
// Legacy rendering against the actual previously installed 1.0.19, when available.
const previous = process.env.QUIET_LINE_BASELINE;
if(previous){
 const OLD_CORE = require(path.join(previous,'lib/core.cjs'));
 const OLD_RASTER = require(path.join(previous,'lib/raster.cjs'));
 for(const brush of Object.keys(CORE.BRUSHES)){
  const style={seed:623,brush,surface:'linen',weight:3,wobble:.58,pressure:.66,texture:.46,padding:.02};
  const sketch={items:[CORE.stroke([[.1,.2],[.35,.6],[.8,.3]],{width:2,color:'#a04030'})]};
  const r={width:320,height:320,seed:623,surface:'linen'};
  assert.deepEqual(RASTER.renderPNG(CORE.buildSketch(sketch,style,r),r).png,OLD_RASTER.renderPNG(OLD_CORE.buildSketch(sketch,style,r),r).png,`legacy ${brush}`);
 }
 console.log('legacy: all 8 brushes byte-identical to baseline');
}
// Frozen before widening the public width range: upper old bound, all eight
// brushes, with and without controls. Guards deterministic PNG bytes, not just geometry.
const legacyHashes = {
 ink:['ec0db895b748be49752e1651c0777d2c6a15301ac5951274a605a872d760a8e5','ffa13fbc9e11f0b5a7ac9168567f49890902f23231ee3b5c736e873aa03ce081'],
 fountain:['74a479d3af469e7eafb205f7292d44fcd5102e5104964e3fd48bd44f852ea3c7','f4bf39e5378dcb969088ce52eefa8dde2ed4c6dd5a6a39a135faa18c5a9de84b'],
 pencil:['fdd0b40e86a1b6cd4ff5c29772a9b9a4e320f860573d578426ada279dee8af46','86f729b71c6975ce83e76355cc8b6f29b4160546c453c9ac0d66774cfbb4073b'],
 charcoal:['32826926b2db0ec5743fb3ce1a4a0fd46dab085aaa48e8f25f2210b175240fe4','1cca7e23eabe5c9a505b01bec0b1a84202c6b7218c0e184a9d3d8eaae77ef0ac'],
 brush:['c97a6c5ea7869b072bd708da2f80b647ab2dbd32b8c8096948180aa9c542b747','3f145816f9bc54ad02dd55a5498e725f97087669c1ee6739b9012edbae76ee11'],
 marker:['4935edb2cf55a67e9a6006adbc9dcf209a0702f7a117b907ab3b8ab1b055cc1f','af1c1c322d653e3dcda6714eb0ff4e423929c837fecbc2a68e2aa4403ee5b462'],
 oil:['6bd4d484ab365d58402cb7dab1de37df78445714bd1c71ec16c775dcdf58d982','bdc0d6f8ec109b0183d4d4945fe862bfd61edef2c1afe8bb8f12ad7aa1124217'],
 oilknife:['2b7f1d383e66ceb5697a620f43e8b91dcab883d3452cfbf5ce5fbea95a27326d','701821f91976d33500faa31c931644d5f38a2f401ad9ad305a693548e83fa712']
};
for(const [brush, hashes] of Object.entries(legacyHashes)) for(const controlled of [false,true]) {
 const style={brush,seed:623,weight:4.5,wobble:0,pressure:0,texture:.46,padding:0};
 const item={type:'stroke',points:[[.1,.5],[.9,.5]],width:3,...(controlled?{controls:[{width:3},{width:3}],tip:'flat',angle:30}:{})};
 const png=RASTER.renderPNG(CORE.buildItems([item],style,320),{width:320,height:320,seed:623}).png;
 assert.equal(createHash('sha256').update(png).digest('hex'),hashes[Number(controlled)],`${brush} controlled=${controlled}: old bytes unchanged`);
}
const strokeSchema=tool.parameters.properties.strokes.items.properties;
assert.equal(strokeSchema.width.minimum,.1); assert.equal(strokeSchema.width.maximum,30);
assert.match(strokeSchema.width.description,/NOT pixels/);
assert.equal(strokeSchema.controls.items.properties.width.maximum,3);
assert.match(strokeSchema.controls.items.properties.width.description,/Local multiplier/);
for(const width of [.1,3,3.001,30]) {
 const drawn=await run({...opts,brush:'ink',strokes:[{points:[[.1,.5],[.9,.5]],width}],output:`width-${width}.png`});
 assert.ok(drawn.bytes>0);
}
for(const brush of Object.keys(CORE.BRUSHES)) {
 const stroke={points:[[.1,.5],[.9,.5]],width:30};
 const wide=await run({...opts,brush,strokes:[stroke],output:`wide-${brush}.png`});
 const narrow=await run({...opts,brush,strokes:[{...stroke,width:3}],output:`narrow-${brush}.png`});
 assert.notDeepEqual(fs.readFileSync(wide.absolutePath),fs.readFileSync(narrow.absolutePath),`${brush}: width30 is not silently clamped`);
}
for(const width of [0,.099,30.001,Infinity,NaN]) await assert.rejects(()=>run({...opts,strokes:[{points:a.points,width}]}),/width must be between 0.1 and 30; width is a multiplier.*not pixels/);
await assert.rejects(()=>run({...opts,strokes:[{points:[[0,0],[1,1]],controls:[{width:30},{}]}]}),/controls\[0\].width must be between 0 and 3; controls.width is a local multiplier, not pixels/);
// New broad sampling retains split-call state equivalence too.
const broadA={...a,width:30}, broadB={...b,width:20};
const broadFirst=await run({...opts,strokes:[broadA],save_state:'broad.qlpaint',output:'broad-first.png'});
const broadResume=await run({paint_state:broadFirst.paintState,strokes:[broadB],output:'broad-resume.png'});
const broadSingle=await run({...opts,strokes:[broadA,broadB],output:'broad-single.png'});
assert.deepEqual(fs.readFileSync(broadResume.absolutePath),fs.readFileSync(broadSingle.absolutePath));
console.log('width: PASS — .1..30 schema/runtime, controls 0..3, all brushes broaden, 16 frozen PNG hashes, broad split equality');
console.log('integration: PASS',cwd);
