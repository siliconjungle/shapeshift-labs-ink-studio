const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const api = studio.load().KIT.comparison;
const frame = (w,h,values) => ({w,h,rgb:Uint8Array.from(values.flatMap(v => [v,v,v]))});
const first = image => Array.from(image.rgb.filter((_,i)=>i%3===0));

test('one playback state supports seeking, rate, wrap and synchronized view changes', () => {
  const session=api.create({range:[2,6],rate:2});
  const edits=[], remove=session.subscribe(s=>edits.push(s),{immediate:false});
  assert.equal(session.advance(3).time,2);
  session.play();
  assert.equal(session.advance(.75).time,3.5);
  session.update({mode:'swipe',axis:'y',divider:.2,camera:{yaw:.4}});
  assert.deepEqual(edits.at(-1).camera,{yaw:.4});
  assert.equal(edits.at(-1).time,3.5);
  const before=session.snapshot();
  assert(Object.isFrozen(before.camera));
  assert.throws(()=>session.update({mode:'difference',difference:{negative:'red'}}),/six-digit/);
  assert.equal(session.snapshot(),before);
  assert.equal(session.advance(2).time,6);
  assert.equal(session.snapshot().playing,false);
  assert.equal(session.play().time,2);
  session.update({loop:true});
  assert.equal(session.advance(2.5).time,3);
  remove();
  const end=edits.length;
  session.seek(-100);
  assert.equal(edits.length,end);
  assert.equal(session.snapshot().time,2);
});

test('headless side-by-side and swipe retain matching pixels and measure sign in linear light', () => {
  const a=frame(2,2,[0,255,100,70]), b=frame(2,2,[255,0,100,120]);
  assert.deepEqual(first(api.compose(a,b)),[0,255,255,0,100,70,100,120]);
  assert.deepEqual(first(api.compose(a,b,{mode:'swipe'})),[0,0,100,120]);
  assert.deepEqual(first(api.compose(a,b,{mode:'swipe',axis:'y'})),[0,255,100,120]);
  assert.deepEqual(first(api.compose(a,b,{mode:'swipe',divider:0})),first(b));
  assert.deepEqual(first(api.compose(a,b,{mode:'swipe',divider:1})),first(a));
  const style={mode:'difference',difference:{gain:9,deadband:.01,positive:'#ff0000',negative:'#0000ff'}};
  const result=api.compose(a,b,style), signed=api.measure(a,b).values;
  assert.deepEqual(Array.from(result.rgb.slice(0,6)),[255,0,0,0,0,255]);
  assert.deepEqual(Array.from(result.rgb.slice(6,9)),[42,42,42]);
  assert.deepEqual(Array.from(signed.slice(0,3)),[1,-1,0]);
  assert(signed[3]>.1 && signed[3]<.2);
  const rgba={w:1,h:1,rgba:Uint8Array.of(255,23,23,0)};
  assert.equal(api.measure(rgba,frame(1,1,[0]),{channel:'red'}).values[0],0);
  assert.throws(()=>api.compose(a,rgba),/matching dimensions/);
});

test('the existing look comparison CLI can export a swipe or signed difference', t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-comparison-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const cli=path.join(__dirname,'../cli/ink-studio.js');
  const scene=path.join(temp,'world.js'), looks=path.join(temp,'looks.json'), out=path.join(temp,'out.png');
  fs.writeFileSync(scene,`module.exports = ({makeBuilder}) => ({ id:'section',build() {
    const b=makeBuilder(5,[0,0x888888,0xffffff]);
    b.iso(0,0,0,.8,b.P[1],3);
    return b.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:4}});
  } });`);
  fs.writeFileSync(looks,JSON.stringify([{id:'base'},{id:'bright',look:{renderStages:[
    {stage:'frame',stack:{name:'Lift',steps:[{type:'exposure',stops:2}]}}
  ]}}]));
  const render=(...args)=>{
    execFileSync(process.execPath,[cli,'compare',scene,'--looks',looks,'--w','64','--h','48','--out',out,...args],
      {stdio:'pipe'});
    return require('../cli/png').read(out);
  };
  const swipe=render('--comparison','swipe','--divider','.25'), diff=render('--comparison','difference');
  assert.equal(swipe.w,64);
  assert.equal(diff.h,48);
  assert(!Buffer.from(swipe.rgb).equals(Buffer.from(diff.rgb)));
  assert.equal(render('--comparison','side-by-side').w,128);
});

