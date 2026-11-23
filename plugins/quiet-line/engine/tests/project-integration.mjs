import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {apply} from '../index.js';
const require=createRequire(import.meta.url);
const {readProject}=require('../lib/project-store.cjs');
const {loadPaintState}=require('../lib/paint-state.cjs');
const {loadDryState}=require('../lib/dry-state.cjs');
const sharp=require('sharp');
const pixels=async r=>sharp(png(r)).ensureAlpha().raw().toBuffer();
async function assertMatchingPixels(actual, expected, message, tolerance = 0) {
  const [a, b] = await Promise.all([pixels(actual), pixels(expected)]);
  assert.equal(a.length, b.length, message);
  assert.ok(a.every((value, index) => Math.abs(value - b[index]) <= tolerance), message);
}
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-line-project-tool-'));
const tools=new Map();
let attachments;
const context={tools:{register(t){tools.set(t.name,t);}},workingDirectory:{ensure:async()=>cwd},get(key){return key === 'attachments' ? attachments : undefined;}};
apply(context);
assert.equal(tools.size,2);
const draw=tools.get('quiet_line_draw'), manager=tools.get('quiet_line_project');
const exec={agent:{id:'project-integration'}};
const run=args=>draw.execute(args,exec), manage=args=>manager.execute(args,exec);
const png=r=>fs.readFileSync(r.absolutePath);
const meta=p=>readProject(cwd,p);
const clean=()=>assert.equal(fs.readdirSync(cwd).some(n=>n.startsWith('.quiet-line-project-')),false,'owned temporary bridge directories must be removed');
const stroke={points:[[.2,.5],[.8,.52]],width:2,color:'#a04a25'};
// DSH requires a lossless JSON payload before it can render an attachment.
attachments = {
  imageLimits: { maxImageBytes: 2 ** 24, maxImageDimension: 2560 },
  saveImage({ data, mediaType, name }) {
    return {
      attachmentId: 'project-preview', mediaType, name, bytes: data.length,
      width: data.readUInt32BE(16), height: data.readUInt32BE(20)
    };
  }
};
const attached = await run({
  project: 'preview.qlproject', size: 320, brush: 'brush', strokes: [stroke], output: 'preview.png'
});
assert.ok(!Object.hasOwn(attached, 'note'), 'successful project previews must omit absent notes');
assert.deepEqual(JSON.parse(JSON.stringify(attached)), attached);
assert.equal(attached.image.attachmentId, 'project-preview');
assert.equal(draw.output.render({}, attached)[1].type, 'image');
attachments.imageLimits.maxImageBytes = 1;
const withoutPreview = await run({ project: 'preview.qlproject', output: 'preview-over-limit.png' });
assert.deepEqual(JSON.parse(JSON.stringify(withoutPreview)), withoutPreview);
assert.ok(!Object.hasOwn(withoutPreview, 'image'));
assert.match(withoutPreview.note, /attachment limit/);
assert.equal((await meta('preview.qlproject')).head, withoutPreview.projectStep);
attachments = undefined;

