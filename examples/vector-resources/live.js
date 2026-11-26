const $=id=>document.getElementById(id), P=KIT.procedural, V=P.vectorResources, Model=VectorResources;
const {saved,spec}=demo, overlay=$('overlay'), gizmo=$('gizmo'), svgNS='http://www.w3.org/2000/svg';
const titles={'swell':'Swell','compass-ring':'Compass ring','moon':'Crescent','wake':'Ferry wake','waterfront':'Waterfront',
  'sky-elements':'Sky elements','rocks':'Rocks and ferry','beacon':'Beacon','window':'Illustration','ferry':'SVG document'};
let source=structuredClone(saved.resources.ferry.definition.document), edits=[], active='swell', maskTarget='compass-ring';
let result, drag, selected, queued=0;
const back=[], ahead=[];
const graph=P.graph.create(spec,{operations:{
  svgAsset:{inputs:{name:'string'},outputs:{value:'vectorDocument'},run:()=>({value:source})}
}});
const title=(key,tag='')=>titles[key]??(key.startsWith('_ink') ? tag+' '+key.slice(4) : key);
const pickKey=document=>new Map(V.describe(document).elements.filter(row=>Model.shapeNames.includes(row.tag) &&
  validShape(document,row.key)).map(row=>[row.key,row]));
function validShape(document,key){
  try{ V.path(document,key);return true; }catch{return false;}
}
let shapes=pickKey(source);
function choose(next){
  active=next;
  if (active==='compass-ring' || !shapes.has('compass-ring')) maskTarget=active;
  selected=null;
  refresh();
}
function applyRows(rows){
  return graph.evaluate({edits:rows,target:active,maskTarget}).outputs;
}
function safe(edit){
  try{edit();$('notice').textContent='';}catch(error){$('notice').textContent=error.message; render(!drag);}
}
function commit(request){
  safe(()=>{
    const rows=[...edits,request], next=applyRows(rows);
    back.push(edits);ahead.length=0;edits=rows;result=next;render(true);
  });
}
function refresh(){
  safe(()=>{result=applyRows(edits);render(true);});
}
function travel(from,to){
  if (!from.length) return;
  safe(()=>{const next=from.at(-1), replay=applyRows(next);to.push(edits);edits=from.pop();result=replay;render(true);});
}

