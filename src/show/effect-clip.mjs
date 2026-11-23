/* Cue and lane edits all evaluate a single native graph frame on the Node host. */
const element=id=>document.getElementById(id);
const ui=Object.fromEntries([
  'title','save','export','back','play','next','loop','clock','time','ruler','cue-controls','cue','cue-at','cue-slider','goto','status',
  'zoom','pins','passes','parameter-panel','parameters','lane-panel','lane-tabs','curve','lane-caption','key-list','add-key'
].map(id=>[id,element(id)]));
const context=ui.curve.getContext('2d');
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const numberText=(value,digits=3)=>Number(value.toFixed(digits)).toString();
let key, meta, edit, selectedLane, rate, time=0, playing=false, lastTick;
let pending=false, busy=false, serial=0, lastPlayFrame, measured, epoch=0, queuedDownload;
let cards=new Map();

function status(text,error=false){
  ui.status.textContent=text;
  ui.status.dataset.error=error;
}

async function post(route,body) {
  const response=await fetch(route,{method:'POST',headers:{
    'Content-Type':'application/json','X-Ink-Session':key
  },body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error);
  return result;
}

function resize(frame) {
  if(!frame.image||!frame.width)return;
  const zoom=ui.zoom.value==='auto'
    ? Math.max(1,Math.min(8,Math.floor((frame.view.clientWidth-14)/frame.width)))
    : Number(ui.zoom.value);
  frame.image.style.width=frame.width*zoom+'px';
}
function showCards(pins) {
  cards=new Map(pins.map(name=>{
    const figure=document.createElement('figure'), caption=document.createElement('figcaption');
    const size=document.createElement('span'),view=document.createElement('div');
    view.className='view';
    caption.append(meta.previews[name].label,size);
    figure.append(caption,view);
    figure.dataset.pass=name;
    return [name,{figure,size,view}];
  }));
  ui.passes.replaceChildren(...Array.from(cards.values(),card=>card.figure));
}
function display(result) {
  const {report,artifacts}=result;
  measured=report;
  const actual=Object.fromEntries(artifacts.map(asset=>[asset.file,asset]));
  for(const name of report.pins){
    const card=cards.get(name);
    if(!card)continue;
    const info=report.previews[name],asset=actual[info.file];
    const {width,height}=info.value??{};
    if(asset?.format==='png'){
      if(!card.image){
        card.image=document.createElement('img');
        card.image.alt=meta.previews[name].label;
        card.view.replaceChildren(card.image);
      }
      card.width=width;
      card.size.textContent=width+' × '+height;
      card.image.src='data:image/png;base64,'+asset.data;
      resize(card);
    } else {
      card.image=null;
      const data=document.createElement('pre');
      data.textContent=asset?.format==='json'?asset.data:JSON.stringify(info.value,null,2);
      card.size.textContent='';
      card.view.replaceChildren(data);
    }
    card.figure.dataset.time=report.time.toString();
  }
  const picture=Math.min(Math.floor(report.time*rate+1e-8),Math.ceil(meta.duration*rate)-1);
  ui.clock.textContent=numberText(report.time)+' s · frame '+picture;
  status(report.passed===false?'Graph assertions failed.':'',report.passed===false);
  drawLane();
}

function request(){
  pending=true;
  if(!busy)void flush();
}
function leaveRequest(){
  busy=false;
  if(queuedDownload){
    const next=queuedDownload;
    queuedDownload=undefined;
    void download(next);
  } else if(pending)void flush();
}
async function flush() {
  if(!pending||busy)return;
  pending=false;
  busy=true;
  const stamp=epoch, version=serial;
  const payload={time,edit};
  try {
    const result=await post('/preview',payload);
    if(stamp===epoch&&(playing||version===serial))display(result);
  } catch(error) {
    if(stamp===epoch&&(playing||version===serial)){
      status(error.message,true);
      if(playing)stop();
    }
  } finally {
    leaveRequest();
  }
}

function seek(value) {
  time=clamp(value,0,meta.duration);
  ui.time.value=time;
  serial++;
  drawLane();
  request();
}
function redrawEdit() {
  serial++;
  epoch++;
  drawLane();
  request();
}
function stop(){
  playing=false;
  lastTick=undefined;
  ui.play.textContent='Play';
}
function playback(now){
  if(!playing)return;
  lastTick??=now;
  const next=time+(now-lastTick)/1000;
  lastTick=now;
  if(next>=meta.duration&&!ui.loop.checked){
    stop();
    seek(meta.duration);
    return;
  }
  time=next%meta.duration;
  ui.time.value=time;
  const frame=Math.floor(time*rate+1e-8);
  if(frame!==lastPlayFrame){
    lastPlayFrame=frame;
    serial++;
    request();
  }
  requestAnimationFrame(playback);
}

function showCues(){
  const markers=Object.keys(meta.cues).map(name=>{
    const marker=document.createElement('button');
    marker.type='button';
    marker.textContent='◆';
    marker.title=meta.cues[name].label;
    marker.setAttribute('aria-label','Jump to '+meta.cues[name].label);
    marker.style.left=(100*edit.cues[name]/meta.duration)+'%';
    marker.dataset.cue=name;
    marker.setAttribute('aria-pressed',String(name===ui.cue.value));
    marker.addEventListener('click',()=>{
      stop();
      ui.cue.value=name;
      cueControls();
      seek(edit.cues[name]);
    });
    return marker;
  });
  ui.ruler.replaceChildren(...markers);
}
function cueControls(){
  const name=ui.cue.value;
  ui['cue-at'].value=numberText(edit.cues[name],6);
  ui['cue-slider'].value=edit.cues[name];
  showCues();
}
function changeCue(value){
  if(!Number.isFinite(value))return;
  edit.cues[ui.cue.value]=value;
  cueControls();
  redrawEdit();
}

function controls(){
  for(const [name,row] of Object.entries(meta.parameters)){
    const field=document.createElement('label'),title=document.createElement('span');
    const slider=document.createElement('input'),value=document.createElement('input');
    title.textContent=row.label;
    slider.type='range';
    value.type='number';
    value.setAttribute('aria-label',row.label+' value');
    for(const input of [slider,value])Object.assign(input,{min:row.min,max:row.max,step:row.step,value:edit.parameters[name]});
    slider.addEventListener('input',()=>{
      value.value=slider.value;
      edit.parameters[name]=slider.valueAsNumber;
      redrawEdit();
    });
    value.addEventListener('change',()=>{
      if(!Number.isFinite(value.valueAsNumber))return;
      const next=clamp(value.valueAsNumber,row.min,row.max);
      value.value=slider.value=next;
      edit.parameters[name]=next;
      redrawEdit();
    });
    field.className='control';
    field.append(title,slider,value);
    ui.parameters.append(field);
  }
}
const keyTime=row=>row.cue===undefined?row.at:edit.cues[row.cue]+(row.offset??0);
const easing={
  linear:u=>u,smooth:u=>u*u*(3-2*u),step:()=>0,'step-start':u=>u>0?1:0,
  'in-sine':u=>1-Math.cos(u*Math.PI/2),'out-sine':u=>Math.sin(u*Math.PI/2),
  'in-out-sine':u=>(1-Math.cos(u*Math.PI))/2
};
function interpolate(a,b,f){
  const blend=easing[a.ease??'smooth'](f);
  return f===1?b.value:a.value+(b.value-a.value)*blend;
}
function laneValue(rows){
  const next=rows.findIndex(row=>keyTime(row)>time);
  if(next===0)return rows[0].value;
  if(next===-1)return rows.at(-1).value;
  const a=rows[next-1],b=rows[next],start=keyTime(a),end=keyTime(b);
  return interpolate(a,b,(time-start)/(end-start));
}
function drawLane(){
  if(!selectedLane)return;
  const {min,max}=meta.lanes[selectedLane], rows=edit.lanes[selectedLane], width=Math.max(1,ui.curve.clientWidth),height=115;
  ui.curve.width=width;
  ui.curve.height=height;
  const x=t=>8+(width-16)*t/meta.duration,y=value=>height-9-(height-18)*(value-min)/(max-min);
  context.strokeStyle='#354553';
  for(const value of [min,(min+max)/2,max]){
    context.beginPath();context.moveTo(0,y(value));context.lineTo(width,y(value));context.stroke();
  }
  for(const cue of Object.values(edit.cues)){
    context.beginPath();context.moveTo(x(cue),0);context.lineTo(x(cue),height);context.stroke();
  }
  const draw=(px,py,size)=>context.fillRect(px-size/2,py-size/2,size,size);
  context.strokeStyle='#a0e6ce';
  context.beginPath();
  context.moveTo(x(0),y(rows[0].value));
  context.lineTo(x(keyTime(rows[0])),y(rows[0].value));
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],start=keyTime(a),end=keyTime(b);
    for(let j=1;j<=24;j++){
      const u=j/24;
      context.lineTo(x(start+(end-start)*u),y(interpolate(a,b,u)));
    }
  }
  context.lineTo(x(meta.duration),y(rows.at(-1).value));
  context.stroke();
  context.fillStyle='#d7f1ce';
  for(const row of rows)draw(x(keyTime(row)),y(row.value),5);
  context.strokeStyle='#ffac76';
  context.beginPath();context.moveTo(x(time),0);context.lineTo(x(time),height);context.stroke();
  const active=measured?.lanes[selectedLane];
  ui['lane-caption'].textContent=active===undefined?'':numberText(active)+' at '+numberText(measured.time)+' s';
}

