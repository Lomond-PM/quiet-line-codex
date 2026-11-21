'use strict';
// Reproducible diagnostic sheet: labels outside unaltered engine renders.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const {renderDry}=require('../lib/dry-media.cjs');
const line=(y,extra={})=>({tool:'pencil',points:[[.14,y],[.86,y]],width:4,pressure:.55,...extra});
const blanket=[];
for(let y=.22;y<.82;y+=.045) blanket.push(line(y,{tool:'charcoal',width:9,pressure:.7,grade:'6B'}));
const panels=[
 {label:'Pressure: 0.15 / 0.5 / 0.95',ops:[.15,.5,.95].map((p,i)=>line(.28+i*.23,{pressure:p,width:5}))},
 {label:'Upright / side contact / rotated side',ops:[line(.26),line(.52,{tilt:1,angle:90}),line(.8,{tilt:1,angle:0})]},
 {label:'Material grades: H / 2B / 8B',ops:['H','2B','8B'].map((grade,i)=>line(.28+i*.23,{grade,width:5}))},
 {label:'Accumulation: 1 / 4 / 12 passes',ops:[1,4,12].flatMap((n,i)=>Array.from({length:n},()=>line(.28+i*.23,{pressure:.3,width:7})))},
 {label:'Charcoal -> kneaded lift -> eraser (kraft)',surface:'kraft',ops:[...blanket,{tool:'kneaded',points:[[.32,.18],[.32,.87]],width:17,pressure:.9},{tool:'eraser',points:[[.67,.18],[.67,.87]],width:17,pressure:.95}]},
 {label:'Charcoal -> directional smudge (right)',ops:[...Array.from({length:5},()=>({tool:'charcoal',points:[[.28,.2],[.28,.8]],width:12,pressure:.8,grade:'8B'})),...Array.from({length:5},()=>({tool:'smudge',points:[[.25,.5],[.8,.5]],width:21,pressure:.9}))]}
];
async function main(){
 const composites=[];
 for(let i=0;i<panels.length;i++){
  const p=panels[i],r=renderDry(p.ops,{seed:241,surface:p.surface||'warm',weight:4,wobble:0,pressure:0,texture:.65},{width:440,height:280});
  const left=(i%3)*440,top=Math.floor(i/3)*320;
  composites.push({input:r.png,left,top:top+40});
  composites.push({input:Buffer.from(`<svg width="440" height="40"><rect width="440" height="40" fill="#f4f0e7"/><text x="14" y="26" font-size="16" font-family="Arial" fill="#302b29">${p.label.replaceAll('->','→')}</text></svg>`),left,top});
 }
 const out=path.resolve(process.argv[2]||'quiet-line-out/dry-materials-check.png');
 fs.mkdirSync(path.dirname(out),{recursive:true});
 await sharp({create:{width:1320,height:640,channels:4,background:'#f4f0e7'}}).composite(composites).png().toFile(out);
 console.log(out);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