test('WebGL locks different scene cameras, shares time, and presents styled controls and signed overlays',
  {skip:!process.env.INK_TEST_CHROME}, t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-comparison-webgl-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  fs.writeFileSync(path.join(temp,'kit.js'),studio.bundle());
  const file=path.join(temp,'index.html'), moduleURL=pathToFileURL(path.join(__dirname,'../webgl.mjs')).href;
  fs.writeFileSync(file,`<!doctype html><div id="host"></div><pre id="result">pending</pre><script src="./kit.js"></script>
<script type="module">
import {createComparisonRenderer,mountComparisonView} from ${JSON.stringify(moduleURL)};
const result=document.getElementById('result');
try {
  const toolkit={KIT,PixelLook,makeBuilder,makeSculpt,ContributionRules,RenderStages};
  function world(alternate=false,tints=false) {
    const b=makeBuilder(1,[0x101922,0x888888]);
    b.disc(-.7,0,0,[0,0,1],.37,.03,tints?[240,240,240]:[128,128,128],3);
    b.disc(.7,0,0,[0,0,1],.37,.03,tints?[32,32,32]:[128,128,128],3);
    const w=b.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,projection:'orthographic'},radius:4,dither:0});
    if(alternate){
      w.cam={target:[3,2,1],dist:8,yaw:.9,pitch:.4,projection:'perspective'};
      w.anim={zoom:1.4,kick:[.4,.3,.2]};
      w.radius=8;
    }
    return w;
  }
  const a=world(), b=world(true), c=world(true,true), canvas=document.createElement('canvas');
  const comparison=createComparisonRenderer(canvas,{toolkit}), gl=canvas.getContext('webgl2');
  const session=KIT.comparison.create({range:[0,3],time:1,mode:'difference'});
  const times=[];
  const source={left:{world:s=>{times.push(['left',s.time]);return a;},frame:{raw:true}},
    right:{world:s=>{times.push(['right',s.time]);return b;},frame:{raw:true}}};
  const viewport={width:101,height:73};
  function read() {
    const {width:w,height:h}=canvas, raw=new Uint8Array(w*h*4), rgb=new Uint8Array(w*h*3);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,raw);
    const error=gl.getError();
    if(error)throw new Error('WebGL error '+error);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const from=4*((h-1-y)*w+x),to=3*(y*w+x);
      rgb.set(raw.subarray(from,from+3),to);
    }
    return {w,h,rgb};
  }
  const reference=comparison.render(source,session.snapshot(),viewport);
  const unchanged=read();
  const aligned=unchanged.rgb.every((value,i)=>Math.abs(value-unchanged.rgb[i-i%3])<=1);
  source.right.world=s=>{times.push(['right',s.time]);return c;};
  const style={mode:'swipe',axis:'y',divider:1,time:2};
  comparison.render(source,style,viewport);
  const left=read();
  comparison.present({...style,divider:0},viewport);
  const right=read();
  comparison.present({...style,divider:.36},viewport);
  const expectedSwipe=KIT.comparison.compose(left,right,{...style,divider:.36}), actualSwipe=read();
  const swipe=expectedSwipe.rgb.every((value,i)=>value===actualSwipe.rgb[i]);
  const settings={mode:'difference',difference:{gain:6,context:.35}};
  comparison.present(settings,viewport);
  const expected=KIT.comparison.compose(left,right,settings), difference=read();
  const parallel=expected.rgb.every((value,i)=>Math.abs(value-difference.rgb[i])<=1);
  const pixel=(img,x,y)=>Array.from(img.rgb.subarray(3*(x+y*img.w),3*(x+y*img.w)+3));
  const warm=pixel(difference,35,36), cool=pixel(difference,65,36);
  const other=comparison.render(source,{mode:'side-by-side',cameraSource:'right',time:2.5},viewport), side=read();
  const gutter=pixel(side,50,30), calls=times.slice();
  comparison.dispose();
  const ui=mountComparisonView(document.getElementById('host'),{toolkit,session,...source,
    labels:{title:'Custom comparison',left:'Baseline',right:'Candidate'},controls:{axis:false},
    defaultStyles:false,stylesheet:'.stage{position:relative}canvas{display:block;width:220px;height:120px}.divider{position:absolute}[hidden]{display:none}'});
  const root=host.shadowRoot, named=part=>root.querySelector('[part="'+part+'"]');
  ui.render();
  named('mode').value='swipe';named('mode').dispatchEvent(new Event('change'));
  ui.render();
  const handle=named('divider');
  handle.focus();
  handle.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',key:'ArrowRight',bubbles:true,cancelable:true}));
  handle.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowRight',key:'ArrowRight',bubbles:true}));
  ui.input.divider.setBindings('divider','next',['key:KeyD']);
  handle.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',bubbles:true,cancelable:true}));
  handle.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true,cancelable:true}));
  named('playback').click();
  session.advance(.5);
  const input=named('scrubber');
  ui.render();
  const chosen=[root.querySelector('h1').textContent,root.querySelectorAll('style').length,
    named('axis-control').hidden,session.snapshot().divider,Number(input.value),named('divider').getAttribute('aria-valuenow')];
  ui.destroy();
  result.textContent=encodeURIComponent(JSON.stringify({aligned,swipe,parallel,warm,cool,gutter,calls,chosen,
    reference:reference.yaw,other:other.yaw,disposed:root.childElementCount}));
} catch(error){result.textContent=encodeURIComponent(JSON.stringify({error:error.stack}));}
</script>`);
  const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
    '--allow-file-access-from-files','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage',
    '--user-data-dir='+path.join(temp,'profile'),'--dump-dom',pathToFileURL(file).href],
    {encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  const output=/<pre id="result">([^<]*)<\/pre>/.exec(html)?.[1];
  assert(output && output!=='pending','comparison browser fixture did not finish');
  const r=JSON.parse(decodeURIComponent(output));
  assert(!r.error,r.error);
  assert(r.aligned && r.swipe && r.parallel,JSON.stringify(r));
  assert(r.warm[0]>r.warm[2] && r.cool[2]>r.cool[0],JSON.stringify([r.warm,r.cool]));
  assert.deepEqual(r.gutter,[23,31,41]);
  assert.deepEqual(r.calls,[['left',1],['right',1],['left',2],['right',2],['left',2.5],['right',2.5]]);
  assert.deepEqual(r.chosen,['Custom comparison',1,true,.52,1.5,'52']);
  assert.equal(r.reference,0);
  assert(Math.abs(r.other-.9)<1e-6);
  assert.equal(r.disposed,0);
});
