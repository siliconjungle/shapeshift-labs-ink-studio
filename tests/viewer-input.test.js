const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const studio=require('..');

test('browser input scopes devices, rebinds actions, and clears held input across focus changes',
  {skip:!process.env.INK_TEST_CHROME},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-viewer-input-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const toolkit=path.join(dir,'toolkit.js'), page=path.join(dir,'input.html');
  const moduleURL=pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href;
  fs.writeFileSync(toolkit,studio.bundle());
  fs.writeFileSync(page,`<!doctype html><meta charset="utf-8">
  <canvas id="one"></canvas><div id="host"></div><input id="text"><pre id="result">pending</pre>
  <script src="./toolkit.js"></script><script type="module">
  import {createViewerInput,createRenderer} from ${JSON.stringify(moduleURL)};
  const result=document.querySelector('#result');
  const assert=(value,message)=>{if(!value)throw Error(message);};
  try{
    const one=document.querySelector('#one'), root=document.querySelector('#host').attachShadow({mode:'open'});
    root.innerHTML='<canvas></canvas>';
    const two=root.querySelector('canvas'), text=document.querySelector('#text');
    const contexts={scene:{
      move:['key:KeyW',{input:'pad:LeftX',deadZone:.2}],
      boost:[{input:'key:KeyW',modifiers:['Shift']}],
      select:['key:Enter','pad:South','mouse:Right','touch:Contact','pen:Tip'],
      drag:[{input:'touch:DragX',deadZone:.1}],
      zoom:['wheel:Y'],
      tab:['key:Tab']
    },menu:{accept:['key:KeyW','pad:South']}};
    const pad={id:'Test controller',mapping:'standard',axes:[0],buttons:[{value:0}]};
    let connected=true;
    const events=[], pointer=[];
    const options={contexts,motionScale:20,readGamepads:()=>connected?[pad]:[]};
    const renderer=createRenderer(one,{toolkit:{KIT,PixelLook},input:{...options,onAction:row=>events.push(row)}});
    const a=renderer.input, b=createViewerInput(two,{...options,toolkit:KIT,onPointer:row=>pointer.push(row)});
    const key=(target,type,code,options={})=>target.dispatchEvent(new KeyboardEvent(type,
      {code,bubbles:true,composed:true,cancelable:true,...options}));
    const point=(type,device,id,x,opts={})=>two.dispatchEvent(new PointerEvent(type,
      {pointerType:device,pointerId:id,clientX:x,clientY:20,button:0,bubbles:true,composed:true,cancelable:true,...opts}));
    assert(one.tabIndex===0&&two.tabIndex===0,'surfaces in tab order');
    assert(a.focus(),'first focus');
    assert(!key(one,'keydown','KeyW'),'bound key stops native default');
    assert(a.poll().values.move===1&&!b.poll().focused,'isolated keyboard action');
    key(one,'keydown','ShiftLeft',{shiftKey:true});
    let frame=a.poll();
    assert(frame.values.boost===1&&frame.released.includes('move'),'live modifier chord');
    key(one,'keyup','ShiftLeft');
    assert(a.poll().values.move===1,'unmodified hold restored');
    assert(key(one,'keydown','Tab'),'Tab keeps its native default');
    pad.axes[0]=-.6;pad.buttons[0].value=1;
    assert(a.poll().values.select===1,'standard gamepad button');
    assert(b.focus(),'shadow surface focus');
    assert(a.poll().released.includes('select')&&a.poll().values.move===0,'blur cleared previous surface');
    assert(b.poll().values.select===0&&b.poll().values.move===0,'held pad controls do not transfer');
    pad.axes[0]=0;pad.buttons[0].value=0;b.poll();
    pad.axes[0]=-.6;pad.buttons[0].value=1;
    frame=b.poll();
    assert(frame.values.move<-.49&&frame.values.select===1,'neutral rearmed button and axis');
    connected=false;
    assert(b.poll().released.includes('select'),'disconnect releases held button');
    text.focus();key(text,'keydown','KeyW');
    assert(!b.poll().focused&&b.poll().values.move===0,'text entry owns focus');
    assert(b.focus(),'restore shadow focus');
    key(two,'keydown','KeyW');
    try{b.setBindings('scene','move',['key:Enter']);throw Error('conflicting profile accepted');}
    catch(error){assert(error.message.includes('already'),'conflict is rejected');}
    assert(b.poll().values.move===1,'conflict leaves active bindings intact');
    const saved=b.setBindings('scene','move',['key:KeyJ']);
    assert(b.poll().released.includes('move'),'successful remap releases held action');
    assert(saved.scene.move[0].input==='key:KeyJ'&&JSON.parse(JSON.stringify(saved)).scene.move.length===1,'profile is serializable');
    key(two,'keydown','KeyW',{repeat:true});
    key(two,'keydown','KeyJ');
    assert(b.poll().values.move===1,'replacement key activates');
    b.setContext('menu');key(two,'keydown','KeyW');key(two,'keyup','KeyW');
    frame=b.poll();
    assert(frame.pressed.includes('accept')&&frame.released.includes('accept'),'short tap retained within poll');
    b.setContext('scene');
    assert(!point('pointerdown','touch',17,20),'touch starts mapped action');
    point('pointermove','touch',17,21);
    point('pointermove','touch',17,23);
    frame=b.poll();
    assert(frame.values.select===1&&frame.values.drag>.05&&frame.values.drag<.06,'touch deltas accumulate before dead zone');
    assert(b.poll().values.drag===0,'motion is consumed');
    point('pointercancel','touch',17,23);
    assert(pointer.at(-1).phase==='cancel'&&b.poll().values.select===0,'touch cancellation releases');
    point('pointerdown','mouse',1,24,{button:2});point('pointerup','mouse',1,24,{button:2});
    frame=b.poll();
    assert(frame.pressed.includes('select')&&frame.released.includes('select'),'mouse right click maps to same action');
    const wheel=new WheelEvent('wheel',{deltaY:-1,deltaMode:1,cancelable:true});
    two.dispatchEvent(wheel);
    assert(wheel.defaultPrevented&&b.poll().values.zoom===-.8,'wheel line units and signed impulse');
    point('pointerdown','pen',9,20);
    window.dispatchEvent(new Event('blur'));
    assert(!b.poll().focused&&b.poll().values.select===0&&pointer.at(-1).phase==='cancel','window blur cancels a pen drag');
    window.dispatchEvent(new Event('focus'));
    b.dispose();renderer.dispose();
    assert(!one.hasAttribute('tabindex')&&!two.hasAttribute('tabindex'),'disposal restores tab order');
    assert(events.some(row=>row.device==='gamepad'&&row.phase==='press'),'device events report source');
    result.textContent='PASS';
  }catch(error){result.textContent=encodeURIComponent(error.stack);}
  </script>`);
  const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
    '--allow-file-access-from-files','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage',
    '--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(page).href],
  {encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  const result=/<pre id="result">([^<]*)<\/pre>/.exec(html)?.[1];
  assert.equal(result,'PASS',result&&decodeURIComponent(result));
});
