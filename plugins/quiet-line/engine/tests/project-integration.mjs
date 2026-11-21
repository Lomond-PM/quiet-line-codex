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
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-line-project-tool-'));
const tools=new Map();
const context={tools:{register(t){tools.set(t.name,t);}},workingDirectory:{ensure:async()=>cwd},get(){}};
apply(context);
assert.equal(tools.size,2);
const draw=tools.get('quiet_line_draw'), manager=tools.get('quiet_line_project');
const exec={agent:{id:'project-integration'}};
const run=args=>draw.execute(args,exec), manage=args=>manager.execute(args,exec);
const png=r=>fs.readFileSync(r.absolutePath);
const meta=p=>readProject(cwd,p);
const clean=()=>assert.equal(fs.readdirSync(cwd).some(n=>n.startsWith('.quiet-line-project-')),false,'owned temporary bridge directories must be removed');
const stroke={points:[[.2,.5],[.8,.52]],width:2,color:'#a04a25'};
const wetOpts={brush:'oil',size:320,seed:217,grain:20,strokes:[stroke]};
const wet=await run({...wetOpts,project:'wet.qlproject',project_checkpoint:'start',output:'wet-first.png'});
assert.equal(wet.projectMode,'wet'); assert.equal(wet.projectStep,1); assert.equal(wet.projectRevision,1);
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
await assert.rejects(()=>manage({action:'export',project:'wet.qlproject',target:'wrong.qldry'}),/\.qlpaint/);
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
assert.deepEqual(png(imported),png(wet));
assert.deepEqual(fs.readFileSync(exported.target),importedBytes);
// Every failure leaves exactly the same source revision and removes bridge files.
const fails=[
 {project:'wet.qlproject',base_image:wet.absolutePath},
 {project:'wet.qlproject',paint_state:exported.target},
 {project:'wet.qlproject',dry_state:'none.qldry'},
 {project:'wet.qlproject',save_state:'loose.qlpaint'},
 {project:'wet.qlproject',save_dry_state:'loose.qldry'},
 {project:'wet.qlproject',operations:[]},
 {project:'wet.qlproject',brush:'ink'},
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
for(const args of [{project_checkpoint:'orphan'},{project_history_limit:2},{project_max_mb:64},{project:null},{project:'bad.png',brush:'oil'},{project:'new.qlproject',brush:'ink'},{project:'new.qlproject',dry_state:'a',paint_state:'b'},{project:'new.qlproject',operations:[],paint_state:exported.target}]) await assert.rejects(()=>run(args));
// Persistence uses the .qlproject only, not process-local engine state.
const fresh=new Map(); apply({...context,tools:{register(t){fresh.set(t.name,t);}}});
const reopened=await fresh.get('quiet_line_draw').execute({project:'wet.qlproject',output:'reopen.png'},exec);
assert.deepEqual(png(reopened),png(afterRestore));
// Dry operations are inferred from an existing project's mode.
const charcoal={tool:'charcoal',points:[[.2,.45],[.8,.5]],width:8,pressure:.6,grade:'6B'};
const lift={tool:'kneaded',points:[[.3,.45],[.6,.5]],width:5,pressure:.8};
const dry=await run({project:'dry.qlproject',size:320,seed:303,operations:[charcoal],output:'dry-first.png'});
assert.equal(dry.projectMode,'dry'); assert.equal(dry.dryMedia,true);
const dryNext=await run({project:'dry.qlproject',operations:[lift],output:'dry-second.png'});
const whole=await run({size:320,seed:303,operations:[charcoal,lift],output:'dry-whole.png'});
assert.deepEqual(png(dryNext),png(whole));
const dryNoMarks=await run({project:'dry.qlproject',output:'dry-empty.png'});
assert.deepEqual(png(dryNoMarks),png(dryNext));
const dryExport=await manage({action:'export',project:'dry.qlproject',target:'dry-export.qldry'});
assert.equal(loadDryState(cwd,dryExport.target).metadata.itemOffset,2);
const dryImport=await run({project:'dry-import.qlproject',dry_state:dryExport.target,operations:[],output:'dry-import.png'});
assert.deepEqual(png(dryImport),png(dryNext));
await assert.rejects(()=>run({project:'dry.qlproject',dry_media:false}));
await assert.rejects(()=>run({project:'dry.qlproject',wetness:50}));
// Explicit selection creates either initial mode; the old implicit wet brush rule stays intact.
assert.deepEqual(draw.parameters.properties.project_material.enum,['wet','dry']);
const explicitWet=await run({project:'explicit-wet.qlproject',project_material:'wet',size:320,strokes:[],output:'explicit-wet.png'});
assert.equal(explicitWet.brush,'oil'); assert.equal(explicitWet.projectTransition,undefined);
const explicitDry=await run({project:'explicit-dry.qlproject',project_material:'dry',size:320,output:'explicit-dry.png'});
assert.equal(explicitDry.projectMode,'dry'); assert.equal(explicitDry.brush,'pencil');
for(const args of [{project_material:'dry'},{project_material:'wet'},{project:'invalid-mode.qlproject',project_material:'ink'},{project:'invalid-null.qlproject',project_material:null},{project:'new-conflict.qlproject',project_material:'wet',operations:[]},{project:'new-conflict.qlproject',project_material:'dry',dry_media:false},{project:'new-conflict.qlproject',project_material:'wet',brush:'ink'},{project:'new-conflict.qlproject',project_material:'dry',brush:'oil'}]) await assert.rejects(()=>run(args));
// wet -> dry -> wet uses only the previous PNG as the new substrate, not the wrong-format state.
// Non-square dimensions and empty transitions must survive exactly, without default study marks.
const mixed=await run({...wetOpts,size:undefined,width:360,height:320,project:'mixed.qlproject',output:'mixed-wet.png'});
const oldMixed=await readProject(cwd,'mixed.qlproject',{includeData:true});
const mixedDry=await run({project:'mixed.qlproject',project_material:'dry',output:'mixed-dry.png'});
assert.equal(mixedDry.projectMode,'dry'); assert.equal(mixedDry.marks,0);
assert.match(mixedDry.projectTransition,/wet → dry.*fixed flattened base/);
assert.equal(mixedDry.baseImage,undefined,'do not expose deleted internal bridge files');
assert.deepEqual([mixedDry.width,mixedDry.height],[360,320]);
assert.deepEqual(await pixels(mixedDry),await pixels(mixed));
const dryStage=await readProject(cwd,'mixed.qlproject',{includeData:true});
assert.equal(dryStage.selected.mode,'dry');
const retainedWet=await readProject(cwd,'mixed.qlproject',{step:1,includeData:true});
assert.deepEqual(retainedWet.selected.state,oldMixed.selected.state,'old physical state is retained byte-for-byte');
assert.deepEqual(retainedWet.selected.png,oldMixed.selected.png);
// Erasing the flattened oil does nothing; new charcoal remains editable in the same dry stage.
const eraseAll={tool:'eraser',points:[[.1,.5],[.9,.5]],width:30,pressure:1};
const eraseOld=await run({project:'mixed.qlproject',operations:[eraseAll],output:'mixed-erase-old.png'});
assert.deepEqual(await pixels(eraseOld),await pixels(mixed));
const mixedMarked=await run({project:'mixed.qlproject',operations:[charcoal],output:'mixed-marked.png'});
assert.notDeepEqual(await pixels(mixedMarked),await pixels(mixedDry));
const mixedLift=await run({project:'mixed.qlproject',operations:[lift],output:'mixed-lift.png'});
assert.notDeepEqual(await pixels(mixedLift),await pixels(mixedMarked));
// Explicit same-mode selection is a true state resume, equivalent to a direct state continuation.
const stageExport=await manage({action:'export',project:'mixed.qlproject',target:'mixed-stage.qldry'});
const mixedSame=await run({project:'mixed.qlproject',project_material:'dry',operations:[charcoal],output:'mixed-same.png'});
const directSame=await run({dry_state:stageExport.target,operations:[charcoal],output:'mixed-direct-same.png'});
assert.deepEqual(png(mixedSame),png(directSame)); assert.equal(mixedSame.projectTransition,undefined);
const mixedWet=await run({project:'mixed.qlproject',project_material:'wet',output:'mixed-wet-again.png'});
assert.equal(mixedWet.brush,'oil'); assert.equal(mixedWet.subject,'custom'); assert.equal(mixedWet.marks,0);
assert.match(mixedWet.projectTransition,/dry → wet/);
assert.deepEqual(await pixels(mixedWet),await pixels(mixedSame));
assert.deepEqual([mixedWet.width,mixedWet.height],[360,320]);
const wetStageExport=await manage({action:'export',project:'mixed.qlproject',target:'mixed-stage.qlpaint'});
const mixedWetSame=await run({project:'mixed.qlproject',project_material:'wet',strokes:[stroke],output:'mixed-wet-same.png'});
const directWetSame=await run({paint_state:wetStageExport.target,strokes:[stroke],output:'mixed-direct-wet-same.png'});
assert.deepEqual(png(mixedWetSame),png(directWetSame));
assert.notDeepEqual(await pixels(mixedWetSame),await pixels(mixedWet));
// A transition can immediately draw with valid settings for the new mode; it does not inherit old-mode restrictions.
await manage({action:'branch',project:'mixed.qlproject',step:1,target:'switch-marks.qlproject'});
const switchDryOpts={operations:[charcoal],brush:'charcoal',grain:35,seed:509,surface:'coldpress'};
const switchDryMarks=await run({project:'switch-marks.qlproject',project_material:'dry',...switchDryOpts,output:'switch-dry-marks.png'});
const directDryMarks=await run({base_image:mixed.absolutePath,...switchDryOpts,output:'direct-dry-marks.png'});
assert.deepEqual(png(switchDryMarks),png(directDryMarks));
const switchWetOpts={strokes:[stroke],brush:'oilknife',wetness:73,grain:18,seed:617,surface:'linen'};
const switchWetMarks=await run({project:'switch-marks.qlproject',project_material:'wet',...switchWetOpts,output:'switch-wet-marks.png'});
const directWetMarks=await run({base_image:switchDryMarks.absolutePath,...switchWetOpts,output:'direct-wet-marks.png'});
assert.deepEqual(png(switchWetMarks),png(directWetMarks));
// Material conflicts and new-mode validation fail without advancing the source revision.
for(const args of [
 {project_material:'dry',width:361},{project_material:'dry',height:321},{project_material:'dry',size:360},
 {project_material:'dry',wetness:50},{project_material:'dry',brush:'oil'},{project_material:'dry',subject:'cat'},
 {project_material:'wet',operations:[]},{project_material:'wet',dry_media:true},{project_material:'wet',brush:'ink'},
 {project_material:'dry',operations:[{...charcoal,pressure:2}]},
 {project_material:'dry',base_image:mixed.absolutePath},{project_material:'dry',dry_state:stageExport.target}
]) {
 const before=await meta('mixed.qlproject');
 await assert.rejects(()=>run({project:'mixed.qlproject',...args}));
 assert.equal((await meta('mixed.qlproject')).revision,before.revision); clean();
}
let mixedMeta=await meta('mixed.qlproject');
assert.deepEqual(mixedMeta.steps.map(s=>s.mode),['wet','dry','dry','dry','dry','dry','wet','wet']);
assert.match(manager.output.render({},mixedMeta)[0].text,/Step 2 \(dry;/);
// A historical export must validate using that step's mode, not the current wet head mode.
const historicalDry=await manage({action:'export',project:'mixed.qlproject',step:2,target:'mixed-historical.qldry'});
assert.equal(historicalDry.mode,'wet'); assert.equal(historicalDry.exportedMode,'dry');
assert.equal(loadDryState(cwd,historicalDry.target).metadata.width,360);
assert.match(manager.output.render({},historicalDry)[0].text,/dry material/);
await assert.rejects(()=>manage({action:'export',project:'mixed.qlproject',step:2,target:'wrong-historical.qlpaint'}),/\.qldry/);
const historicalWet=await manage({action:'export',project:'mixed.qlproject',step:1,target:'mixed-historical.qlpaint'});
assert.deepEqual(fs.readFileSync(historicalWet.target),oldMixed.selected.state);
const mixedBranch=await manage({action:'branch',project:'mixed.qlproject',step:2,target:'mixed-dry-branch.qlproject'});
assert.equal(mixedBranch.mode,'dry'); assert.equal(mixedBranch.steps[0].mode,'dry');
const resumedBranch=await run({project:'mixed-dry-branch.qlproject',output:'mixed-branch-empty.png'});
assert.deepEqual(await pixels(resumedBranch),await pixels(mixedDry));
await manage({action:'restore',project:'mixed.qlproject',step:1});
assert.equal((await meta('mixed.qlproject')).mode,'wet');
const resumedWet=await run({project:'mixed.qlproject',output:'mixed-restored-wet.png'});
assert.deepEqual(png(resumedWet),png(mixed));
await manage({action:'restore',project:'mixed.qlproject',step:2});
assert.equal((await meta('mixed.qlproject')).mode,'dry');
const resumedDry=await run({project:'mixed.qlproject',output:'mixed-restored-dry.png'});
assert.deepEqual(png(resumedDry),png(mixedDry));
// A competing continuation and explicit switch still share one revision CAS boundary.
const beforeMixedRace=await meta('mixed.qlproject');
const mixedRace=await Promise.allSettled([
 run({project:'mixed.qlproject',project_material:'wet',output:'mixed-race-switch.png'}),
 run({project:'mixed.qlproject',output:'mixed-race-same.png'})
]);
assert.equal(mixedRace.filter(r=>r.status==='fulfilled').length,1);
assert.match(mixedRace.find(r=>r.status==='rejected').reason.message,/revision|changed|conflict/i);
assert.equal((await meta('mixed.qlproject')).revision,beforeMixedRace.revision+1);
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
assert.equal(fs.readdirSync(cwd).some(n=>/\.qlpaint$|\.qldry$/.test(n)&&!['wet-export.qlpaint','dry-export.qldry','broken.qlpaint','mixed-stage.qldry','mixed-stage.qlpaint','mixed-historical.qldry','mixed-historical.qlpaint'].includes(n)),false,'no persistent bridge snapshots');
clean();
console.log('project integration: PASS',cwd);
