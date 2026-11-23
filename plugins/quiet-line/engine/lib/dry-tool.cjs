'use strict';

const TOOLS = ['pencil', 'charcoal', 'eraser', 'kneaded', 'smudge'];
const GRADES = ['H', 'HB', '2B', '4B', '6B', '8B'];
const operationProperties = {
  tool: {type:'string',enum:TOOLS,description:'Material or operation, applied in array order. eraser removes material; kneaded gently lifts it; smudge moves loose material. They never edit the flattened base image.'},
  points: {type:'array',minItems:2,maxItems:400,items:{type:'array',items:{type:'number'},minItems:2,maxItems:2},description:'Normalized canvas coordinates, y down, -0.2..1.2. Two or more path anchors.'},
  color: {type:'string',description:'Pigment colour: palette name or #rrggbb. Default ink. Only pencil/charcoal deposit colour.'},
  width: {type:'number',minimum:0.1,maximum:30,description:'Contact width multiplier of base weight, 0.1–30; default 1, NOT pixels. Nominal pixels = weight × (short canvas side / 420)^0.68 × width; tilt, tip and controls change the footprint. Use wider values and tilt for broad shading or erasing.'},
  pressure: {type:'number',minimum:0,maximum:1,description:'Actual contact pressure (default 0.5), affecting material density; 0 deposits/removes/moves nothing. Unlike the global pressure-variation setting.'},
  opacity: {type:'number',minimum:0,maximum:1,description:'Operation strength, default 0.95.'},
  flow: {type:'number',minimum:0,maximum:1,description:'Material transfer rate, default 1.'},
  grade: {type:'string',enum:GRADES,description:'Graphite/material softness, default 2B. H is harder/lighter, 8B softer/darker. Not oil edge hardness.'},
  tip: {type:'string',enum:['round','flat'],description:'Contact shape. Flat supports directional side shading.'},
  aspect: {type:'number',minimum:0.05,maximum:1,description:'Flat footprint minor/major ratio, default 0.3.'},
  angle: {type:'number',minimum:-360,maximum:360,description:'Contact major-axis direction in canvas degrees.'},
  tilt: {type:'number',minimum:0,maximum:1,description:'0 upright point, 1 broad side contact. Also supported per point.'},
  cap: {type:'string',enum:['round','flat','taper']},
  closed: {type:'boolean'},
  controls: {type:'array',description:'One control per path point; pressure, width, opacity, angle and tilt interpolate along the path.',items:{type:'object',additionalProperties:false,properties:{
    pressure:{type:'number',minimum:0,maximum:1},width:{type:'number',minimum:0,maximum:3,description:'Local multiplier of operation width, 0–3; default 1, 0 lifts contact. NOT pixels. Set operation width (0.1–30) for overall size.'},opacity:{type:'number',minimum:0,maximum:1},angle:{type:'number',minimum:-360,maximum:360},tilt:{type:'number',minimum:0,maximum:1}
  }}}
};
const parameters = {
  dry_media: {type:'boolean',description:'Opt in to material-aware pencil/charcoal drawing. Inferred when operations, dry_state or save_dry_state is present. Without it, old brushes stay byte-compatible. Use ordered operations, or strokes with brush pencil/charcoal. No subject, fills, dots or wet-state parameters in this mode.'},
  dry_state: {type:'string',description:'Resume a .qldry material snapshot, retaining removable pigment and original substrate. Inherits dimensions, surface, seed, grain and drawing defaults. Do not combine with base_image or wet state. Use this, not the PNG, for later erasing/smudging.'},
  save_dry_state: {type:'string',description:'Save NEW .qldry snapshot inside the working directory for continuation or branching. Bounded canvas-sized I/O; existing files never overwritten. The parent directory must already exist.'},
  operations: {type:'array',maxItems:600,items:{type:'object',additionalProperties:false,required:['tool','points'],properties:operationProperties},description:'Material-aware ordered marks: pencil/charcoal -> smudge -> eraser/kneaded, in any order. Enables dry mode. Exclusive with strokes; no fills/dots/subject. At most 600 operations and 40,000 path points per call.'}
};

