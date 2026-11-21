'use strict';
const CORE = require('../lib/core.cjs');
const R = require('../lib/raster.cjs');
const W=640,H=480,ss=2;
const p=CORE.buildSketch({items:[CORE.stroke([[.3,.4],[.4,.32],[.5,.42]],{
 width:3,tip:'flat',hardness:.6,flow:.8,controls:[{pressure:.2,angle:10},{pressure:1,angle:45},{pressure:.2,angle:80}]
})]},{seed:623,brush:'oil',surface:'linen',weight:4,texture:.4,wobble:.2,pressure:.5},{width:W,height:H}).primitives[0];
const ink=new Uint8Array(W*H*ss*ss*4),state=R.createOilState(W*ss,H*ss,ss,{surface:'linen',seed:623});
const times=[];
for(let i=0;i<240;i++){
 const start=process.hrtime.bigint();
 R.paintOilStroke(ink,W*ss,H*ss,ss,p,{wetness:.6,impasto:.7,load:.8,seed:623},state);
 times.push(Number(process.hrtime.bigint()-start)/1e6);
}
const median=a=>a.sort((a,b)=>a-b)[a.length>>1];
const early=median(times.slice(20,60)),late=median(times.slice(200));
console.log(JSON.stringify({strokes:240,medianMs:{early,late},ratio:late/early,note:'Diagnostic only; canvas export/snapshot I/O excluded. No prior stroke replay.'},null,2));
