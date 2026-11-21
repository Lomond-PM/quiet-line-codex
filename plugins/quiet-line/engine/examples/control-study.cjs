'use strict';
// Reproducible visual check, no external image-generation API.
const fs=require('node:fs'),path=require('node:path');
const C=require('../lib/core.cjs'),R=require('../lib/raster.cjs');
const items=[];
items.push(C.stroke([[.08,.18],[.32,.12],[.55,.2],[.9,.15]],{color:'#b64732',width:3,tip:'flat',cap:'taper',controls:[{pressure:0,angle:0},{pressure:1,angle:30},{pressure:.5,angle:85},{pressure:0,angle:130}]}));
for(let i=0;i<4;i++){
 const x=.14+i*.23;
 items.push(C.stroke([[x,.33],[x+.07,.48]],{color:'#35617b',width:3,tip:'flat',angle:i*35,hardness:1,cap:'flat',aspect:.2}));
 items.push(C.stroke([[x-.04,.64],[x+.09,.63]],{color:'#b57727',width:3,hardness:i/3,flow:.8,cap:'round'}));
 items.push(C.stroke([[x-.04,.83],[x+.09,.82]],{color:'#486d53',width:3,hardness:.8,flow:(i+1)/4,cap:'round'}));
}
const built=C.buildSketch({items},{seed:623,brush:'oil',surface:'linen',weight:4.5,wobble:0,pressure:0,texture:.3},{width:960,height:720});
const rendered=R.renderPNG(built,{width:960,height:720,seed:623,wetness:.55,impasto:.8,load:.85});
const dir=path.join(__dirname,'../docs');fs.mkdirSync(dir,{recursive:true});
const target=path.join(dir,'controls.png');fs.writeFileSync(target,rendered.png);console.log(target);
