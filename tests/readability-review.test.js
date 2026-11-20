const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { KIT,makeBuilder,makeSculpt,ColorSpace }=ink.load();
const PNG = require('../cli/png.js');
const { measure }=require('../cli/readability-review.js');

const thresholds={color:.09,lightness:.055,weakShare:.25,depthBias:.05};
const subject={id:'Face',select:{surface:'face'}};
const sample=rgb=>Array.from(rgb,value=>Math.round(value*255));

test('edge metrics use the actual neighbouring swatches and exclude occluders and missing alpha backgrounds',()=>{
  const a=sample(ColorSpace.fromOKLab([.64,.15,.06])), b=sample(ColorSpace.fromOKLab([.64,-.14,.06]));
  const rgb=new Uint8Array(27);
  rgb.set(a,3*3); rgb.set(a,4*3); rgb.set(b,5*3);
  const alpha=new Uint8Array(9).fill(255);
  alpha[7]=0;
  const depth=new Float32Array(9).fill(5);
  depth[1]=3; depth[4]=4; depth[7]=Infinity;
  const mask=Uint8Array.of(0,0,0,0,1,0,0,0,0);
  const frame={w:3,h:3,rgb,alpha,readabilityMask:mask,passes:{depth}};
  const result=measure(frame,[subject],thresholds), [row]=result.subjects;
  assert.equal(row.pixels,1);
  assert.equal(row.samples,2);
  assert.equal(row.occludedEdges,1);
  assert.equal(row.transparentEdges,1);
  assert.equal(row.weakColorShare,.5);
  assert.equal(row.weakLightnessShare,1);
  assert(row.color.mean>.12 && row.lightness.mean<.005);
  assert.deepEqual(row.flags,['weak-color','weak-lightness']);
  assert.deepEqual([row.worstColor.subject.x,row.worstColor.background.x],[1,0]);
  assert.equal(row.worstColor.subject.swatch,row.worstColor.background.swatch);
  assert.deepEqual([...result.marked.rgb.slice(12,15)],[255,119,127]);
  const matted=measure(frame,[subject],thresholds,'#ffffff');
  assert.equal(matted.subjects[0].samples,3);
  assert.equal(matted.subjects[0].transparentEdges,0);
  assert.deepEqual([...matted.frame.rgb.subarray(21,24)],[255,255,255]);
});

test('an absent subject or fully cropped background has no fabricated contrast',()=>{
  const frame={w:1,h:1,rgb:Uint8Array.of(22,33,44),readabilityMask:Uint8Array.of(1),passes:{depth:Float32Array.of(2)}};
  const {subjects:[visible,hidden]}=measure(frame,[subject,{id:'Hidden',select:{object:'hidden'}}],thresholds);
  assert.equal(visible.croppedEdges,4);
  assert.deepEqual(visible.flags,['no-background-samples','clipped']);
  assert.deepEqual(hidden.flags,['not-visible']);
  assert.equal(visible.color,null);
  assert.equal(hidden.lightness,null);
});

function stage() {
  const b=makeBuilder(43,[0x1b2535,0x596d82,0x9db6c7,0xe5dbb5,0xd27b72]);
  const s=KIT.sculpt(makeSculpt(b));
  s.amb=1; s.sky=0; s.sunK=0;
  s.box([0,-.28,0],[.53,.66,.12],{r:[2],materialId:'coat'},{objectId:'actor',res:.075});
  s.ball([0,.56,.03],.31,{r:[3],materialId:'skin'},
    {objectId:'actor',surfaceId:'face',target:{tags:['face-tag']},res:.053});
  s.bake();
  return b.finish({cam:{target:[0,0,0],dist:4.1,yaw:0,pitch:0,sway:0},dither:0});
}

test('named surface captures preserve exported colors and review the view by lighting matrix',()=>{
  const world=stage(), poseTimes=[];
  const options={w:160,h:100,px:2,ortho:true};
  const frame=ink.render(world,options);
  const capture=ink.render(world,{...options,readabilitySelectors:[{tag:'face-tag'},{object:'actor'}],passes:['depth']});
  assert.deepEqual(capture.rgb,frame.rgb);
  const facePixels=[...capture.readabilityMask].filter(bits=>bits&1).length;
  assert(facePixels>0);
  assert(!capture.readabilityMask.some(bits=>bits===1));
  const plan={
    subjects:[subject,{id:'Actor',select:{object:'actor'}}],
    views:[{id:'Front',yaw:0},{id:'Oblique',yaw:.6}],
    states:[
      {id:'Late',time:1,lighting:{skyEnvironment:{defaults:{zenith:'#e5dbb5',horizon:'#e5dbb5',ground:'#e5dbb5',sunStrength:0}}}},
      {id:'Early',time:0,lighting:{skyEnvironment:{defaults:{zenith:'#1b2535',horizon:'#1b2535',ground:'#1b2535',sunStrength:0}}}}
    ]
  };
  const {report,image}=ink.reviewSubjectReadability(world,{plan,width:160,height:100,view:{px:2,ortho:true},
    pose(_world,time) { poseTimes.push(time); }});
  assert.deepEqual(poseTimes,[0,1]);
  assert.deepEqual([report.width,report.height,report.pixelSize],[80,50,2]);
  assert.deepEqual(report.samples.map(row=>[row.view,row.state]),
    [['Front','Late'],['Oblique','Late'],['Front','Early'],['Oblique','Early']]);
  assert.equal(report.samples[0].subjects[0].pixels,facePixels);
  assert(report.samples.every(row=>row.subjects.every(entry=>entry.samples>0)));
  assert.notEqual(report.samples[0].subjects[1].color.mean,report.samples[2].subjects[1].color.mean);
  assert.equal(report.subjects[0].measured,4);
  assert(image.rgb.some((byte,index)=>index%3===0 && byte===255));
});

test('readability CLI saves the native camera and light evidence with a scene selector',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-readability-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js'), scene=path.resolve(__dirname,'../examples/silhouette-protection.js');
  execFileSync(process.execPath,[cli,'palette','readability',scene,'--select','{"surface":"courier-face"}',
    '--w','168','--h','110','--px','2','--atmosphere','off','--directions','2','--out',dir]);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'review.json')));
  assert.deepEqual([report.width,report.height,report.samples.length],[84,55,2]);
  assert(report.samples.some(row=>row.subjects[0].samples>0));
  assert(report.samples.every(row=>Number.isFinite(row.camera.yaw)));
  const preview=PNG.raster(path.join(dir,report.files.comparison));
  assert(preview.w>84 && preview.h>110);
});
