const $=id=>document.getElementById(id), P=KIT.procedural;
const {graph,knobs,presets,shared}=kiln;
const thermal=P.graph.group(graph.groups.firing.groups.thermal);
const firing=P.graph.group(graph.groups.firing,{groups:{thermal}});
const runner=P.graph.create(graph,{groups:{firing}});
const curveRunner=P.graph.create({inputs:{energy:'number',knee:'number'},
  nodes:{sample:{op:'thermal',inputs:{energy:{input:'energy'},knee:{input:'knee'}}}},
  outputs:{result:{node:'sample',port:'result'}}},{groups:{thermal}});

const widgets=new Map(), plates=new Map();
const values=()=>Object.fromEntries([...widgets].map(([key,{control,spec}])=>
  [key,spec.type==='boolean'?control.checked:spec.type==='string'?control.value:control.valueAsNumber]));
let result, pending=0, curveKnee, curveSamples;
const schedule=()=>{ if(!pending) pending=requestAnimationFrame(draw); };
const keyFor=(name,key)=>name+key[0].toUpperCase()+key.slice(1);
const element=(tag,classes)=>{const item=document.createElement(tag);if(classes)item.className=classes;return item;};
const round=value=>value.toFixed(2);

function connect(control,id,spec,readout) {
  const fallback=graph.inputs[id].default;
  control.id=id;
  if(spec.options) for(const option of spec.options)control.add(new Option(option.label,option.value));
  else if(spec.type==='boolean')control.type='checkbox';
  else {
    control.type='range';control.min=spec.min;control.max=spec.max;control.step=spec.step;
  }
  const set=value=>{if(spec.type==='boolean')control.checked=value;else control.value=value;};
  const show=()=>{if(readout)readout.value=spec.type==='integer'?control.value:round(control.valueAsNumber);};
  control.addEventListener('input',()=>{show();schedule();});
  set(fallback);show();
  widgets.set(id,{control,spec,reset(){set(fallback);show();}});
}

for(const [name,preset] of Object.entries(presets)) {
  const article=element('article','plate'), header=element('div','plate-header');
  const title=element('h2'), swatch=element('span','chip'), square=element('i'), hex=element('span');
  title.textContent=preset.label;swatch.append(square,hex);header.append(title,swatch);
  const view=element('figure'), canvas=element('canvas','swatch');
  canvas.width=144;canvas.height=144;canvas.id=name+'Preview';
  canvas.setAttribute('aria-label',preset.label+' ceramic material');view.append(canvas);
  const fields=element('div','fields');
  for(const [key,spec] of Object.entries(knobs)) {
    const id=keyFor(name,key), row=element('div','field'), label=element('label');
    const control=element(spec.options?'select':'input');
    const readout=!spec.options&&spec.type!=='boolean'?element('output'):undefined;
    label.htmlFor=id;label.textContent=spec.label;
    if(readout)readout.htmlFor.add(id);
    connect(control,id,spec,readout);
    if(spec.type==='boolean'){
      label.prepend(control);row.className='toggle';row.append(label);
    }else {
      row.append(label);if(readout)row.append(readout);
      row.append(control);
    }
    fields.append(row);
  }
  const stats=element('dl','stats'), points={};
  for(const [key,label] of [['energy','Energy'],['mixWeight','Mix weight'],['reduction','Atmosphere']]){
    const pair=element('div'), term=element('dt'), value=element('dd');
    term.textContent=label;pair.append(term,value);stats.append(pair);points[key]=value;
  }
  article.append(header,view,fields,stats);$('plates').append(article);
  plates.set(name,{canvas,square,hex,points});
}

function paintCurve(knee) {
  if(knee!==curveKnee){
    curveKnee=knee;
    curveSamples=Array.from({length:97},(_,i)=>curveRunner.evaluate({energy:i/96,knee}).outputs.result);
  }
  const canvas=$('curve'), ctx=canvas.getContext('2d'), w=canvas.width,h=canvas.height;
  const left=39,right=w-31,top=28,bottom=h-32, x=t=>left+t*(right-left), y=t=>bottom-t*(bottom-top);
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#383943';ctx.lineWidth=2;
  ctx.beginPath();
  for(const t of [0,.25,.5,.75,1]){ctx.moveTo(x(t),top);ctx.lineTo(x(t),bottom);ctx.moveTo(left,y(t));ctx.lineTo(right,y(t));}
  ctx.stroke();
  ctx.beginPath();ctx.moveTo(left,bottom);
  for(let i=0;i<curveSamples.length;i++)ctx.lineTo(x(i/(curveSamples.length-1)),y(curveSamples[i]));
  ctx.strokeStyle='#c6c7de';ctx.lineWidth=4;ctx.stroke();
  for(const [name,c] of [['jade','#8edbc4'],['copper','#efb67f']]){
    const prefix=name+'Call/', energy=result.preview(prefix+'energy'), amount=result.preview(prefix+'firedAmount','result');
    ctx.beginPath();ctx.moveTo(x(energy),bottom);ctx.lineTo(x(energy),y(amount));
    ctx.strokeStyle=c;ctx.lineWidth=2;ctx.setLineDash([5,6]);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(x(energy),y(amount),8,0,2*Math.PI);ctx.fillStyle=c;ctx.fill();
  }
}

function draw() {
  pending=0;
  try {
    const inputs=values();
    result=runner.evaluate(inputs);
    for(const [name,{canvas,square,hex,points}] of plates) {
      const {width,height,data}=result.outputs[name];
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
      const rgb=result.outputs[name+'Color'];
      hex.textContent='#'+rgb.slice(0,3).map(value=>Math.round(value*255).toString(16).padStart(2,'0')).join('');
      square.style.background=hex.textContent;
      const prefix=name+'Call/';
      points.energy.textContent=round(result.preview(prefix+'energy'));
      points.mixWeight.textContent=round(result.preview(prefix+'mixWeight'));
      points.reduction.textContent=result.preview(prefix+'reduction')?'Reduced':'Oxidized';
    }
    paintCurve(inputs.knee);
    $('error').textContent='';
  } catch (error) { $('error').textContent=error.message; }
}

connect($('knee'),'knee',shared,$('knee-readout'));
$('reset').addEventListener('click',()=>{for(const widget of widgets.values())widget.reset();schedule();});
$('save').addEventListener('click',()=>{
  const documentCopy=structuredClone(kiln.document);
  for(const [id,value] of Object.entries(values()))documentCopy.graph.inputs[id].definition.default=value;
  const url=URL.createObjectURL(new Blob([JSON.stringify(documentCopy,null,2)+'\n'],{type:'application/json'}));
  const link=element('a');link.href=url;link.download='kiln-formula-edited.material.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
schedule();