function normalize(raw, i, h) {
  const {fail, numberIn, color, pointsOf} = h;
  const label = `operations[${i}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label} must be an object`);
  for (const k of Object.keys(raw)) if (!Object.hasOwn(operationProperties,k)) fail(`Unknown ${label}.${k}; dry material grade is separate from oil hardness`);
  if (!TOOLS.includes(raw.tool)) fail(`${label}.tool must be ${TOOLS.join(', ')}`);
  const result = {tool:raw.tool,points:pointsOf(raw.points,`${label}.points`,2)};
  for (const [k,def,lo,hi] of [['width',1,.1,30],['pressure',.5,0,1],['opacity',.95,0,1],['flow',1,0,1],['angle',0,-360,360],['tilt',0,0,1],['aspect',.3,.05,1]]) result[k]=numberIn(raw[k],def,lo,hi,`${label}.${k}`);
  result.color=color(raw.color,`${label}.color`) || 'ink';
  for (const [k,values,def] of [['grade',GRADES,'2B'],['tip',['round','flat'],'round'],['cap',['round','flat','taper'],'round']]) {
    result[k]=raw[k]??def;
    if (!values.includes(result[k])) fail(`${label}.${k} must be ${values.join(', ')}`);
  }
  if (raw.closed != null && typeof raw.closed !== 'boolean') fail(`${label}.closed must be boolean`);
  result.closed=raw.closed===true;
  if (raw.controls != null) {
    if (!Array.isArray(raw.controls) || raw.controls.length!==result.points.length) fail(`${label}.controls must have one object per point`);
    result.controls=raw.controls.map((c,j)=>{
      if (!c || typeof c!=='object' || Array.isArray(c)) fail(`${label}.controls[${j}] must be an object`);
      const out={};
      for (const [k,lo,hi] of [['pressure',0,1],['width',0,3],['opacity',0,1],['angle',-360,360],['tilt',0,1]]) if (c[k]!=null) out[k]=numberIn(c[k],undefined,lo,hi,`${label}.controls[${j}].${k}`);
      for (const k of Object.keys(c)) if (!Object.hasOwn(out,k)) fail(`Unknown or null control ${k}`);
      return out;
    });
  }
  return result;
}