function selectLane(name) {
  selectedLane=name;
  for(const tab of ui['lane-tabs'].children)tab.setAttribute('aria-pressed',String(tab.dataset.lane===name));
  renderKeys();
  drawLane();
}
function renderKeys() {
  const lane=meta.lanes[selectedLane],keys=edit.lanes[selectedLane];
  const option=(values,selected)=>new Option(...values, false, selected);
  const number=(value,description)=>{
    const field=document.createElement('input');
    Object.assign(field,{type:'number',step:'any',value});
    field.setAttribute('aria-label',description);
    return field;
  };
  ui['key-list'].replaceChildren(...keys.map((row,i)=>{
    const cells=[document.createElement('select'),number(row.cue===undefined?row.at:row.offset??0,'Key time or offset'),
      number(row.value,'Key value'),document.createElement('select'),document.createElement('button')];
    const [anchor,at,value,ease,remove]=cells;
    anchor.setAttribute('aria-label','Key anchor');
    anchor.add(option(['Absolute time',''],row.cue===undefined));
    for(const [name,cue] of Object.entries(meta.cues))anchor.add(option([cue.label,name],name===row.cue));
    for(const name of meta.eases)ease.add(option([name,name],name===(row.ease??'smooth')));
    ease.setAttribute('aria-label','Key easing');
    anchor.addEventListener('change',()=>{
      const time=keyTime(keys[i]), cue=anchor.value, {value,ease}=keys[i];
      keys[i]={value,...(ease&&{ease}),...(cue?{cue,offset:time-edit.cues[cue]}:{at:time})};
      renderKeys();
      redrawEdit();
    });
    at.addEventListener('change',()=>{
      if(!Number.isFinite(at.valueAsNumber))return;
      keys[i][keys[i].cue===undefined?'at':'offset']=at.valueAsNumber;
      redrawEdit();
    });
    Object.assign(value,{min:lane.min,max:lane.max});
    value.addEventListener('change',()=>{
      if(!Number.isFinite(value.valueAsNumber))return;
      keys[i].value=clamp(value.valueAsNumber,lane.min,lane.max);
      value.value=keys[i].value;
      redrawEdit();
    });
    ease.addEventListener('change',()=>{keys[i].ease=ease.value;redrawEdit();});
    remove.textContent='×';
    remove.setAttribute('aria-label','Remove key '+(i+1));
    remove.disabled=keys.length===1;
    remove.addEventListener('click',()=>{keys.splice(i,1);renderKeys();redrawEdit();});
    const tr=document.createElement('tr');
    for(const control of cells)tr.insertCell().append(control);
    return tr;
  }));
}
function pinControls() {
  ui.pins.replaceChildren(...Object.entries(meta.previews).map(([name,{label}])=>{
    const entry=document.createElement('label'), pin=document.createElement('input');
    pin.type='checkbox';
    pin.checked=edit.pins.includes(name);
    pin.disabled=pin.checked?edit.pins.length===1:edit.pins.length>=8;
    pin.addEventListener('change',()=>{
      edit.pins=pin.checked?[...edit.pins,name]:edit.pins.filter(id=>id!==name);
      pinControls();
      showCards(edit.pins);
      redrawEdit();
    });
    entry.append(pin,label);
    return entry;
  }));
}
async function download(kind) {
  stop();
  if(busy){queuedDownload=kind;return;}
  busy=true;
  try {
    const {document:serialized,filename}=await post('/download',{kind,edit});
    const url=URL.createObjectURL(new Blob([JSON.stringify(serialized,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Downloaded '+filename+'.');
  } catch(error) {status(error.message,true);}
  finally{leaveRequest();}
}

async function start(){
  const response=await fetch('/session');
  if(!response.ok)throw new Error('Could not open effect clip.');
  const read=await response.json();
  key=read.key;
  meta=read.state;
  rate=meta.fps.numerator/meta.fps.denominator;
  edit={
    cues:Object.fromEntries(Object.entries(meta.cues).map(([name,row])=>[name,row.at])),
    parameters:Object.fromEntries(Object.entries(meta.parameters).map(([name,row])=>[name,row.default])),
    lanes:Object.fromEntries(Object.entries(meta.lanes).map(([name,row])=>[name,row.keys])),
    pins:meta.pins.slice()
  };
  document.title=meta.title+' · Effect clip';
  ui.title.textContent=meta.title;
  ui.time.max=meta.duration;
  ui['cue-slider'].max=meta.duration;
  ui['cue-at'].max=meta.duration;
  ui['cue-controls'].hidden=!Object.keys(edit.cues).length;
  for(const [name,row] of Object.entries(meta.cues))ui.cue.add(new Option(row.label,name));
  if(!ui['cue-controls'].hidden)cueControls();
  ui['parameter-panel'].hidden=!Object.keys(meta.parameters).length;
  controls();
  ui['lane-panel'].hidden=!Object.keys(meta.lanes).length;
  for(const [name,row] of Object.entries(meta.lanes)){
    const tab=document.createElement('button');
    tab.type='button';
    tab.textContent=row.label;
    tab.dataset.lane=name;
    tab.addEventListener('click',()=>selectLane(name));
    ui['lane-tabs'].append(tab);
  }
  if(!ui['lane-panel'].hidden)selectLane(Object.keys(meta.lanes)[0]);
  pinControls();
  showCards(edit.pins);
  ui.cue.addEventListener('change',cueControls);
  ui['cue-at'].addEventListener('change',()=>changeCue(ui['cue-at'].valueAsNumber));
  ui['cue-slider'].addEventListener('input',()=>changeCue(ui['cue-slider'].valueAsNumber));
  ui.goto.addEventListener('click',()=>{stop();seek(edit.cues[ui.cue.value]);});
  ui.time.addEventListener('input',()=>{stop();seek(ui.time.valueAsNumber);});
  ui.play.addEventListener('click',()=>{
    if(playing){stop();return;}
    if(time>=meta.duration)seek(0);
    playing=true;
    lastPlayFrame=undefined;
    ui.play.textContent='Pause';
    requestAnimationFrame(playback);
  });
  ui.back.addEventListener('click',()=>{stop();seek((Math.ceil(time*rate-1e-8)-1)/rate);});
  ui.next.addEventListener('click',()=>{stop();seek((Math.floor(time*rate+1e-8)+1)/rate);});
  ui.zoom.addEventListener('change',()=>cards.forEach(resize));
  window.addEventListener('resize',()=>{cards.forEach(resize);drawLane();});
  ui['add-key'].addEventListener('click',()=>{
    const keys=edit.lanes[selectedLane];
    if(keys.some(row=>Math.abs(keyTime(row)-time)<1e-9))return status('A key already occupies this time.');
    if(keys.length>=128)return status('This lane already has 128 keys.');
    const value=laneValue(keys);
    keys.push({at:time,value});
    keys.sort((a,b)=>keyTime(a)-keyTime(b));
    renderKeys();
    redrawEdit();
  });
  ui.save.addEventListener('click',()=>void download('clip'));
  ui.export.addEventListener('click',()=>void download('group'));
  seek(0);
}
start().catch(error=>status(error.message,true));
