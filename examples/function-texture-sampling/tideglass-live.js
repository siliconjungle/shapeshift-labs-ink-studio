const $=id=>document.getElementById(id), P=KIT.procedural;
const {spec,view,settings}=tideglass;
const runner=P.graph.create(spec,{groups:{glaze:P.graph.group(spec.groups.glaze)}});
const uvGrid=tideglassPreview.uvGrid(view), fields=new Map();
let result, previousChart, previousPigment, previousStencil, pending=0;
const number=value=>value.toFixed(3);
const tuple=values=>'['+values.map(number).join(', ')+']';
const schedule=()=>{if(!pending)pending=requestAnimationFrame(draw);};
const element=tag=>document.createElement(tag);

for(const [name,field] of Object.entries(settings)){
  const row=element('div'),label=element('label'),control=element(field.choices?'select':'input');
  let readout;
  row.className='field';label.htmlFor=control.id=name;label.textContent=field.label;row.append(label);
  if(field.choices){
    for(const choice of field.choices)control.add(new Option(choice==='image'?'Source default':choice[0].toUpperCase()+choice.slice(1),choice));
  } else {
    control.type='range';control.min=field.min;control.max=field.max;control.step=field.step;
    readout=element('output');readout.htmlFor.add(name);row.append(readout);
  }
  const update=()=>{if(readout)readout.value=control.valueAsNumber.toFixed(2);};
  const reset=()=>{control.value=field.default;update();};
  control.addEventListener('input',()=>{update();schedule();});
  row.append(control);$('fields').append(row);fields.set(name,{control,field,reset});
}

function values(){
  const probe=[$('u').valueAsNumber,$('v').valueAsNumber];
  return {...Object.fromEntries([...fields].map(([id,{control,field}])=>[id,field.choices?control.value:control.valueAsNumber])),
    probe};
}
function paint(id,{width,height,data}){
  $(id).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
}
function positionMarker(uv){
  const [x,y]=uv.map(value=>.5+(value-.5)/view.span);
  const marker=$('marker');marker.hidden=x<0||y<0||x>1||y>1;
  marker.style.left=100*x+'%';marker.style.top=100*y+'%';
}
function draw(){
  pending=0;
  try{
    const inputs=values();
    if(inputs.probe.some(value=>!Number.isFinite(value)))throw new RangeError('Enter finite U and V coordinates.');
    result=runner.evaluate(inputs);
    const {chart,probe,colorSource,graySource}=result.outputs;
    if(chart!==previousChart){paint('chart',tideglassPreview.chart(chart,view,P.conversions));previousChart=chart;}
    if(colorSource!==previousPigment){paint('pigment',P.graphImages.toDisplay(colorSource));previousPigment=colorSource;}
    if(graySource!==previousStencil){paint('stencil',tideglassPreview.gray(graySource));previousStencil=graySource;}
    $('rgba').textContent=tuple(result.preview('probe/pigmentRead'));
    $('gray').textContent=number(result.preview('probe/stencilRead'));
    $('stencilUv').textContent=tuple(result.preview('probe/shifted'));
    $('result').textContent=tuple(probe);positionMarker(inputs.probe);
    $('error').textContent='';
  }catch(error){$('error').textContent=error.message;}
}
function pick(uv){
  $('u').value=uv[0];$('v').value=uv[1];schedule();
}
$('chart').addEventListener('click',event=>{
  const frame=$('chart').getBoundingClientRect();
  const x=Math.floor((event.clientX-frame.left)*view.width/frame.width),
    y=Math.floor((event.clientY-frame.top)*view.height/frame.height);
  if(x>=0&&x<view.width&&y>=0&&y<view.height)pick(uvGrid[y*view.width+x]);
});
for(const id of ['u','v'])$(id).addEventListener('input',schedule);
function reset(){
  for(const field of fields.values())field.reset();
  pick(spec.inputs.probe.default);
}
$('reset').addEventListener('click',reset);
$('save').addEventListener('click',()=>{
  const input=values();
  if(input.probe.some(value=>!Number.isFinite(value)))return;
  const graph=structuredClone(tideglass.saved);
  for(const [id,value] of Object.entries(input))graph.graph.inputs[id].definition.default=value;
  const url=URL.createObjectURL(new Blob([JSON.stringify(graph,null,2)+'\n'],{type:'application/json'})),link=element('a');
  link.href=url;link.download='tideglass-edited.material.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
});
reset();
