const InkMaterialSamples = (() => {
  const pending=new Map(), cache=new Map();
  let used=0;
  function receive(key,data) {
    if (pending.has(key)) pending.get(key).data=data;
  }
  function read({file,sha256,bytes}) {
    if(cache.has(sha256)) return Promise.resolve(cache.get(sha256));
    if(pending.has(sha256)) return pending.get(sha256).promise;
    const row={}, script=document.createElement('script');
    pending.set(sha256,row);
    row.promise=new Promise((resolve,reject)=>{
      script.onload=async()=>{
        try {
          if(!row.data) throw new Error('Missing sample payload');
          const raw=Uint8Array.fromBase64 ? Uint8Array.fromBase64(row.data) : Uint8Array.from(atob(row.data),c=>c.charCodeAt(0));
          const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'));
          const buffer=await new Response(stream).arrayBuffer();
          if(buffer.byteLength!==bytes) throw new Error('Invalid sample payload size');
          const values=new DataView(buffer);
          cache.set(sha256,values);
          used+=bytes;
          while(cache.size>1 && (used>48*1024*1024 || cache.size>12)) {
            const oldest=cache.keys().next().value;
            used-=cache.get(oldest).byteLength;
            cache.delete(oldest);
          }
          resolve(values);
        } catch(error) { reject(error); }
      };
      script.onerror=()=>reject(new Error('Could not load exact sample values'));
      script.src=file;
      document.head.append(script);
    }).finally(()=>{
      pending.delete(sha256);
      script.remove();
    });
    return row.promise;
  }
  return {read,receive};
})();

