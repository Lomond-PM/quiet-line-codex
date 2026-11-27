import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { apply } from '../index.js';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const CORE = require('../lib/core.cjs');
const RASTER = require('../lib/raster.cjs');
const sharp = require('sharp');
const rgbaPixels = png => sharp(png).ensureAlpha().raw().toBuffer();
const { loadBaseImage } = require('../lib/base-image.cjs');
const { loadPaintState } = require('../lib/paint-state.cjs');
let tool;
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-line-integration-'));
apply({ tools: {register(t){if(t.name==='quiet_line_draw')tool=t;}}, workingDirectory: {ensure: async()=>cwd}, get(){return undefined;} });
const run = args=>tool.execute(args, {agent:{id:'test'}});
function unfilteredPNGSize(samples, width, height, channels) {
 const stride = width * channels;
 const raw = Buffer.alloc((stride + 1) * height);
 for (let y = 0; y < height; y++) {
  raw.set(samples.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
 }
 // Signature, IHDR, IDAT framing, and IEND occupy 57 bytes in the 1.6.0 PNG.
 return 57 + deflateSync(raw, {level:9}).length;
}
// Exercise edge predictors, nonzero byte offsets, and an alpha-zero pixel
// whose RGB must survive. Compare native samples through an independent decoder.
for (const [width, height] of [[1, 1], [1, 9], [11, 1], [173, 97]]) {
 for (const channels of [3, 4]) for (const opaque of channels === 4 ? [false, true] : [true]) {
  const storage = new Uint8Array(width * height * channels + 16).fill(91);
  const samples = storage.subarray(7, 7 + width * height * channels);
  const expected = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
   const i = y * width + x;
   const rgba = [(23 + 7*x + y) & 255, (89 + y*11) & 255, (53 + x*y) & 255,
    opaque ? 255 : [0, 1, 127, 255][i % 4]];
   samples.set(rgba.slice(0, channels), i * channels);
   expected.set(rgba, i * 4);
  }
  const before = storage.slice();
  const encode = () => RASTER.encodePNG(width, height, samples, channels);
  const png = encode();
  const baseline = unfilteredPNGSize(samples, width, height, channels);
  assert.ok(png.length <= baseline, 'encoding never exceeds the no-filter baseline');
  if (width > 1 && height > 1) assert.ok(png.length < baseline, 'the patterned canvas compresses smaller');
  assert.deepEqual(encode(), png, 'identical inputs yield identical PNG bytes');
  const {data, info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width, info.height, info.channels], [width, height, 4]);
  assert.deepEqual(data, expected, 'every RGBA sample, including transparent RGB, round-trips');
  assert.deepEqual(storage, before, 'encoding preserves the input and its surrounding storage');
 }
}
for (const sparse of [false, true]) {
 const width = 127, height = 83, samples = new Uint8Array(width * height * 4);
 let seed = 307;
 for (let i = 0; i < samples.length; i++) {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  if (!sparse || Math.floor(i / 4) % 313 === 0) samples[i] = seed >>> 24;
 }
 const png = RASTER.encodePNG(width, height, samples, 4);
 assert.ok(png.length <= unfilteredPNGSize(samples, width, height, 4), 'sparse and noisy canvases never grow');
 assert.deepEqual(RASTER.encodePNG(width, height, samples, 4), png);
 assert.deepEqual(await rgbaPixels(png), Buffer.from(samples));
}
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
  assert.deepEqual(await rgbaPixels(RASTER.renderPNG(CORE.buildSketch(sketch,style,r),r).png),
   await rgbaPixels(OLD_RASTER.renderPNG(OLD_CORE.buildSketch(sketch,style,r),r).png), `legacy ${brush} pixels`);
 }
 console.log('legacy: all 8 brushes pixel-identical to baseline');
}
// SHA-256 of decoded RGBA samples from the installed 1.6.0 engine. Each
// source PNG was first verified against its preexisting frozen PNG hash.
const legacyPixelHashes = {
 ink:['5b1885e723f281ed718a2b40e27f17106a24a8d3fe2a7b233024f94807008100','077b84ccb674370c1eaa4782fa766606f2c558432484c977dbde9df72cd6642c'],
 fountain:['458b8878989e1ff953a3f660a862fc2f552ce41c105a97fd4daa0f764417f1e7','4b8d16694cdab96c856995cae58c42d120ba1ab47f0fd3e8f7cc462195a467ac'],
 pencil:['d24325d751bcdea08172582606e3ae03c0ae6931d1dbfa41da1799210c657297','6e1bc615c84f8ff4f52e134b9123c276acf4fb0ef017ad0db6c148b875dc476c'],
 charcoal:['681e6c92261049f14fecce36b5863f93cc6eb82495e4aa752545d0e3a6800d5d','c9cf933f928c6460954b6bd2f2d126c195ba4ee3f4fee3d2a8211cbe30c591a0'],
 brush:['70124e0b559551e1f9cae48026cbc0cc2fdde9ed8e6ccc160e90d3bcebc5a7d2','6864adbbf7e1de2904458f03a018971794a71aeda9b6672daea5be9e6d73b5cb'],
 marker:['555b4297612d591e8a340e5b05de55179f460b73e9e55842163b4009ebae2976','a6bb2c87f7ea5c69b174dbc2b2ecdd91bfe76b7711e8f00eb570ca11aa957b09'],
 oil:['7c10d9155c476112b817d92a37c5e9e7d4775c7898816830deda653b4d252b41','9c942f441343b613ce91510153f7dd6b0f36da0fa8be16ee72a9ea5e0ef34c65'],
 oilknife:['6259d1f089d4f179b3e8bf7eb1f719953fbbb08ed14055af38ce3e8bd7dc8616','e434827f579f956e857a85835afcdea988cfe2dc85d8a5c691ce70596d617d32']
};
for(const [brush, hashes] of Object.entries(legacyPixelHashes)) for(const controlled of [false,true]) {
 const style={brush,seed:623,weight:4.5,wobble:0,pressure:0,texture:.46,padding:0};
 const item={type:'stroke',points:[[.1,.5],[.9,.5]],width:3,...(controlled?{controls:[{width:3},{width:3}],tip:'flat',angle:30}:{})};
 const png=RASTER.renderPNG(CORE.buildItems([item],style,320),{width:320,height:320,seed:623}).png;
 assert.equal(createHash('sha256').update(await rgbaPixels(png)).digest('hex'), hashes[Number(controlled)], `${brush} controlled=${controlled}: frozen pixels`);
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
console.log('width: PASS — .1..30 schema/runtime, controls 0..3, all brushes broaden, 16 frozen RGBA hashes, broad split equality');
console.log('integration: PASS',cwd);
