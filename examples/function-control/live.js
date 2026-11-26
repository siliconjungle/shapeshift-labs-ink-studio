const $=id=>document.getElementById(id), P=KIT.procedural;
const {spec,groups,controls,defaults,width,height}=lastLight;
const functions=Object.fromEntries(Object.entries(groups).map(([id,definition])=>[id,P.graph.group(definition)]));
const runner=P.graph.create(spec,{groups:functions}), fields=new Map();
const clockFields={
  time:{label:'Time (s)',default:defaults.time,min:0,max:10,step:.05},
  seed:{label:'Seed',default:defaults.seed,min:0,max:255,step:1}
};
let result, position, pending=0;
const schedule=()=>{if(!pending)pending=requestAnimationFrame(draw);};
const element=tag=>document.createElement(tag);
const fmt=value=>Number.isInteger(value)?String(value):value.toFixed(1);

function createFields(definitions,target) {
  for(const [id,field] of Object.entries(definitions)){
    const row=element('div'), label=element('label'), control=element(field.choices?'select':'input');
    label.htmlFor=control.id=id; label.textContent=field.label;
    row.className='field'; row.append(label);
    let readout;
    if(field.choices){
      for(const [name,value] of field.choices)control.add(new Option(name,String(value)));
    }else{
      control.type='range'; control.min=field.min; control.max=field.max; control.step=field.step;
      readout=element('output'); readout.htmlFor.add(id); row.append(readout);
    }
    const value=()=>field.choices?control.value==='true':control.valueAsNumber;
    const update=()=>{if(readout)readout.value=id==='time'?value().toFixed(2):fmt(value());};
    const reset=()=>{control.value=String(field.default);update();};
    control.addEventListener('input',()=>{update();schedule();});
    row.append(control); $(target).append(row);
    fields.set(id,{value,reset});
  }
}
createFields(controls,'settings');
createFields(clockFields,'clock');
const values=()=>Object.fromEntries(Object.keys(controls).map(id=>[id,fields.get(id).value()]));
const clock=()=>Object.fromEntries(Object.keys(clockFields).map(id=>[id,fields.get(id).value()]));

function draw(){
  pending=0;
  try{
    const inputs={...values(),spot:position};
    result=runner.evaluate(inputs,{...clock(),systemSize:[width,height]});
    const {preview,brand,primed,routed,charge,iterations,spot,size,context,pulse}=result.outputs;
    const canvas=$('scene').getContext('2d');
    canvas.putImageData(new ImageData(new Uint8ClampedArray(preview.data),width,height),0,0);
    $('before').textContent=fmt(inputs.start);
    $('primed').textContent=fmt(primed);
    $('routed').textContent=fmt(routed);
    $('charge').textContent=fmt(charge);
    $('branch').textContent=brand?'Storm circuit':'Harbor circuit';
    $('iterations').textContent=iterations+' of '+inputs.limit+' turns'+(charge>=inputs.target?' · target reached':'');
    $('spot').textContent=spot.join(', ')+' px';
    $('size').textContent=size.join(' × ')+' px';
    $('context').textContent=context;
    $('pulse').textContent=pulse.toFixed(3);
    $('error').textContent='';
  }catch(error){$('error').textContent=error.message;}
}
function move(x,y){
  position=[Math.max(0,Math.min(width-1,x)),Math.max(0,Math.min(height-1,y))];
  schedule();
}
$('scene').addEventListener('click',event=>{
  const {left,top,width:w,height:h}=$('scene').getBoundingClientRect();
  move(Math.floor((event.clientX-left)*width/w),Math.floor((event.clientY-top)*height/h));
});
$('scene').addEventListener('keydown',event=>{
  const shifts={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  const shift=shifts[event.key];
  if(!shift)return;
  event.preventDefault(); move(position[0]+shift[0],position[1]+shift[1]);
});
function reset(){
  for(const field of fields.values())field.reset();
  move(...defaults.spot);
}
$('reset').addEventListener('click',reset);
$('save').addEventListener('click',()=>{
  const material=structuredClone(lastLight.saved);
  for(const [id,value] of Object.entries({...values(),spot:position}))material.graph.inputs[id].definition.default=value;
  const timing=clock();
  Object.assign(material.settings,timing);
  if(material.settings.base)material.settings.base.seed=timing.seed;
  const url=URL.createObjectURL(new Blob([JSON.stringify(material,null,2)+'\n'],{type:'application/json'}));
  const link=element('a');link.href=url;link.download='last-light-edited.material.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
reset();