const wetOpts={brush:'oil',size:320,seed:217,grain:20,strokes:[stroke]};
const wet=await run({...wetOpts,project:'wet.qlproject',project_checkpoint:'start',output:'wet-first.png'});
assert.equal(wet.projectMode,'mixed'); assert.equal(wet.projectStep,1); assert.equal(wet.projectRevision,1);
for(const k of ['paintState','resumedState','dryState','resumedDryState']) assert.equal(wet[k],undefined);
assert.match(draw.output.render({},wet)[0].text,/Continue with project/);
assert.doesNotMatch(draw.output.render({},wet)[0].text,/request save_state|request save_dry_state/);
let wm=await meta('wet.qlproject');
assert.equal(wm.steps[0].label,'start'); assert.equal(wm.steps[0].pinned,true);
assert.equal(wm.historyLimit,30); assert.equal(wm.maxBytes,2048*1024*1024);
assert.equal(wm.selected,undefined);
const wetSecond=await run({project:'wet.qlproject',strokes:[{...stroke,color:'#2679a0'}],output:'wet-second.png'});
assert.equal(wetSecond.projectStep,2); assert.equal(wetSecond.projectRevision,2);
const saved=await readProject(cwd,'wet.qlproject',{includeData:true});
assert.deepEqual(saved.selected.png,png(wetSecond));
assert.equal(saved.selected.info.width,320);
assert.match(saved.selected.info.brush,/oil/);
const list=await manage({action:'list',project:'wet.qlproject'});
assert.equal(list.steps.length,2); assert.equal(list.selected,undefined);
assert.match(manager.output.render({},list)[0].text,/Step 1.*checkpoint: start/);
// Explicit recovery also performs a full integrity check without changing history.
const recovered=await manage({action:'recover',project:'wet.qlproject'});
assert.deepEqual(recovered,list);
assert.equal((await meta('wet.qlproject')).revision,list.revision);
await assert.rejects(()=>manage({action:'recover',project:'wet.qlproject',step:1}),/step/);
await assert.rejects(()=>manage({action:'recover',project:'wet.qlproject',history_limit:1}),/only for prune/);
clean();
const exported=await manage({action:'export',project:'wet.qlproject',step:1,target:'wet-export.qlpaint'});
const importedBytes=fs.readFileSync(exported.target);
assert.equal(loadPaintState(cwd,exported.target).metadata.width,320);
const pngExport=await manage({action:'export',project:'wet.qlproject',step:1,target:'wet-export.png'});
assert.deepEqual(fs.readFileSync(pngExport.target),png(wet));
await assert.rejects(()=>manage({action:'export',project:'wet.qlproject',target:'wet-export.png'}),/EEXIST/);
await assert.rejects(()=>manage({action:'export',project:'wet.qlproject',target:'../escape.png'}),/inside/);
await assert.rejects(()=>manage({action:'export',project:'wet.qlproject',target:'wrong.qldry'}),/\.qldry|dry.*material/i);
await assert.rejects(()=>manage({action:'export',project:'wet.qlproject',target:path.join(os.tmpdir(),'escape.png')}),/inside/);
// Restoring retains future steps; the next drawing forks from the restored head.
const restored=await manage({action:'restore',project:'wet.qlproject',step:1});
assert.equal(restored.head,1); assert.equal(restored.steps.length,2);
const afterRestore=await run({project:'wet.qlproject',strokes:[stroke],output:'restored-next.png'});
wm=await meta('wet.qlproject');
assert.equal(wm.steps.find(s=>s.id===afterRestore.projectStep).parentId,1);
assert.ok(wm.steps.some(s=>s.id===2));
const branch=await manage({action:'branch',project:'wet.qlproject',step:1,target:'branch.qlproject'});
assert.equal(branch.head,1); assert.equal(branch.steps.length,1);
assert.equal((await meta('wet.qlproject')).revision,wm.revision,'branch must not mutate source');
await run({project:'branch.qlproject',strokes:[stroke],output:'branch-next.png'});
assert.equal((await meta('branch.qlproject')).steps.length,2);
// Import legacy snapshots without modifying them, including a mark-free import.
const imported=await run({project:'imported.qlproject',paint_state:exported.target,output:'imported.png'});
await assertMatchingPixels(imported, wet, 'Oil snapshot reimport should preserve visible pixels up to compositor rounding', 1);
assert.deepEqual(fs.readFileSync(exported.target),importedBytes);
// Every failure leaves exactly the same source revision and removes bridge files.
const fails=[
 {project:'wet.qlproject',base_image:wet.absolutePath},
 {project:'wet.qlproject',paint_state:exported.target},
 {project:'wet.qlproject',dry_state:'none.qldry'},
 {project:'wet.qlproject',save_state:'loose.qlpaint'},
 {project:'wet.qlproject',save_dry_state:'loose.qldry'},
 {project:'wet.qlproject',strokes:[{points:[[0,0]]}]},
 {project:'wet.qlproject',width:321},
 {project:'wet.qlproject',project_history_limit:0},
 {project:'wet.qlproject',project_max_mb:63},
 {project:'wet.qlproject',project_checkpoint:''},
 {project:'wet.qlproject',output:'wet-first.png'}
];
for(const args of fails) {
 const before=await meta('wet.qlproject');
 await assert.rejects(()=>run(args));
 assert.equal((await meta('wet.qlproject')).revision,before.revision); clean();
}
for(const args of [{project_checkpoint:'orphan'},{project_history_limit:2},{project_max_mb:64},{project:null},{project:'bad.png',brush:'oil'},{project:'new.qlproject',dry_state:'a',paint_state:'b'}]) await assert.rejects(()=>run(args));
// Persistence uses the .qlproject only, not process-local engine state.
const fresh=new Map(); apply({...context,tools:{register(t){fresh.set(t.name,t);}}});
const reopened=await fresh.get('quiet_line_draw').execute({project:'wet.qlproject',output:'reopen.png'},exec);
assert.ok(png(reopened).equals(png(afterRestore)), "reopened should match afterRestore");
// Dry operations are inferred from an existing project's mode.
const charcoal={tool:'charcoal',points:[[.2,.45],[.8,.5]],width:8,pressure:.6,grade:'6B'};
const lift={tool:'kneaded',points:[[.3,.45],[.6,.5]],width:5,pressure:.8};
const dry=await run({project:'dry.qlproject',size:320,seed:303,operations:[charcoal],output:'dry-first.png'});
assert.equal(dry.projectMode,'mixed'); assert.equal(dry.dryMedia,true);
const dryNext=await run({project:'dry.qlproject',operations:[lift],output:'dry-second.png'});
const whole=await run({project:'dry-whole.qlproject',size:320,seed:303,operations:[charcoal,lift],output:'dry-whole.png'});
await assertMatchingPixels(dryNext, whole, 'Splitting dry operations across calls should preserve visible pixels');
const dryNoMarks=await run({project:'dry.qlproject',output:'dry-empty.png'});
assert.ok(png(dryNoMarks).equals(png(dryNext)), "dryNoMarks should match dryNext");
const dryExport=await manage({action:'export',project:'dry.qlproject',target:'dry-export.qldry'});
assert.equal(loadDryState(cwd,dryExport.target).metadata.itemOffset,2);
const dryImport=await run({project:'dry-import.qlproject',dry_state:dryExport.target,operations:[],output:'dry-import.png'});
await assertMatchingPixels(dryImport, dryNext, 'Dry snapshot reimport should preserve visible pixels', 1);
// Start an empty project then draw with every brush on the same canvas.
const blank = await run({ project: 'mixed.qlproject', width: 360, height: 320, output: 'mixed-blank.png' });
assert.equal(blank.projectMode, 'mixed');
assert.equal(blank.marks, 0);
assert.deepEqual([blank.width, blank.height], [360, 320]);
assert.deepEqual(draw.parameters.properties.project_material.enum, ['wet', 'dry']);
let previous = blank;
for (const [index, brush] of ['ink', 'fountain', 'pencil', 'charcoal', 'brush', 'marker', 'oil', 'oilknife'].entries()) {
  const y = .12 + index * .1;
  const drawn = await run({
    project: 'mixed.qlproject', brush, output: 'mixed-' + brush + '.png',
    ...(brush === 'pencil' ? { dry_media: true } : {}),
    strokes: [{ points: [[.2,y],[.8,y]], width: 3, color: '#a04a25' }]
  });
  assert.equal(drawn.projectMode, 'mixed');
  assert.equal(drawn.brush, brush);
  assert.ok(!(await pixels(drawn)).equals(await pixels(previous)), brush + ' should add a visible mark');
  previous = drawn;
}
const wash = await run({
  project: 'mixed.qlproject', brush: 'brush', project_material: 'wet',
  fills: [{ points: [[.55,.84],[.86,.84],[.7,.95]], color: '#2070aa', opacity: .7 }],
  output: 'mixed-wash.png'
});
assert.equal(wash.brush, 'brush', 'explicit brush takes priority over the legacy hint');
assert.ok(!(await pixels(wash)).equals(await pixels(previous)), "wash should differ from previous");
// A translucent new oil mark must not make opaque old oil jump above a later fill.
const overlapProject = 'overlap.qlproject';
const crossing = [[.12,.5],[.88,.5]];
await run({ project: overlapProject, size: 320, brush: 'oil', strokes: [
  { points: crossing, width: 18, color: '#ff200c' }
] });
const coveredOil = await run({ project: overlapProject, brush: 'ink', fills: [
  { points: [[.25,.2],[.75,.2],[.75,.8],[.25,.8]], color: '#1135f5', rough: 0, opacity: 1 }
] });
const thinOil = await run({ project: overlapProject, brush: 'oil', strokes: [
  { points: crossing, color: '#10ef26', width: 15, opacity: .03 }
] });
const [coveredPixels, thinPixels] = await Promise.all([pixels(coveredOil), pixels(thinOil)]);
let visiblyChanged = 0;
for (let y = 154; y < 167; y++) {
  for (let x = 110; x < 210; x++) {
    const offset = (y * 320 + x) * 4;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(coveredPixels[offset + c] - thinPixels[offset + c]);
      assert.ok(delta <= 9, 'thin oil must respect the opacity of the new mark');
      if (delta) visiblyChanged++;
    }
  }
}
assert.ok(visiblyChanged > 0, 'thin oil over another material remains visible');

