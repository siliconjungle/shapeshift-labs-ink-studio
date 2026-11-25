const $=id=>document.getElementById(id), P=KIT.procedural;
const {project,controls,patterns}=press, fields=new Map(), runners=new Map();
let result, pending=0;
const element=tag=>document.createElement(tag);
const schedule=()=>{if(!pending)pending=requestAnimationFrame(draw);};
const format=(n,digits=2)=>n.toFixed(digits);
const pair=value=>'['+value.map(n=>format(n)).join(', ')+']';

for(const [id,spec] of Object.entries(controls)){
  const row=element('div'), label=element('label'), control=element(spec.options?'select':'input');
  row.className='field';row.id=id+'-field';
  label.htmlFor=id;label.textContent=spec.label;control.id=id;
  row.append(label);
  let out;
  if(spec.options)for(const option of spec.options)control.add(new Option(option.label,option.value));
  else {
    control.type='range';control.min=spec.min;control.max=spec.max;control.step=spec.step;
    out=element('output');out.htmlFor.add(id);row.append(out);
  }
  row.append(control);
  $(['x','y','z','w','scale'].includes(id)?'lanes':'casting').append(row);
  const show=()=>{if(out)out.value=format(control.valueAsNumber);};
  const reset=()=>{control.value=spec.default;show();};
  control.addEventListener('input',()=>{show();schedule();});
  fields.set(id,{control,reset,spec});
}
for(const pattern of patterns)$('pattern').add(new Option(pattern.toUpperCase(),pattern));
$('pattern').addEventListener('input',schedule);

function inputs(){
  return Object.fromEntries([...fields].map(([id,{control,spec}])=>[id,spec.options?control.value:control.valueAsNumber]));
}
function arrow(ctx,start,end,color){
  const [x,y]=end,[sx,sy]=start, angle=Math.atan2(y-sy,x-sx);
  ctx.fillStyle=ctx.strokeStyle=color;
  if(Math.hypot(x-sx,y-sy)<1){
    ctx.beginPath();ctx.arc(x,y,4,0,2*Math.PI);ctx.fill();return;
  }
  ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(x,y);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x,y);
  ctx.lineTo(x-14*Math.cos(angle-.42),y-14*Math.sin(angle-.42));
  ctx.lineTo(x-14*Math.cos(angle+.42),y-14*Math.sin(angle+.42));
  ctx.closePath();ctx.fill();
}
function paintAxes(routed,scaled){
  const canvas=$('axes'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height, center=[w/2,h/2], scale=(h-35)/2;
  ctx.clearRect(0,0,w,h);
  ctx.lineWidth=2;ctx.strokeStyle='#39484c';ctx.beginPath();
  for(const offset of [-1,-.5,0,.5,1]){
    ctx.moveTo(center[0]+offset*scale,14);ctx.lineTo(center[0]+offset*scale,h-12);
    ctx.moveTo(16,center[1]+offset*scale);ctx.lineTo(w-16,center[1]+offset*scale);
  }
  ctx.stroke();
  ctx.fillStyle='#a5b3b2';ctx.font='18px monospace';
  ctx.fillText('Y',center[0]+8,21);ctx.fillText('X',w-28,center[1]-8);
  const endpoint=([x,y])=>[center[0]+x*scale,center[1]-y*scale];
  ctx.lineWidth=5;arrow(ctx,center,endpoint(routed),'#a1dbbe');
  ctx.lineWidth=3;arrow(ctx,center,endpoint(scaled),'#f0cd89');
}

function draw(){
  pending=0;
  try{
    const pattern=$('pattern').value;
    if(!runners.has(pattern)){
      const changed=structuredClone(project);
      changed.nodes.route.inputs.pattern=pattern;
      runners.set(pattern,P.graph.create(changed));
    }
    result=runners.get(pattern).evaluate(inputs()).outputs;
    const {preview,route,scaled,stampSize,rotation,carriers,rimGate,rimOpacity}=result;
    $('surface').getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(preview.data),preview.width,preview.height),0,0);
    $('gridLabel').textContent=carriers+' × '+carriers+' cells';
    $('pair').textContent='vec2 '+pair(route);
    $('size').textContent='vec2 '+pair(stampSize);
    $('turn').textContent=format(rotation,1)+'°';
    $('integer').textContent=carriers;
    $('boolean').textContent=rimGate+' → '+rimOpacity;
    paintAxes(route,scaled);
    $('error').textContent='';
  }catch(error){$('error').textContent=error.message;}
}

function reset(){
  for(const field of fields.values())field.reset();
  $('pattern').value='xy';schedule();
}
$('reset').addEventListener('click',reset);
$('save').addEventListener('click',()=>{
  const copy=structuredClone(press.document);
  copy.graph.nodes.route.inputs.pattern=$('pattern').value;
  for(const [id,value] of Object.entries(inputs()))copy.graph.inputs[id].definition.default=value;
  const url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)+'\n'],{type:'application/json'}));
  const link=element('a');link.href=url;link.download='signal-press-edited.material.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
reset();