function svgElement(name,attributes){
  const item=document.createElementNS(svgNS,name);
  for(const [key,value] of Object.entries(attributes))item.setAttribute(key,value);
  return item;
}
function handleControls(node,transform){
  gizmo.replaceChildren();
  gizmo.setAttribute('transform','matrix('+transform.join(' ')+')');
  if ($('handles').getAttribute('aria-pressed') !== 'true' || !node.segments) return;
  const rows=V.handles(node.segments), list=[];
  if(rows.length>300)return;
  for(const row of rows){
    for(const [key,anchor] of [['c1',row.start],['c2',row.end],['control',row.start]]){
      const at=row[key];
      if(!at)continue;
      gizmo.append(svgElement('line',{x1:anchor[0],y1:anchor[1],x2:at[0],y2:at[1],
        stroke:'#9ddccd','stroke-opacity':.75,'stroke-width':1,'vector-effect':'non-scaling-stroke',class:'gizmo'}));
      list.push({row,at,key});
    }
    if(row.cmd!=='Z')list.push({row,at:row.end,key:'end'});
  }
  for(const {row,at,key} of list){
    const on=selected?.index===row.index&&selected?.key===key;
    const mark=svgElement('circle',{cx:at[0],cy:at[1],r:key==='end'?4.1:3.3,fill:on?'#fff0ca':key==='end'?'#d0f1dc':'#263751',
      stroke:on?'#e3a57c':'#9adbc9','stroke-width':1.3,'vector-effect':'non-scaling-stroke',class:'handle',tabindex:0,
      role:'button','aria-label':key+' on segment '+row.index});
    mark.dataset.index=row.index;
    mark.dataset.handle=key;
    mark.addEventListener('keydown',event=>{
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if(!delta)return;
      event.preventDefault();
      selected={index:row.index,key};
      commit({kind:'point',key:active,segment:row.index,handle:key,at:at.map((n,i)=>n+delta[i]*(event.shiftKey?5:1)),
        tangent:$('tangent').value});
      gizmo.querySelector('[data-index="'+row.index+'"][data-handle="'+key+'"]')?.focus();
    });
    gizmo.append(mark);
  }
}
function mask(){
  const canvas=$('mask'),ctx=canvas.getContext('2d'), {width,height,data}=result.mask.raster;
  let xmin=width,xmax=-1,ymin=height,ymax=-1;
  for(let p=0;p<data.length;p++){
    if(!data[p])continue;
    const x=p%width,y=Math.floor(p/width);
    xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);
  }
  ctx.fillStyle='#172433';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(xmax<0)return;
  const w=xmax-xmin+1,h=ymax-ymin+1,px=Math.max(1,Math.min(8,Math.floor(Math.min((canvas.width-12)/w,(canvas.height-12)/h))));
  const x0=Math.floor((canvas.width-w*px)/2),y0=Math.floor((canvas.height-h*px)/2);
  ctx.fillStyle='#a2d7ca';
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    ctx.globalAlpha=data[(y+ymin)*width+x+xmin];
    if(ctx.globalAlpha)ctx.fillRect(x0+x*px,y0+y*px,px,px);
  }
  ctx.globalAlpha=1;
  $('maskLabel').textContent=title(maskTarget,'Fill');
  $('maskRule').value=result.maskInfo.rule==='evenodd'?'even-odd':'nonzero';
}
function viewportSize(attrs,box){
  const units={px:1,in:96,cm:96/2.54,mm:96/25.4,q:96/101.6,pt:96/72,pc:16};
  const read=value=>{
    const match=/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|in|cm|mm|q|pt|pc)?$/i.exec(value?.trim()??'');
    return match ? Number(match[1])*units[match[2]?.toLowerCase()??'px'] : 0;
  };
  const width=read(attrs.width), height=read(attrs.height), ratio=box ? box[2]/box[3] : 2;
  return [width||height*ratio||box?.[2]||300,height||width/ratio||box?.[3]||150];
}
function render(panels){
  if(!result)return;
  const doc=result.vector, a=doc.root.attrs, info=result.pathInfo, node=Model.index(doc).nodes.get(active)?.node;
  if (!node) return;
  const box=Model.viewBox(a.viewBox), [width,height]=viewportSize(a,box);
  const resolved=Model.viewport(box,width,height,a.preserveAspectRatio);
  const transform=Model.multiply(Model.matrix(a.transform),Model.multiply(resolved,info.elementTransform));
  $('art').style.aspectRatio=String(width/height);
  $('art').style.maxWidth=Math.min(770,550*width/height)+'px';
  $('image').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(result.svg);
  overlay.setAttribute('viewBox','0 0 '+width+' '+height);
  handleControls(node,transform);mask();
  const row=selected&&node.segments&&V.handles(node.segments)[selected.index], point=row?.[selected?.key];
  $('point').value=point ? selected.key+' · '+point.map(n=>n.toFixed(2)).join(', ') :
    active==='swell'?'Drag a handle in the artwork':title(active,node.tag);
  if(!panels)return;
  const tree=V.describe(doc).elements, model=Model.index(doc), parent=model.nodes.get(active).parent;
  $('element').replaceChildren(...[...shapes].map(([key,entry])=>new Option(title(key,entry.tag)+(entry.parent?'  ·  '+title(entry.parent,'group'):''),key)));
  $('element').value=active;
  const groups=tree.filter(row=> ['g','svg'].includes(row.tag) && !insideDefinitions(model,row.key));
  $('parent').replaceChildren(...groups.map(row=>new Option(title(row.key,row.tag),row.key)));
  $('parent').value=parent?.key??doc.root.key;
  $('backward').disabled=!parent||parent.children.indexOf(node)===0;
  $('forward').disabled=!parent||parent.children.indexOf(node)===parent.children.length-1;
  $('transform').value=node.attrs.transform??'';
  $('viewBox').value=a.viewBox??'';
  $('undo').disabled=!back.length;$('redo').disabled=!ahead.length;
  const css=Model.style(node.attrs.style), paint=name=>css[name]??node.attrs[name];
  $('rule').value=info.rule;
  for(const name of ['fill','stroke'])$(name).value=paint(name)??'';
  $('width').value=paint('stroke-width')??'';
  $('count').value=(node.segments?.length??0)+' segments';
}
function insideDefinitions(table,key){
  for(let row=table.nodes.get(key);row;row=row.parent&&table.nodes.get(row.parent.key)){
    if(Model.definitions.includes(row.node.tag))return true;
  }
  return false;
}
function presentation(name,value){
  const node=Model.index(result.vector).nodes.get(active).node;
  const css=Model.style(node.attrs.style);
  if(Object.hasOwn(css,name)){
    if(value===null)delete css[name];else css[name]=value;
    return {kind:'attributes',key:active,attrs:{style:Object.entries(css).map(([key,text])=>key+': '+text).join('; ')}};
  }
  return {kind:'attributes',key:active,attrs:{[name]:value}};
}
overlay.addEventListener('pointerdown',event=>{
  const {index,handle}=event.target.dataset;
  if(event.button!==0||index===undefined)return;
  const inverse=gizmo.getScreenCTM()?.inverse();
  if(!inverse)return;
  overlay.setPointerCapture(event.pointerId);
  selected={index:Number(index),key:handle};
  drag={id:event.pointerId,inverse,start:[event.clientX,event.clientY],selected,request:null};
});
function dragPoint(event){
  if(!drag||event.pointerId!==drag.id)return;
  if(!drag.request&&Math.hypot(event.clientX-drag.start[0],event.clientY-drag.start[1])<.5)return;
  const at=new DOMPoint(event.clientX,event.clientY).matrixTransform(drag.inverse);
  drag.request={kind:'point',key:active,segment:drag.selected.index,handle:drag.selected.key,at:[at.x,at.y],tangent:$('tangent').value};
  if(!queued)queued=requestAnimationFrame(()=>{
    queued=0;
    if(drag?.request)safe(()=>{result=applyRows([...edits,drag.request]);render(false);});
  });
}
overlay.addEventListener('pointermove',dragPoint);
overlay.addEventListener('pointerup',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  dragPoint(event);
  const {request}=drag;drag=null;
  if(request)commit(request);else refresh();
});
overlay.addEventListener('lostpointercapture',()=>{if(drag){drag=null;refresh();}});
$('element').addEventListener('change',()=>choose($('element').value));
$('maskOpen').addEventListener('click',()=>choose(maskTarget));
$('handles').addEventListener('click',()=>{
  $('handles').setAttribute('aria-pressed',String($('handles').getAttribute('aria-pressed')!=='true'));render(false);
});
$('undo').addEventListener('click',()=>travel(back,ahead));
$('redo').addEventListener('click',()=>travel(ahead,back));
for(const name of ['fill','stroke','rule','width'])$(name).addEventListener('change',()=>{
  const attr={rule:'fill-rule',width:'stroke-width'}[name]??name;
  commit(presentation(attr,$(name).value.trim()||null));
});
$('transform').addEventListener('change',()=>commit({kind:'attributes',key:active,attrs:{transform:$('transform').value.trim()||null}}));
$('viewBox').addEventListener('change',()=>commit({kind:'attributes',key:result.vector.root.key,attrs:{viewBox:$('viewBox').value.trim()||null}}));
$('parent').addEventListener('change',()=>commit({kind:'move',key:active,parent:$('parent').value}));
for(const [id,delta] of [['backward',-1],['forward',1]])$(id).addEventListener('click',()=>{
  const {node,parent}=Model.index(result.vector).nodes.get(active);
  commit({kind:'move',key:active,parent:parent.key,index:parent.children.indexOf(node)+delta});
});
$('import').addEventListener('click',()=>{$('file').value='';$('file').click();});
$('file').addEventListener('change',async()=>{
  const file=$('file').files[0];
  if(!file)return;
  try{
    if(file.size>Model.maxText)throw new RangeError('SVG file exceeds the 2 MiB budget');
    const imported=V.importSVG(await file.text()), choices=pickKey(imported);
    if(!choices.size)throw new TypeError('Choose a passive SVG with a visible path or basic shape');
    source=imported;shapes=choices;edits=[];back.length=ahead.length=0;graph.clear();
    active=maskTarget=shapes.keys().next().value;selected=null;refresh();
  }catch(error){$('notice').textContent=error.message;}
});
function download(name,data,type){
  const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export').addEventListener('click',()=>download('night-ferry.svg',result.svg,'image/svg+xml'));
$('material').addEventListener('click',()=>{
  const doc=structuredClone(saved);doc.resources.ferry.definition.document=result.vector;
  doc.graph.inputs.edits.definition.default=[];
  doc.graph.inputs.target.definition.default=active;
  doc.graph.inputs.maskTarget.definition.default=maskTarget;
  download('night-ferry.material.json',JSON.stringify(doc,null,2)+'\n','application/json');
});
refresh();