const noMarks = await run({ project: 'mixed.qlproject', output: 'mixed-empty.png' });
assert.ok((await pixels(noMarks)).equals(await pixels(wash)), "noMarks should match wash");
assert.deepEqual([noMarks.width, noMarks.height], [360, 320]);

// Verify material exports, composite export, branching and restoring.
const wetExport = await manage({ action: 'export', project: 'mixed.qlproject', target: 'mixed-stage.qlpaint' });
const graphiteExport = await manage({ action: 'export', project: 'mixed.qlproject', target: 'mixed-stage.qldry' });
assert.equal(loadPaintState(cwd, wetExport.target).metadata.width, 360);
assert.equal(loadDryState(cwd, graphiteExport.target).metadata.height, 320);
const composite = await manage({ action: 'export', project: 'mixed.qlproject', target: 'mixed-composite.png' });
assert.deepEqual(fs.readFileSync(composite.target), png(noMarks));

const beforeBranch = await meta('mixed.qlproject');
const mixedBranch = await manage({ action: 'branch', project: 'mixed.qlproject', target: 'mixed-branch.qlproject' });
assert.equal(mixedBranch.mode, 'mixed');
assert.equal((await meta('mixed.qlproject')).revision, beforeBranch.revision);
const branchCanvas = await run({ project: 'mixed-branch.qlproject', output: 'mixed-branch-empty.png' });
assert.ok((await pixels(branchCanvas)).equals(await pixels(noMarks)), "branchCanvas should match noMarks");
await manage({ action: 'restore', project: 'mixed.qlproject', step: blank.projectStep });
const restoredBlank = await run({ project: 'mixed.qlproject', output: 'mixed-restored-blank.png' });
assert.ok((await pixels(restoredBlank)).equals(await pixels(blank)), "restoredBlank should match blank");
assert.equal((await meta('mixed.qlproject')).steps.find(step => step.id === restoredBlank.projectStep).parentId, blank.projectStep);
await manage({ action: 'restore', project: 'mixed.qlproject', step: noMarks.projectStep });

