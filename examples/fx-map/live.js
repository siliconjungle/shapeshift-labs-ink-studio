const $=id=>document.getElementById(id), P=KIT.procedural;
const {spec,saved,settings}=brocade, original=spec.nodes.weave.inputs.map, fields=new Map();
let map=original, runner=createRunner(original), frame, view='color', repeat=1, selected=null, scheduled=0;

function createRunner(map){
  return P.graph.create({...spec,nodes:{...spec.nodes,weave:{...spec.nodes.weave,inputs:{...spec.nodes.weave.inputs,map}}}});
}
const values=()=>Object.fromEntries([...fields].map(([id,field])=>[id,field.get()]));
const schedule=()=>{if(!scheduled)scheduled=requestAnimationFrame(draw);};

for(const [id,{label,default:value,min,max,step,choices}] of Object.entries(settings)){
  const row=document.createElement('div'), caption=document.createElement('label');
  const control=document.createElement(choices?'select':'input'), readout=choices?null:document.createElement('output');
  row.className='field'; caption.htmlFor=control.id=id; caption.textContent=label; row.append(caption);
  if(choices)for(const [name,choice] of choices)control.add(new Option(name,String(choice)));
  else{
    control.type='range';control.min=min;control.max=max;control.step=step;
    readout.htmlFor.add(id);row.append(readout);
  }
  const update=()=>{if(readout)readout.value=step===1?control.value:control.valueAsNumber.toFixed(2);};
  const reset=()=>{control.value=String(value);update();};
  control.addEventListener('input',()=>{update();schedule();});
  const get=()=>choices?control.value==='true':control.valueAsNumber;
  row.append(control);$('controls').append(row);fields.set(id,{get,reset});
  reset();
}

function inspect(){
  const {layout,stampId}=frame.outputs, width=stampId.raster.width,height=stampId.raster.height;
  const s=selected&&layout.stamps[stampId.raster.data[(selected[1]%height)*width+(selected[0]%width)]-1];
  $('count').textContent=layout.stamps.length;
  $('visits').textContent=layout.visits;
  $('selected').textContent=s?.pattern??(selected?'Background':'Click the textile');
  $('scope').textContent=s?[s.depth,s.quadrant,s.iteration].join(' · '):'—';
  $('stampSeed').textContent=s?.seed??'—';
  $('path').textContent=s?.path??'';
  const marker=$('marker');marker.hidden=!selected;
  if(selected){
    marker.style.left=100*(selected[0]+.5)/(width*repeat)+'%';
    marker.style.top=100*(selected[1]+.5)/(height*repeat)+'%';
  }
}
function displayMap(outputs){
  const {preview,coverage,stampId}=outputs, {width,height}=preview;
  if(view==='color')return preview.data;
  const rgba=new Uint8ClampedArray(width*height*4);
  for(let i=0,k=0;i<width*height;i++,k+=4){
    const id=stampId.raster.data[i], covered=Math.round(coverage.raster.data[i]*255);
    const rgb=view==='coverage'?[covered,covered,covered]:id?
      [55+(id*107)%198,50+(id*73)%199,70+(id*23)%168]:[22,25,38];
    rgba.set(rgb,k);rgba[k+3]=255;
  }
  return rgba;
}
function paint(){
  if(!frame)return;
  const {preview,petal}=frame.outputs, {width,height}=preview, canvas=$('weave'), source=$('petalPreview');
  const image=new ImageData(new Uint8ClampedArray(displayMap(frame.outputs)),width,height);
  canvas.width=width*repeat;canvas.height=height*repeat;
  const ctx=canvas.getContext('2d');
  for(let y=0;y<repeat;y++)for(let x=0;x<repeat;x++)ctx.putImageData(image,x*width,y*height);
  source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(petal.data),petal.width,petal.height),0,0);
  inspect();
}
function draw(){
  scheduled=0;
  try{frame=runner.evaluate(values());paint();$('error').textContent='';}
  catch(error){$('error').textContent=error.message;}
}
function apply(next){
  const candidate=createRunner(next), result=candidate.evaluate(values());
  runner=candidate;frame=result;map=next;
  $('filter').value=map.patterns?.brocade?.filter??'nearest';
  $('filter').disabled=!map.patterns?.brocade?.image;
  paint();$('error').textContent='';$('codeError').textContent='';
}
function editor(){ $('code').value=JSON.stringify(map,null,2); }
$('filter').addEventListener('input',()=>{
  try{
    const next=structuredClone(map);
    next.patterns.brocade.filter=$('filter').value;
    apply(next);editor();
  }catch(error){$('error').textContent=error.message;}
});
$('apply').addEventListener('click',()=>{
  try{apply(JSON.parse($('code').value));}
  catch(error){$('codeError').textContent=error.message;}
});
function pressed(key,value){
  for(const button of document.querySelectorAll('[data-'+key+']'))
    button.setAttribute('aria-pressed',String(button.dataset[key]===String(value)));
}
function pickView(value){view=value;pressed('view',value);paint();}
function pickRepeat(value){repeat=value;selected=null;pressed('repeat',value);paint();}
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>pickView(button.dataset.view));
for(const button of document.querySelectorAll('[data-repeat]'))button.addEventListener('click',()=>pickRepeat(Number(button.dataset.repeat)));
$('weave').addEventListener('click',event=>{
  if(!frame)return;
  const canvas=$('weave'), box=canvas.getBoundingClientRect();
  const x=Math.min(canvas.width-1,Math.max(0,Math.floor((event.clientX-box.left)*canvas.width/box.width)));
  const y=Math.min(canvas.height-1,Math.max(0,Math.floor((event.clientY-box.top)*canvas.height/box.height)));
  selected=[x,y];inspect();
});
$('reset').addEventListener('click',()=>{
  for(const field of fields.values())field.reset();
  selected=null;view='color';repeat=1;pressed('view',view);pressed('repeat',repeat);
  apply(original);editor();
});
$('save').addEventListener('click',()=>{
  const copy=structuredClone(saved);
  for(const [name,value] of Object.entries(values()))copy.graph.inputs[name].definition.default=value;
  copy.graph.nodes.weave.inputs.map=map;
  const url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;link.download='ember-brocade-edited.material.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
editor();
schedule();