(() => {
  const el=id=>document.getElementById(id);
  const AOV=MaterialPreviewAOV, samples=InkMaterialSamples;
  const { width,height,targets,variants=[] }=linkedMaterial;
  const looks=[{id:'current',label:'Current',targets},...variants];
  const controls=Object.fromEntries(['look','carrier','slot','tile','channel','orbit','pass'].map(id=>[id,el(id)]));
  const viewport=el('viewport'), overlay=el('overlay'), surface=el('pass-canvas'), mapWrap=el('map-wrap');
  const context=overlay.getContext('2d');
  const pins=new Map();
  let look,target,region,map,view,hits,uv,pixel,drag,viewRevision=0,passRevision=0,readRevision=0,compareRevision=0;
  for(const canvas of [overlay,surface,el('pin-image-a'),el('pin-image-b')]) {
    canvas.width=width;
    canvas.height=height;
  }
  viewport.style.setProperty('--view-ratio',width/height);
  el('comparison').style.setProperty('--view-ratio',width/height);
  el('title').textContent=linkedMaterial.label;
  document.title=linkedMaterial.label+' · Ink Studio';

  function options(control, rows, preferred) {
    control.replaceChildren(...rows.map(([key,label])=>new Option(label,key)));
    if(rows.some(([key])=>key===preferred)) control.value=preferred;
    control.disabled=rows.length<2;
  }
  function state() {
    return {look,target,pass:controls.pass.value,view,angle:el('angle').value,region,map,hits,uv,pixel};
  }
  function captureError(error) {
    el('status').textContent=error.message;
  }
  function image(file) {
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Could not read the selected pass image'));
      img.src=file;
    });
  }
  async function mapImage(row) {
    const data=await samples.read(row.display);
    return {width:row.width,height:row.height,rgba:new Uint8Array(data.buffer)};
  }
  async function passImage(row) {
    if(row.pass==='beauty') return null;
    const pixels=row.hits ?? await samples.read(row.view.screen);
    const maps=Object.hasOwn(AOV.diagnostics,row.pass) ? [] : await Promise.all(row.target.regions.map(region=>{
      const map=region.maps.find(map=>map.name===row.pass);
      return map?mapImage(map):null;
    }));
    return new ImageData(AOV.render(row.pass,width,height,pixels,row.target.regions,maps,row.view.depthRange),width,height);
  }

  function chooseLook(keepAngle) {
    look=looks.find(row=>row.id===controls.look.value);
    options(controls.carrier,look.targets.map(row=>[row.id,row.label]),target?.id);
    chooseTarget(keepAngle);
  }
  function chooseTarget(keepAngle=false) {
    const old=region;
    target=look.targets.find(row=>row.id===controls.carrier.value);
    const selected=target.regions.find(row=>row.slot===old?.slot && row.tile===old?.tile) ?? target.regions[target.initialRegion];
    const keys=new Set([...Object.keys(AOV.maps),...target.regions.flatMap(row=>row.maps.map(map=>map.name))]);
    options(controls.pass,['beauty',...keys,...Object.keys(AOV.diagnostics)].map(key=>[key,AOV.label(key)]),controls.pass.value);
    options(controls.slot,[...new Set(target.regions.map(row=>row.slot))].map(name=>[name,name]),selected.slot);
    chooseSlot(selected.tile,!keepAngle);
    const index=keepAngle ? Math.min(+controls.orbit.value,target.views.length-1) : 0;
    controls.orbit.max=target.views.length-1;
    controls.orbit.value=index;
    controls.orbit.disabled=target.views.length===1;
    drawView();
  }
  function chooseSlot(tile, clear=true) {
    const rows=target.regions.filter(row=>row.slot===controls.slot.value);
    options(controls.tile,rows.map(row=>[row.tile,row.tile]),tile??rows.find(row=>row.maps.length)?.tile);
    chooseTile(clear);
  }
  function chooseTile(clear=true) {
    region=target.regions.find(row=>row.slot===controls.slot.value && row.tile===controls.tile.value);
    const pass=controls.pass.value, preferred=region.maps.some(row=>row.name===pass)?pass:map?.name??'baseColor';
    options(controls.channel,region.maps.map(row=>[row.name,AOV.label(row.name)]),preferred);
    if(clear) { uv=undefined; pixel=undefined; }
    chooseMap();
  }
  function chooseMap() {
    map=region.maps.find(row=>row.name===controls.channel.value);
    el('empty').hidden=!!map;
    mapWrap.hidden=!map;
    el('map-title').textContent=map?AOV.label(map.name):'';
    el('dimensions').textContent=map ? map.width+' × '+map.height+' px'+
      (map.range && map.mode==='height' ? ' · '+map.range.map(n=>Number(n.toFixed(3))).join(' to ')+' '+map.units : '') : '';
    if(map) {
      el('map').src=map.image;
      el('map').alt=AOV.label(map.name);
      mapWrap.style.setProperty('--map-ratio',map.width/map.height);
    }
    updateSelection();
  }
  function choosePass() {
    if(region.maps.some(row=>row.name===controls.pass.value)) {
      controls.channel.value=controls.pass.value;
      chooseMap();
    } else updateSelection();
    drawPass();
  }

  async function drawView() {
    const index=+controls.orbit.value, token=++viewRevision;
    view=target.views[index];
    hits=undefined;
    pixel=undefined;
    el('angle').value=Math.round(index*360/target.views.length)+'°';
    el('render').src=view.image;
    el('render').alt=target.label+' material preview';
    updateSelection();
    drawPass();
    try {
      const data=await samples.read(view.screen);
      if(token!==viewRevision) return;
      hits=data;
      updateSelection();
    } catch(error) {
      if(token===viewRevision) captureError(error);
    }
  }
  async function drawPass() {
    const row=state(), token=++passRevision;
    if(!row.view) return;
    const beauty=row.pass==='beauty';
    el('render').hidden=!beauty;
    surface.hidden=beauty;
    el('pass-label').textContent=AOV.label(row.pass);
    const help={
      'material-id':'One color per material slot and tile',
      'map-bindings':'Teal = graph maps bound · Orange = unbound',
      'surface-uv':'Red = U · Green = V',
      'surface-depth':row.view.depthRange ? row.view.depthRange.map(n=>n.toFixed(3)).join('–')+' camera depth' : '',
      'surface-coverage':'White = full coverage'
    };
    el('pass-help').textContent=help[row.pass]??(beauty?'': 'Muted violet = map is unbound');
    if(beauty) return;
    const canvas=surface.getContext('2d');
    canvas.clearRect(0,0,width,height);
    try {
      const pixels=await passImage(row);
      if(token===passRevision) canvas.putImageData(pixels,0,0);
    } catch(error) {
      if(token===passRevision) captureError(error);
    }
  }

  const number=n=>Object.is(n,-0)?'−0':String(n);
  function field(box,key,value) {
    const dt=document.createElement('dt'), dd=document.createElement('dd');
    dt.textContent=key; dd.textContent=value;
    box.append(dt,dd);
  }
  function screenFields(box,row,p,hit) {
    if(p===undefined) return;
    field(box,'Screen pixel',p%width+', '+Math.floor(p/width));
    if(!hit) { field(box,'Surface','No visible surface'); return; }
    field(box,'Material ID',String(hit.index+1));
    field(box,'Slot / tile',row.slot+' / '+row.tile);
    field(box,'UV',hit.uv.map(number).join(', '));
    field(box,'Depth / coverage',[hit.depth,hit.coverage].map(number).join(' / '));
  }
  async function texelFields(box, map, uv, valid) {
    if(!map || !uv) return;
    const [x,y]=AOV.texel(map,...uv), d=map.descriptor;
    field(box,'Source texel',x+', '+y);
    field(box,'Encoding',[d.precision,d.colorSpace==='none'?(d.normalOrientation??d.units):d.colorSpace,
      d.alpha==='none'?'':d.alpha+' alpha'].filter(Boolean).join(' · '));
    const values=await samples.read(map.samples);
    if(!valid()) return;
    for(const {name,value} of AOV.sample(values,map,...uv).lanes) field(box,name,number(value));
  }
  async function inspect(nearest) {
    const token=++readRevision, box=el('reading');
    box.replaceChildren();
    el('pick-hint').hidden=!!uv;
    if(!uv) return;
    try {
      const p=pixel??(nearest>=0?nearest:undefined);
      screenFields(box,region,p,p===undefined?null:AOV.screen(hits,p));
      await texelFields(box,map,uv,()=>token===readRevision);
    } catch(error) {
      if(token===readRevision) captureError(error);
    }
  }

  function updateSelection() {
    const marker=el('marker');
    marker.hidden=!map || !uv;
    el('uv').textContent='';
    if(map && uv) {
      const [x,y]=AOV.texel(map,...uv);
      marker.style.left=(x+.5)*100/map.width+'%';
      marker.style.top=(y+.5)*100/map.height+'%';
      el('uv').textContent='('+x+', '+y+')';
    }
    context.clearRect(0,0,width,height);
    if(!hits || !region) {
      el('status').textContent='';
      inspect(-1);
      return;
    }
    const selected=region.index+1, isOwn=p=>hits.getUint8(p*AOV.stride)===selected;
    const outline=context.createImageData(width,height), wanted=map && uv && AOV.texel(map,...uv);
    let nearest=-1, error=Infinity;
    for(let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
      if(!isOwn(p)) continue;
      if(x===0 || x===width-1 || y===0 || y===height-1 ||
          !isOwn(p-1) || !isOwn(p+1) || !isOwn(p-width) || !isOwn(p+width))
        outline.data.set([249,210,148,194],p*4);
      if(!uv || pixel!==undefined) continue;
      const row=AOV.screen(hits,p), [u,v]=row.uv;
      if(wanted && (AOV.address(u,map.width)!==wanted[0] || AOV.address(v,map.height)!==wanted[1])) continue;
      const distance=(u-uv[0])**2+(v-uv[1])**2;
      if(distance<error) { error=distance; nearest=p; }
    }
    if(pixel!==undefined && isOwn(pixel)) nearest=pixel;
    context.putImageData(outline,0,0);
    const near=nearest>=0 && (wanted || pixel!==undefined || error<.035**2);
    if(near) {
      const x=nearest%width+.5,y=Math.floor(nearest/width)+.5;
      context.beginPath();
      context.arc(x,y,5,0,Math.PI*2);
      for(const [color,size] of [['#182625',3.5],['#ffe3a8',1.5]]) {
        context.strokeStyle=color;context.lineWidth=size;context.stroke();
      }
    }
    const visible=view.pixels[region.index]>0;
    el('status').textContent=!visible?'Tile out of view':uv && !near?'Texel out of view':'Tile '+region.tile;
    inspect(near?nearest:-1);
  }

  function normalized(event,node) {
    const rect=node.getBoundingClientRect();
    return [(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];
  }
  function pointerPixel(event,node) {
    const [u,v]=normalized(event,node);
    if(u<0 || v<0 || u>=1 || v>=1) return undefined;
    return AOV.address(v,height)*width+AOV.address(u,width);
  }
  function point(p) {
    if(!hits || p===undefined) return;
    const hit=AOV.screen(hits,p);
    if(!hit) return;
    const selected=target.regions[hit.index];
    controls.slot.value=selected.slot;
    chooseSlot(selected.tile,false);
    pixel=p;
    uv=hit.uv;
    updateSelection();
  }

  function pinned(side) {
    const row=pins.get(side);
    el('pin-card-'+side).hidden=!row;
    el('comparison').hidden=!pins.size;
    el('compare-link').hidden=!pins.size;
    el('pin-'+side).textContent=(row?'Replace ':'Pin ')+side.toUpperCase();
    if(!row) return;
    const canvas=el('pin-image-'+side), reader=canvas.getContext('2d');
    reader.clearRect(0,0,width,height);
    el('pin-name-'+side).textContent=row.look.label+' · '+AOV.label(row.pass);
    el('pin-detail-'+side).textContent=row.target.label+' · '+row.angle;
    (row.pass==='beauty'?image(row.view.image):passImage(row)).then(result=>{
      if(pins.get(side)!==row) return;
      if(row.pass==='beauty') reader.drawImage(result,0,0);
      else reader.putImageData(result,0,0);
    }).catch(captureError);
  }
  async function compare(p) {
    const token=++compareRevision;
    await Promise.all([...pins].map(async ([side,row])=>{
      const box=el('pin-reading-'+side);
      box.replaceChildren();
      const cross=el('pin-marker-'+side);
      const pixel=p??row.pixel;
      cross.hidden=pixel===undefined;
      if(pixel!==undefined) {
        cross.style.left=(pixel%width+.5)*100/width+'%';
        cross.style.top=(Math.floor(pixel/width)+.5)*100/height+'%';
      }
      try {
        if(pixel===undefined) {
          await texelFields(box,row.map,row.uv,()=>token===compareRevision);
          return;
        }
        const data=row.hits??await samples.read(row.view.screen);
        if(token!==compareRevision) return;
        const hit=AOV.screen(data,pixel), region=hit&&row.target.regions[hit.index];
        screenFields(box,region,pixel,hit);
        if(!hit) return;
        const map=region.maps.find(map=>map.name===row.pass) ?? region.maps.find(map=>map.name===row.map?.name);
        await texelFields(box,map,hit.uv,()=>token===compareRevision);
      } catch(error) { if(token===compareRevision) captureError(error); }
    }));
  }
  for(const side of ['a','b']) {
    el('pin-'+side).onclick=()=>{
      pins.set(side,state());
      pinned(side);
      compare();
    };
    el('unpin-'+side).onclick=()=>{pins.delete(side);pinned(side);compare();};
    el('pin-stage-'+side).onclick=event=>compare(pointerPixel(event,event.currentTarget));
  }

  viewport.onpointerdown=event=>{
    if(event.button!==0) return;
    drag={id:event.pointerId,x:event.clientX,start:+controls.orbit.value,moved:false};
    viewport.setPointerCapture(event.pointerId);
  };
  viewport.onpointermove=event=>{
    if(drag?.id!==event.pointerId) return;
    const delta=event.clientX-drag.x;
    if(!drag.moved && Math.abs(delta)<6) return;
    drag.moved=true;
    const count=target.views.length,index=((drag.start-Math.round(delta/26))%count+count)%count;
    if(index===+controls.orbit.value) return;
    controls.orbit.value=index;
    drawView();
  };
  viewport.onpointerup=event=>{
    if(drag?.id===event.pointerId && !drag.moved) point(pointerPixel(event,viewport));
    drag=undefined;
  };
  viewport.onpointercancel=()=>{drag=undefined;};
  mapWrap.onclick=event=>{uv=normalized(event,mapWrap);pixel=undefined;updateSelection();};
  mapWrap.onkeydown=event=>{
    const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(!Object.hasOwn(moves,event.key)) return;
    event.preventDefault();
    const xy=uv?AOV.texel(map,...uv):[0,0], [dx,dy]=moves[event.key];
    uv=[(Math.max(0,Math.min(map.width-1,xy[0]+dx))+.5)/map.width,
      (Math.max(0,Math.min(map.height-1,xy[1]+dy))+.5)/map.height];
    pixel=undefined;
    updateSelection();
  };
  controls.look.onchange=()=>chooseLook(true);
  controls.carrier.onchange=()=>chooseTarget();
  controls.slot.onchange=()=>chooseSlot();
  controls.tile.onchange=()=>chooseTile();
  controls.channel.onchange=chooseMap;
  controls.orbit.oninput=drawView;
  controls.pass.onchange=choosePass;
  options(controls.look,looks.map(row=>[row.id,row.label]));
  el('look-control').hidden=looks.length===1;
  chooseLook(false);
})();