// Returning to dry media after an oil and marker pass can still lift the original dry pigment.
const graphite = { tool: 'charcoal', points: [[.2,.27],[.8,.27]], width: 8, pressure: .7, grade: '6B' };
const dryMark = await run({ project: 'erasable.qlproject', size: 320, operations: [graphite], output: 'erasable-dry.png' });
await run({
  project: 'erasable.qlproject', brush: 'oil',
  strokes: [{ points: [[.2,.65],[.8,.65]], width: 6, color: '#a03424' }], output: 'erasable-oil.png'
});
const retained = await run({
  project: 'erasable.qlproject', brush: 'marker',
  strokes: [{ points: [[.2,.8],[.8,.8]], width: 4 }], output: 'erasable-marker.png'
});
const erased = await run({
  project: 'erasable.qlproject',
  operations: [{ tool: 'eraser', points: graphite.points, width: 24, pressure: 1 }],
  output: 'erasable-erased.png'
});
const region = (result, top, height) =>
  sharp(png(result)).extract({ left: 20, top, width: 280, height }).ensureAlpha().raw().toBuffer();
assert.ok((await region(retained, 62, 50)).equals(await region(dryMark, 62, 50)), "retained region should match dryMark");
assert.ok(!(await region(erased, 62, 50)).equals(await region(retained, 62, 50)), "eraser should affect retained graphite");
assert.ok((await region(erased, 180, 100)).equals(await region(retained, 180, 100)), "erased region should match retained");

