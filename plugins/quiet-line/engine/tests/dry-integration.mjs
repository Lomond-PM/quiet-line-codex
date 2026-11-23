import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {apply} from '../index.js';
const require=createRequire(import.meta.url), sharp=require('sharp');
const {loadDryState}=require('../lib/dry-state.cjs');
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-line-dry-tool-'));
let tool;
apply({tools:{register(t){if(t.name==='quiet_line_draw')tool=t;}},workingDirectory:{ensure:async()=>cwd},get(){}});
const run=args=>tool.execute(args,{agent:{id:'dry-test'}});
const read=r=>fs.readFileSync(r.absolutePath);
const a={tool:'charcoal',points:[[.2,.48],[.8,.5]],width:8,pressure:.6,tilt:.7,grade:'6B'};
const b={tool:'smudge',points:[[.3,.49],[.7,.55]],width:10,pressure:.6};
const c={tool:'kneaded',points:[[.3,.45],[.6,.45]],width:5,pressure:.8};
const opts={size:320,seed:623,grain:36,surface:'kraft',weight:4,wobble:20,pressure:40};
assert.match(tool.description,/dry_media with ordered operations/);
assert.ok(tool.parameters.properties.operations);
const first=await run({...opts,operations:[a],save_dry_state:'first.qldry',output:'first.png'});
assert.equal(first.dryMedia,true); assert.equal(first.paintState,undefined);
const second=await run({dry_state:first.dryState,operations:[b,c],save_dry_state:'second.qldry',output:'second.png'});
const whole=await run({...opts,operations:[a,b,c],output:'whole.png'});
assert.deepEqual(read(second),read(whole),'registered tool split equals ordered single call');
const empty=await run({dry_state:second.dryState,output:'empty.png'});
assert.deepEqual(read(empty),read(second));
const snapshot=loadDryState(cwd,second.dryState);
assert.equal(snapshot.metadata.itemOffset,3);
assert.equal(snapshot.metadata.settings.weight,4);
assert.match(tool.output.render({},second)[0].text,/dry_state/);
assert.doesNotMatch(tool.output.render({},second)[0].text,/save_state while drawing/);
// Shorthand has identical operation defaults and never opts in old strokes implicitly.
const {tool:_,...stroke}=a;
const shorthand=await run({...opts,dry_media:true,brush:'charcoal',strokes:[stroke],output:'short.png'});
assert.deepEqual(read(shorthand),read(first));
const legacy=await run({...opts,brush:'pencil',strokes:[{points:a.points,width:2}],output:'legacy.png'});
assert.equal(legacy.dryMedia,undefined);
// Style defaults can evolve while substrate and grain remain fixed.
const changed=await run({dry_state:first.dryState,weight:3,brush:'charcoal',operations:[c],save_dry_state:'changed.qldry',output:'changed.png'});
assert.equal(loadDryState(cwd,changed.dryState).metadata.settings.weight,3);
const bads=[
 {dry_media:'yes'}, {dry_media:true,brush:'oil'}, {operations:[a],dry_media:false},
 {operations:[a],paint_state:first.dryState}, {dry_state:first.dryState,save_state:'bad.qlpaint'},
 {dry_state:first.dryState,base_image:first.absolutePath}, {dry_state:first.dryState,width:321},
 {dry_state:first.dryState,grain:50}, {dry_state:first.dryState,seed:9}, {dry_state:first.dryState,surface:'warm'},
 {operations:[a],strokes:[]}, {operations:[a],fills:[]}, {operations:[a],subject:'cat'}, {operations:[a],dots:[]},
 {operations:[a],wetness:40}, {operations:[{...a,pressure:2}]}, {operations:[{...a,grade:'9H'}]},
 {operations:[{...a,controls:[{}]}]}, {operations:[{...a,controls:[{hardness:1},{}]}]},
 {operations:[{...a,hardness:1}]}, {operations:[{...a,points:[[0,0,1],[1,1]]}]},
 {operations:Array(601).fill(a)}, {operations:[a],save_dry_state:'../escape.qldry'},
 {operations:[a],save_dry_state:'bad.qlpaint'}, {dry_state:first.dryState,operations:[a],save_dry_state:'first.qldry'}
];
for(const args of bads) await assert.rejects(()=>run({...args,output:`bad-${bads.indexOf(args)}.png`}));
// Real decoding, non-square transparent substrate, mixed operations and saved state.
const pixels=Buffer.alloc(96*64*4);
for(let i=0;i<96*64;i++)pixels.set([90+i%35,140,80,i%3===0?0:i%3===1?128:255],i*4);
for(const format of ['png','webp','jpeg']) {
 const source=path.join(cwd,`source.${format}`),enc=sharp(pixels,{raw:{width:96,height:64,channels:4}});
 await (format==='webp'?enc.webp({lossless:true}):enc[format]()).toFile(source);
 const original=fs.readFileSync(source);
 const boot=await run({base_image:source,operations:[],save_dry_state:`${format}-base.qldry`,output:`${format}-base.png`});
 const expected=await sharp(source).ensureAlpha().raw().toBuffer();
 assert.deepEqual(await sharp(boot.absolutePath).ensureAlpha().raw().toBuffer(),expected);
 const state=loadDryState(cwd,boot.dryState);
 assert.equal(state.substrate.constructor,Uint8Array);
 assert.deepEqual(Buffer.from(state.substrate),expected);
 const marked=await run({dry_state:boot.dryState,operations:[a],save_dry_state:`${format}-marked.qldry`,output:`${format}-marked.png`});
 const smudged=await run({dry_state:marked.dryState,operations:[b,c],output:`${format}-continued.png`});
 const single=await run({base_image:source,operations:[a,b,c],output:`${format}-single.png`});
 assert.deepEqual(read(smudged),read(single));
 const noMaterial=await run({dry_state:boot.dryState,operations:[b,c,{...c,tool:'eraser'}],output:`${format}-untouched.png`});
 assert.deepEqual(read(noMaterial),read(boot),'eraser/smudge cannot alter flattened source');
 assert.deepEqual(fs.readFileSync(source),original);
}
// Public schema and runtime agree for dry operations and strokes shorthand.
const opSchema=tool.parameters.properties.operations.items.properties;
assert.equal(opSchema.width.minimum,.1); assert.equal(opSchema.width.maximum,30);
assert.match(opSchema.width.description,/NOT pixels/);
assert.match(opSchema.controls.items.properties.width.description,/Local multiplier/);
for(const width of [.1,30]) {
 const op={...a,width,controls:[{width:3},{width:3}]};
 const operation=await run({...opts,operations:[op],output:`width-operation-${width}.png`});
 const {tool:_,...stroke}=op;
 const shorthand=await run({...opts,dry_media:true,brush:'charcoal',strokes:[stroke],output:`width-shorthand-${width}.png`});
 assert.deepEqual(read(operation),read(shorthand),'dry shorthand preserves max/min width and local controls');
}
for(const width of [0,.099,30.001,Infinity,NaN]) {
 for(const mode of ['operations','strokes']) {
  const args=mode==='operations'?{operations:[{...a,width}]}:{dry_media:true,brush:'charcoal',strokes:[{points:a.points,width}]};
  await assert.rejects(()=>run({...opts,...args}),/width must be between 0.1 and 30; width is a multiplier.*not pixels/);
 }
}
await assert.rejects(()=>run({...opts,operations:[{...a,controls:[{width:30},{}]}]}),/controls\[0\].width must be between 0 and 3; controls.width is a local multiplier, not pixels/);
console.log('dry width: PASS — .1..30 bounds, local controls, schema guidance, shorthand equality and actionable errors');
console.log('dry integration: PASS',cwd);
