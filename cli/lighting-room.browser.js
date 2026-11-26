(() => {
  const element = id => document.getElementById(id);
  const data = lightingRoom, canvas = element('view'), stage = element('stage-label'), status = element('status');
  const rigs = new Map(data.rigs.map(rig=>[rig.id,rig]));
  const picker = element('rig'), carrier = element('carrier'), background = element('background');
  const projection = element('projection');
  const name = value => value[0].toUpperCase()+value.slice(1);
  const range = (value, lo, hi) => Math.max(lo,Math.min(hi,value));
  const wrap = value => ((value+180)%360+360)%360-180;
  const row = (id,group,key,unit) => {
    const slider = element(id);
    return { slider, display:slider.nextElementSibling, group,key,unit };
  };
  const sliders = [
    row('rotation','environment','rotation','°'),row('light-ev','environment','exposureEV',' EV'),
    row('lens','camera','focalLength',' mm'),row('sensor','camera','sensorHeight',' mm'),
    row('distance','camera','distance',''),row('yaw','camera','yaw','°'),row('pitch','camera','pitch','°'),
    row('frame-x','camera',0,'%'),row('frame-y','camera',1,'%'),row('camera-ev','camera','exposureEV',' EV')
  ];
  let current=LightingRoomRig.prepare(rigs.get(data.selected)), renderer, frame;
  function message(value='') { status.textContent=value; }
  function sync() {
    picker.value=current.id;
    background.checked=current.environment.background;
    projection.value=current.camera.projection;
    const source=current.environment.source;
    element('source-name').textContent=typeof source==='string'?LightingRoomRig.presets[source]:source.name;
    for(const {slider,display,group,key,unit} of sliders) {
      const value = typeof key==='number'?current.camera.framing[key]:current[group][key];
      slider.value=value;
      display.value=(unit==='%'?Math.round(value*100):Number(value.toFixed(2)))+unit;
    }
    stage.textContent=name(carrier.value)+' / '+name(current.camera.projection);
  }
  function draw() {
    sync();
    if(frame || !renderer) return;
    frame=requestAnimationFrame(()=>{
      frame=null;
      try {
        renderer.render(current,carrier.value);
        canvas.dataset.ready='true';
      } catch(error) {
        message(error.message);
      }
    });
  }
  function select(id) {
    current=LightingRoomRig.prepare(rigs.get(id));
    message();
    draw();
  }
  function offer(rig) {
    rigs.set(rig.id,rig);
    const previous=Array.from(picker.options).find(option=>option.value===rig.id);
    if(previous) previous.textContent=rig.label;
    else picker.add(new Option(rig.label,rig.id));
  }
  function unusedId(label) {
    const seed = ('rig-'+label.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-')).slice(0,58).replace(/-+$/,'');
    let id=seed, i=1;
    while(rigs.has(id)) id=seed+'-'+(++i);
    return id;
  }
  function bindFile(button,id,read) {
    const input=element(id);
    element(button).onclick=()=>input.click();
    input.onchange=async()=>{
      const file=input.files[0];
      input.value='';
      if(!file) return;
      message('Reading '+file.name+'…');
      try { await read(file); }
      catch(error) { message(error.message); }
    };
  }

  element('title').textContent=data.label;
  document.title=data.label+' · Ink Studio';
  for(const rig of rigs.values()) offer(rig);
  for(const {kind} of data.carriers) carrier.add(new Option(name(kind),kind));
  picker.onchange=()=>select(picker.value);
  carrier.onchange=draw;
  background.onchange=()=>{current.environment.background=background.checked;draw();};
  projection.onchange=()=>{current.camera.projection=projection.value;draw();};
  for(const {slider,group,key} of sliders) slider.oninput=()=>{
    if(typeof key==='number') current.camera.framing[key]=+slider.value;
    else current[group][key]=+slider.value;
    draw();
  };
  element('reset').onclick=()=>{
    current.camera=LightingRoomRig.prepare(rigs.get(current.id)).camera;
    draw();
  };
  bindFile('open-hdr','hdr-file',async file=>{
    if(file.size>HDREnvironment.maxFileBytes) throw new RangeError('HDRI exceeds the room byte budget');
    const image=HDREnvironment.radiance(new Uint8Array(await file.arrayBuffer()));
    current.environment.source=HDREnvironment.embedded(file.name,image);
    message('Imported '+file.name);
    draw();
  });
  bindFile('open-rig','rig-file',async file=>{
    if(file.size>4*1024*1024) throw new RangeError('Rig exceeds the room byte budget');
    let rig=LightingRoomRig.prepare(JSON.parse(await file.text()),HDREnvironment.unembed);
    if(rigs.has(rig.id)) rig={...rig,id:unusedId(rig.label)};
    offer(rig);
    select(rig.id);
    message('Loaded '+rig.label);
  });
  element('save-rig').onclick=()=>{
    const field=element('rig-name'), label=field.value.trim();
    if(!LightingRoomRig.name(label)) {
      message('Enter a name for the rig.');
      field.focus();
      return;
    }
    const rig=LightingRoomRig.prepare({...current,id:unusedId(label),label});
    offer(rig);
    select(rig.id);
    const url=URL.createObjectURL(new Blob([JSON.stringify(rig,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download=rig.id+'.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    field.value='';
    message('Saved '+label);
  };
  let drag;
  canvas.onpointerdown=event=>{
    if(event.button!==0 || drag) return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY};
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove=event=>{
    if(drag?.id!==event.pointerId) return;
    current.camera.yaw=wrap(current.camera.yaw-.45*(event.clientX-drag.x));
    current.camera.pitch=range(current.camera.pitch+.45*(event.clientY-drag.y),-88,88);
    drag.x=event.clientX;
    drag.y=event.clientY;
    draw();
  };
  canvas.onlostpointercapture=event=>{if(drag?.id===event.pointerId)drag=null;};
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();
    const factor=event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1;
    current.camera.distance=range(current.camera.distance*Math.exp(event.deltaY*factor*.0015),.3,80);
    draw();
  },{passive:false});
  try { renderer=RoomRenderer.create(canvas,data); }
  catch(error) { message(error.message); }
  draw();
})();