for (const args of [
  { width: 361 }, { height: 321 }, { size: 360 }, { project_material: 'missing' },
  { operations: [{ ...charcoal, pressure: 2 }] },
  { base_image: wash.absolutePath }, { dry_state: graphiteExport.target }
]) {
  const before = await meta('mixed.qlproject');
  await assert.rejects(() => run({ project: 'mixed.qlproject', ...args }));
  assert.equal((await meta('mixed.qlproject')).revision, before.revision);
  clean();
}
const beforeMixedRace = await meta('mixed.qlproject');
const mixedRace = await Promise.allSettled([
  run({ project: 'mixed.qlproject', brush: 'oil', output: 'mixed-race-switch.png' }),
  run({ project: 'mixed.qlproject', output: 'mixed-race-same.png' })
]);
assert.equal(mixedRace.filter(result => result.status === 'fulfilled').length, 1);
assert.match(mixedRace.find(result => result.status === 'rejected').reason.message, /revision|changed|conflict/i);
assert.equal((await meta('mixed.qlproject')).revision, beforeMixedRace.revision + 1);
clean();
// Pins survive history limiting; deleting a pin allows subsequent pruning.
await manage({action:'checkpoint',project:'dry.qlproject',step:1,label:'first pass'});
await run({project:'dry.qlproject',project_history_limit:1,project_max_mb:64,output:'dry-limited.png'});
let dm=await meta('dry.qlproject');
assert.equal(dm.historyLimit,1); assert.equal(dm.maxBytes,64*1024*1024);
assert.equal(dm.steps.filter(s=>!s.pinned).length,1); assert.ok(dm.steps.some(s=>s.id===1));
await manage({action:'delete_checkpoint',project:'dry.qlproject',step:1});
dm=await manage({action:'prune',project:'dry.qlproject',history_limit:1,max_mb:64});
assert.equal(dm.steps.length,1);
for(const args of [{action:'list',step:1},{action:'restore',step:99999},{action:'checkpoint'},{action:'prune',history_limit:501},{action:'prune',max_mb:63},{action:'list',label:'extra'},{action:'branch',target:'branch.qlproject'}]) await assert.rejects(()=>manage({project:'wet.qlproject',...args}));
// Symlink-parent escape: exclusive export must never follow a parent outside cwd.
const outside=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-line-export-outside-'));
try {
 fs.symlinkSync(outside,path.join(cwd,'outside-link'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>manage({action:'export',project:'wet.qlproject',target:'outside-link/escape.png'}),/inside/);
 assert.equal(fs.existsSync(path.join(outside,'escape.png')),false);
} catch(e) { if(!['EPERM','EACCES'].includes(e.code)) throw e; }
// A malformed imported snapshot creates no project and leaves no temporary files.
fs.writeFileSync(path.join(cwd,'broken.qlpaint'),'not a state');
await assert.rejects(()=>run({project:'broken.qlproject',paint_state:'broken.qlpaint'}),/drawing/);
assert.equal(fs.existsSync(path.join(cwd,'broken.qlproject')),false);
// Two drawings starting at one revision cannot silently overwrite one another.
const concurrent=await Promise.allSettled([
 run({project:'wet.qlproject',output:'concurrent-a.png'}),
 run({project:'wet.qlproject',output:'concurrent-b.png'})
]);
assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
assert.match(concurrent.find(r=>r.status==='rejected').reason.message,/revision|changed|conflict/i);
assert.equal(fs.readdirSync(cwd).some(n=>/\.qlpaint$|\.qldry$/.test(n)&&!['wet-export.qlpaint','dry-export.qldry','broken.qlpaint','mixed-stage.qldry','mixed-stage.qlpaint'].includes(n)),false,'no persistent bridge snapshots');
clean();
console.log('project integration: PASS',cwd);
