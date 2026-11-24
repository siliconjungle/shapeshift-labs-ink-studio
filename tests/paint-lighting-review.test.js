const assert=require('node:assert/strict');
const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');

const {KIT,makeBuilder}=ink.load();
const cam={target:[0,0,0],dist:4,projection:'orthographic',pitch:0,yaw:0,sway:0};
const view={w:80,h:60,px:1,raw:true};
const rgb=(frame,p)=>Array.from(frame.rgb.subarray(p*3,p*3+3));

test('paint review uses one native owner grid for mesh, retained splat pigment and packed fallback',()=>{
  const mesh=KIT.sceneMeshes.create({id:'sign',positions:[-.31,-.55,.03,.76,-.55,.03,-.31,.55,.03,.76,.55,.03],
    indices:[0,1,2,1,3,2],uvs:[0,1,1,1,0,0,1,0],
    materials:[{id:'ink',texture:{width:2,height:1,pixels:Uint8Array.of(36,119,152,255,161,69,46,255)}}]});
  const B=makeBuilder(3,[0x111c2a,0x564529,0xa7652b]);
  B.disc(-.85,0,0,[0,0,1],.42,.02,B.P[1],3);
  B.describeAlbedo(0,1,'#c48b54');
  B.describeSplats(0,1,{object:'painted'});
  B.disc(1.17,0,0,[0,0,1],.29,.02,B.P[2],3);
  B.describeSplats(1,2,{object:'old-scan'});
  const world=B.finish({cam,meshes:[mesh],dither:0,shotLighting:{exposureEV:-1}});
  const result=ink.reviewPaintLighting(world,{view,steps:3});
  assert.deepEqual(result.authored.rgb,ink.render(world,view).rgb);
  assert(result.report.coverage.retainedPaint>0);
  assert(result.report.coverage.packedColor>0);
  assert(result.report.coverage.relightable>0);
  for (const frame of result.sweep) assert.deepEqual(frame.alpha,result.neutral.alpha);
  assert.notDeepEqual(result.sweep[0].rgb,result.sweep[2].rgb);
  assert.deepEqual(result.report.sweep.frames.map(row=>row.azimuth),[-65,0,65]);
  assert(result.report.sweep.frames.every(row=>row.changedPixels>0));

  const sign=ink.reviewPaintLighting(world,{view,steps:3,subject:{object:'sign'}});
  assert.equal(sign.report.coverage.retainedPaint,sign.report.coverage.visible);
  assert.equal(sign.report.coverage.packedColor,0);
  const left=sign.neutral.alpha.findIndex((a,p)=>a>0 && rgb(sign.neutral,p).join(',')==='36,119,152');
  assert(left>=0);
  assert([...sign.neutral.alpha].some((a,p)=>a>0 && rgb(sign.neutral,p).join(',')==='161,69,46'));
  assert.notDeepEqual(rgb(sign.neutral,left),rgb(sign.authored,left));
  assert.throws(()=>ink.reviewPaintLighting(world,{view,subject:{object:'unknown'}}),/no visible/);
});

test('the CLI captures committed SDF paint and writes separate PNGs and the light sweep',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-lighting-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const scene=path.join(directory,'scene.json'), output=path.join(directory,'review');
  fs.writeFileSync(scene,JSON.stringify({id:'painted-enamel',style:'slate',camera:cam,solids:[
    {id:'enamel',kind:'box',at:[0,0,0],half:[.8,.6,.24],res:.09,mat:'stone',
      surfaceState:{charts:{front:{origin:[-.8,-.6,.24],u:[1.6,0,0],v:[0,1.2,0],depth:.06,stamps:[
        {channel:'pigment',value:{swatch:'paint',color:'#29a68e'},brush:{kind:'rect',min:[.18,.18],max:[.83,.83]}}
      ]}}}}
  ]}));
  execFileSync(process.execPath,[path.join(__dirname,'../cli/ink-studio.js'),'pixel-art','paint-lighting',scene,
    '--subject','enamel','--sdf-assist','on','--w','80','--h','60','--t','0.7','--steps','3','--out',output],{stdio:'pipe'});
  const report=JSON.parse(fs.readFileSync(path.join(output,'review.json'),'utf8'));
  assert.equal(report.time,.7);
  assert.equal(report.poseTime,.7);
  assert.equal(report.coverage.visible,report.coverage.retainedPaint);
  const neutral=PNG.raster(path.join(output,report.files.neutral));
  assert.deepEqual(Array.from(neutral.data.subarray((30*80+40)*4,(30*80+40)*4+4)),[41,166,142,255]);
  for (const name of ['authored','light-01','light-02','light-03'])
    assert.equal(PNG.layout(path.join(output,report.files[name])).w,80);
  assert(fs.readFileSync(path.join(output,report.files.sweep)).includes(Buffer.from('acTL')));
  assert(PNG.layout(path.join(output,report.files.comparison)).w>80);
});
