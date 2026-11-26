const $=id=>document.getElementById(id), P=KIT.procedural;
const {saved,program,settings,width,height,seed,sources}=copperwake;
const resources=Object.fromEntries(Object.entries(sources).map(([name,source])=>
  [name,P.graphImages.declare(source.raster,source.descriptor)]));
const compile=P.pixelProcessor.compile, view=P.graphImages.toDisplay, fields=new Map();
const stages={cpu:null,gpu:null,report:null};
let definition=program, plan=compile(program), device, executor, map='oxide', selected=[45,37];
let generation=0, pending=false, scheduled=0;

function controls(){
  for(const [name,{label,default:initial,min,max,step}] of Object.entries(settings)){
    const row=document.createElement('div'), caption=document.createElement('label');
    const slider=document.createElement('input'), value=document.createElement('output');
    row.className='field'; caption.htmlFor=slider.id=name; caption.textContent=label;
    slider.type='range'; slider.min=min; slider.max=max; slider.step=step;
    value.htmlFor.add(name);
    const reset=()=>{slider.value=initial;update();};
    const update=()=>{value.value=step===1?slider.value:slider.valueAsNumber.toFixed(2);};
    slider.addEventListener('input',()=>{update();schedule();});
    row.append(caption,value,slider); $('fields').append(row); fields.set(name,{slider,reset});
    reset();
  }
}
const parameters=()=>Object.fromEntries([...fields].map(([key,{slider}])=>[key,slider.valueAsNumber]));
const request=()=>({width,height,resources,seed,parameters:parameters()});
function paint(id,data){
  $(id).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
}
function gray(values,unit=255){
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0,k=0;i<values.length;i++,k+=4){
    const n=values[i]*unit;
    pixels[k]=n;pixels[k+1]=n;pixels[k+2]=n;pixels[k+3]=255;
  }
  return pixels;
}
function difference(){
  const left=stages.cpu.value.raster.data, right=stages.gpu?.value.raster.data;
  if(!right)return gray(new Uint8Array(width*height),1);
  const a=new Uint8Array(width*height*4), lm=stages.cpu.oxide.raster.data, rm=stages.gpu.oxide.raster.data;
  for(let i=0,k=0;i<lm.length;i++,k+=4){
    const changed=lm[i]!==rm[i]||[0,1,2,3].some(c=>left[k+c]!==right[k+c]);
    a[k]=changed?255:17;a[k+1]=changed?153:28;a[k+2]=changed?102:32;a[k+3]=255;
  }
  return a;
}
function inspect(){
  if(!stages.cpu)return;
  const [x,y]=selected, i=y*width+x, heightValue=resources.relief.raster.data[i];
  const left=stages.cpu.value.raster.data,right=stages.gpu?.value.raster.data;
  const rgba=buffer=>Array.from(buffer.subarray(i*4,i*4+4)).join(', ');
  $('position').textContent='Texel '+x+', '+y+' · height '+heightValue.toFixed(3)+' art px';
  $('values').textContent='CPU RGBA '+rgba(left)+(right?' · GPU RGBA '+rgba(right):'')+
    ' · Oxide '+stages.cpu.oxide.raster.data[i]+'/255';
  for(const marker of document.querySelectorAll('.marker')){
    marker.style.left=100*(x+.5)/width+'%';marker.style.top=100*(y+.5)/height+'%';
    marker.hidden=false;
  }
}
function drawDetail(){
  if(!stages.cpu)return;
  paint('detail',map==='difference'?difference():map==='relief'?gray(resources.relief.raster.data):gray(stages.cpu.oxide.raster.data,1));
}
function report(data){
  const rows=Object.values(data.outputs);
  const maximum=Math.max(...rows.map(row=>row.maxAbsolute));
  $('status').textContent=data.passed?'Within tolerance':'Mismatch';
  $('maxError').textContent=maximum===0?'0':maximum.toExponential(3);
  $('outside').textContent=String(rows.reduce((count,row)=>count+row.outsideTolerance,0));
  $('different').textContent=String(rows.reduce((count,row)=>count+row.differentStoredSamples,0));
}
function schedule(){
  generation++;
  if(!scheduled)scheduled=requestAnimationFrame(draw);
}
async function draw(){
  scheduled=0;
  if(pending)return;
  pending=true;
  const current=generation, options=request(), selectedPlan=plan;
  try{
    if(!device){
      stages.cpu=selectedPlan.run(options);stages.gpu=null;stages.report=null;
      paint('cpu',view(stages.cpu.value).data);
      inspect();drawDetail();
    }else{
      $('status').textContent='Comparing…';
      executor??=CopperwakeGPU.createWebGPUPixelProcessor(device,selectedPlan);
      const compared=await executor.compare(options);
      if(current!==generation)return;
      Object.assign(stages,compared);
      paint('cpu',view(stages.cpu.value).data);paint('gpu',view(stages.gpu.value).data);
      $('gpuNote').hidden=true;
      report(compared.report);inspect();drawDetail();
    }
    $('work').textContent=selectedPlan.report.workPerTexel;
    $('error').textContent='';
  }catch(error){
    if(current===generation){
      $('error').textContent=error.message;
      $('status').textContent='Comparison error';
      $('gpuNote').hidden=false;
      $('gpuNote').textContent='WebGPU result unavailable';
      stages.gpu=null;stages.report=null;
      for(const id of ['maxError','outside','different'])$(id).textContent='—';
      if(device){
        try{
          stages.cpu=selectedPlan.run(options);
          paint('cpu',view(stages.cpu.value).data);
          inspect();drawDetail();
        }catch(cpuError){$('error').textContent=cpuError.message;}
      }
    }
  }finally{
    pending=false;
    if(current!==generation&&!scheduled)scheduled=requestAnimationFrame(draw);
  }
}
function setProgram(next){
  const candidate=compile(next);
  const result=candidate.run(request());
  if(result.value?.descriptor.intent!=='color'||result.value.descriptor.layout!=='rgba'||
      result.oxide?.descriptor.intent!=='mask'||result.oxide.descriptor.precision!=='unorm8')
    throw new TypeError('Copperwake needs an RGBA color output named value and a UNORM8 mask named oxide');
  executor?.dispose();executor=undefined;
  definition=next;plan=candidate;schedule();
}
$('apply').addEventListener('click',()=>{
  try{setProgram(JSON.parse($('program').value));$('codeError').textContent='';}
  catch(error){$('codeError').textContent=error.message;}
});
$('reset').addEventListener('click',()=>{
  for(const row of fields.values())row.reset();
  selected=[45,37];$('program').value=JSON.stringify(program,null,2);$('codeError').textContent='';
  setProgram(program);
});
$('save').addEventListener('click',()=>{
  const material=structuredClone(saved);
  for(const [name,value] of Object.entries(parameters()))material.graph.inputs[name].definition.default=value;
  material.graph.nodes.process.inputs.program=definition;
  const url=URL.createObjectURL(new Blob([JSON.stringify(material,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;link.download='copperwake-edited.material.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
});
for(const id of ['cpu','gpu','detail'])$(id).addEventListener('click',event=>{
  const box=$(id).getBoundingClientRect();
  selected=[Math.min(width-1,Math.max(0,Math.floor((event.clientX-box.left)*width/box.width))),
    Math.min(height-1,Math.max(0,Math.floor((event.clientY-box.top)*height/box.height)))];
  inspect();
});
for(const button of document.querySelectorAll('[data-map]'))button.addEventListener('click',()=>{
  map=button.dataset.map;
  for(const tab of document.querySelectorAll('[data-map]'))tab.setAttribute('aria-pressed',String(tab===button));
  drawDetail();
});
async function connect(){
  try{
    const adapter=await navigator.gpu?.requestAdapter();
    if(!adapter)throw new Error('WebGPU adapter unavailable in this browser');
    device=await adapter.requestDevice();
    device.lost.then(()=>{
      device=undefined;executor?.dispose();executor=undefined;
      $('gpuNote').hidden=false;$('gpuNote').textContent='WebGPU device lost';
      $('status').textContent='CPU preview';
      schedule();
    });
    schedule();
  }catch(error){
    $('gpuNote').textContent=error.message;
    $('status').textContent='CPU preview';
  }
}
controls();
$('program').value=JSON.stringify(program,null,2);
schedule();
void connect();