async function executeDry(args,exec,h) {
  const {ctx,fail,numberIn,integerIn,loadBaseImage,writeDrawing,outputPath,attachImage,path,CORE}=h;
  const DRY = require('./dry-media.cjs');
  const {loadDryState,saveDryState}=require('./dry-state.cjs');
  const cwd=await ctx.workingDirectory.ensure(exec.agent,exec.signal);
  if (!cwd) fail('the session working directory is unavailable');
  for (const k of ['subject','fills','dots','paint_state','save_state']) if (args[k]!=null) fail(`dry mode cannot be combined with ${k}`);
  if (args.dry_media===false) fail('dry_media:false conflicts with dry operations/state');
  if (args.dry_state!=null && args.base_image!=null) fail('dry_state cannot be combined with base_image');
  if (args.operations!=null && args.strokes!=null) fail('choose operations or strokes, not both');
  for (const k of ['wetness','impasto','load']) if (args[k]!=null) fail(`${k} is for oil; not dry materials`);
  const state=args.dry_state==null ? undefined : loadDryState(cwd,args.dry_state);
  const m=state?.metadata, previous=m?.settings;
  if(m) {
    for(const k of ['surface','seed','width','height']) if(args[k]!=null && args[k]!==m[k]) fail(`dry_state fixes ${k}; omit it`);
    if(args.size!=null && (args.size!==m.width || args.size!==m.height)) fail('dry_state dimensions cannot be resized');
    if(args.grain!=null && Math.abs(args.grain/100-(previous?.texture??m.grain))>1e-9) fail('dry_state fixes grain; omit it');
  }
  const brush=args.brush??previous?.brush??'pencil';
  if(!['pencil','charcoal'].includes(brush)) fail('dry mode default brush must be pencil or charcoal; choose other tools per operation');
  let raw=args.operations??args.strokes??[];
  if(!Array.isArray(raw)) fail('operations/strokes must be an array');
  if(raw.length>600) fail('dry mode is limited to 600 operations');
  if(args.operations==null) raw=raw.map(s=>({...s,tool:brush}));
  const operations=raw.map((s,i)=>normalize(s,i,h));
  if(operations.reduce((n,s)=>n+s.points.length,0)>40000) fail('dry mode is limited to 40000 path points');
  const surface=args.surface??m?.surface??'warm';
  if(!Object.hasOwn(CORE.SURFACES,surface)) fail('unknown surface');
  const seed=integerIn(args.seed,m?.seed??241,1,9999,'seed');
  const baseImage=args.base_image==null?undefined:await loadBaseImage(cwd,args.base_image,args);
  const size=m||baseImage?undefined:integerIn(args.size,1200,320,CORE.MAX_CANVAS_SIDE,'size');
  const width=m?.width??baseImage?.width??integerIn(args.width,size,320,CORE.MAX_CANVAS_SIDE,'width');
  const height=m?.height??baseImage?.height??integerIn(args.height,size,320,CORE.MAX_CANVAS_SIDE,'height');
  let accent=previous?.accent??undefined;
  if(args.accent!=null) {
    if(typeof args.accent!=='string'||!/^#[0-9a-f]{6}$/i.test(args.accent)) fail('accent must be #rrggbb');
    accent=args.accent;
  }
  const style={seed,surface,brush,weight:numberIn(args.weight,previous?.weight??3,1.5,4.5,'weight'),
    wobble:args.wobble==null?(previous?.wobble??.58):numberIn(args.wobble,58,0,100,'wobble')/100,
    pressure:args.pressure==null?(previous?.pressure??.66):numberIn(args.pressure,66,0,100,'pressure')/100,
    texture:args.grain==null?(previous?.texture??.46):numberIn(args.grain,46,0,100,'grain')/100,
    ...(accent?{accent}:{})};
  const settings={...style}; delete settings.seed;delete settings.surface; settings.accent=accent??null;
  const rendered=DRY.renderDry(operations,style,{width,height,baseImage,state,captureState:args.save_dry_state!=null,itemOffset:m?.itemOffset??0,settings});
  const title=(args.title&&String(args.title).trim())||'Dry media study';
  const target=await writeDrawing(cwd,outputPath(cwd,args.output,title,seed),rendered.png,{continuation:true,explicitOutput:args.output!=null&&String(args.output).trim()!==''});
  const dryState=args.save_dry_state==null?undefined:saveDryState(cwd,args.save_dry_state,rendered.paintState);
  let image,note;
  const limits=ctx.get('attachments')?.imageLimits;
  if(limits) ({image,note}=await attachImage(ctx,rendered.png,path.basename(target),limits));
  else note='No attachment service is mounted; the PNG is on disk only.';
  return {title,subject:'custom',brush,surface,seed,path:path.relative(cwd,target).split(path.sep).join('/'),absolutePath:target,width:rendered.width,height:rendered.height,bytes:rendered.png.length,marks:operations.length,dryMedia:true,
    ...(baseImage?{baseImage:baseImage.path,resizedBase:baseImage.resized}:{}),...(dryState?{dryState}:{}),...(state?{resumedDryState:path.resolve(cwd,args.dry_state)}:{}),...(image?{image}:{}),...(note?{note}:{})};
}
module.exports={parameters,executeDry,normalizeDryOperation:normalize};
