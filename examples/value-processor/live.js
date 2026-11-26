const $=id=>document.getElementById(id), P=KIT.procedural;
const {spec,saved,settings,processor}=meridian, fields=new Map();
let formula=processor, runner=createRunner(processor), result, scheduled=0;

function createRunner(program){
  return P.graph.create({...spec,nodes:{...spec.nodes,solve:{...spec.nodes.solve,
    inputs:{...spec.nodes.solve.inputs,program}}}});
}
const inputs=()=>Object.fromEntries([...fields].map(([name,field])=>[name,field.control.valueAsNumber]));
const formatted=value=>Number.isInteger(value)?String(value):value.toFixed(1);
const schedule=()=>{if(!scheduled)scheduled=requestAnimationFrame(render);};
function setField(name,value){
  const field=fields.get(name);
  field.control.value=value;
  field.update();
}

function draw(frame){
  const {preview,width,height,score,range,direction,inWindow}=frame.outputs, dial=$('dial');
  if(dial.width!==width)dial.width=width;
  if(dial.height!==height)dial.height=height;
  const buffer=new Uint8ClampedArray(preview.data);
  dial.getContext('2d').putImageData(new ImageData(buffer,width,height),0,0);
  $('extent').textContent=width+' × '+height+' px';
  $('score').textContent=(score*100).toFixed(1)+'%';
  $('range').textContent=range.map(value=>formatted(value)+'°').join(' to ');
  $('vector').textContent='['+direction.map(value=>value.toFixed(3)).join(', ')+']';
  $('state').textContent=inWindow?'Within target':'Outside target';
  $('state').dataset.aligned=String(inWindow);
  $('level').style.width=(score*100)+'%';
  $('error').textContent='';
  result=frame;
}
function render(){
  scheduled=0;
  try{draw(runner.evaluate(inputs()));}
  catch(error){$('error').textContent=error.message;}
}

for(const [name,info] of Object.entries(settings)){
  const field=document.createElement('div'), label=document.createElement('label');
  const control=document.createElement('input'), value=document.createElement('output');
  field.className='field';label.htmlFor=control.id=name;label.textContent=info.label;
  control.type='range';control.min=info.min;control.max=info.max;control.step=info.step;
  value.htmlFor.add(name);
  const update=()=>{value.value=formatted(control.valueAsNumber)+(info.unit??' px');};
  control.addEventListener('input',()=>{update();schedule();});
  field.append(label,value,control);$('controls').append(field);
  fields.set(name,{control,update});
  setField(name,info.default);
}

function apply(program){
  const candidate=createRunner(program);
  const frame=candidate.evaluate(inputs());
  const {outputs}=frame;
  if(outputs.preview.width!==outputs.width||outputs.preview.height!==outputs.height)
    throw new RangeError('Meridian needs the formula dimensions to match the preview');
  draw(frame);
  formula=program;runner=candidate;
}
$('apply').addEventListener('click',()=>{
  try{apply(JSON.parse($('program').value));$('codeError').textContent='';}
  catch(error){$('codeError').textContent=error.message;}
});
$('reset').addEventListener('click',()=>{
  for(const [name,field] of Object.entries(settings))setField(name,field.default);
  $('program').value=JSON.stringify(processor,null,2);
  $('codeError').textContent='';
  apply(processor);
});
$('dial').addEventListener('click',event=>{
  if(!result)return;
  const frame=$('dial').getBoundingClientRect();
  const {width,height}=result.outputs;
  const x=((event.clientX-frame.left)/frame.width-.5)*width;
  const y=((event.clientY-frame.top)/frame.height-.5)*height;
  if(Math.hypot(x,y)>2){
    setField('heading',Math.round(Math.atan2(x,-y)*180/Math.PI));
    schedule();
  }
});
$('save').addEventListener('click',()=>{
  const copy=structuredClone(saved);
  for(const [name,value] of Object.entries(inputs()))copy.graph.inputs[name].definition.default=value;
  copy.graph.nodes.solve.inputs.program=formula;
  const url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;link.download='meridian-edited.material.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$('program').value=JSON.stringify(processor,null,2);
schedule();
