const PNG = require('./png.js');
const Grid = require('./uv-bake-grid.js');
const { area2 } = require('./glb-uv.js');
const { topology } = require('./curvature-topology.js');

const outline = 'uv-outline';
const debugMap = map => map === 'coverage' || map === outline;
const colors = ['#62c6b1','#f5aa68','#929cee','#e38cac','#d5cd74','#78bde7','#bd9de2','#acc981'];
const conflict = [255,77,117];
const ink = [255,218,155];
const rgba = (size,pixels) => PNG.encode(size,size,pixels,4,{srgb:true});
const swatch = id => colors[id-1] ?? '#' + ((Math.imul(id,0x9e3759) & 0xbfbfbf) | 0x404040).toString(16).padStart(6,'0');
const rgb = hex => [1,3,5].map(index=>parseInt(hex.slice(index,index+2),16));
const coverageNames = { coverage:'coverage', [outline]:'outline' };

function charts(selection,K) {
  const uv = selection.uvSet, metadata=[], indices=[];
  for(const [i,face] of selection.metadata.entries()) {
    if(face.selected && face.charts[uv] && area2(...face.charts[uv])!==0) {
      metadata.push(face);
      indices.push(i);
    }
  }
  const {faceCharts,manifold}=topology({metadata,uvSet:uv},'chart',K);
  const ids=new Map(), owner=new Map(), internal=new Map();
  for (const [i,root] of faceCharts.entries()) {
    if(!ids.has(root))ids.set(root,ids.size+1);
    owner.set(indices[i],ids.get(root));
  }
  for(const pair of manifold)for(const {face,i} of pair) {
    const source=indices[face];
    internal.set(source,(internal.get(source)??0)|(1<<i));
  }
  return {owner,internal};
}

function segment(a,b,tile) {
  let start=0,end=1;
  for(let c=0;c<2;c++) {
    const d=b[c]-a[c], bound=tile[c];
    if(!d) {
      if(a[c]<bound||a[c]>bound+1)return;
    } else {
      const x=(bound-a[c])/d,y=(bound+1-a[c])/d;
      start=Math.max(start,Math.min(x,y));
      end=Math.min(end,Math.max(x,y));
    }
  }
  if(end<=start)return;
  return [start,end].map(t=>a.map((n,c)=>Math.max(0,Math.min(1,n+(b[c]-n)*t-tile[c]))));
}

function outlines(selection,tile,layout) {
  const lines=new Map();
  for(const i of new Set(tile.source)) {
    const id=layout.owner.get(i), uv=selection.metadata[i].charts[selection.uvSet];
    if(!lines.has(id))lines.set(id,[]);
    const edges=lines.get(id), hidden=layout.internal.get(i)??0;
    for(let c=0;c<3;c++) {
      if(hidden&(1<<c))continue;
      const clipped=segment(uv[c],uv[(c+1)%3],tile.tile);
      if(clipped)edges.push(clipped);
    }
  }
  return lines;
}

const coordinate = point => point.map(n=>Number(n.toFixed(10))).join(' ');
const svg = (title,body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1024" height="1024">\n'+
  '<title>'+title+'</title>\n'+body+'\n</svg>\n';
const linePath = ([a,b]) => 'M'+coordinate(a)+'L'+coordinate(b);

function vectors(tile,layout,lines) {
  const fill=new Map();
  for(const [i,tri] of tile.uvs.entries()) {
    const id=layout.owner.get(tile.source[i]), [a,b,c]=tri;
    const points=area2(a,b,c)>0?[a,b,c]:[a,c,b];
    if(!fill.has(id))fill.set(id,[]);
    fill.get(id).push('M'+points.map(coordinate).join('L')+'Z');
  }
  return {
    outline:svg('UV chart outlines',[...lines].filter(([,edges])=>edges.length).map(([id,edges])=>
      '<path data-chart="'+id+'" fill="none" stroke="#ffda9b" stroke-width="1.2" vector-effect="non-scaling-stroke" d="'+
        edges.map(linePath).join('')+'"/>').join('\n')),
    coverage:svg('UV surface coverage',[...fill].map(([id,paths])=>
      '<path data-chart="'+id+'" fill="#fff" d="'+paths.join('')+'"/>').join('\n'))
  };
}

function rasterOutline(lines,size) {
  const pixels=new Uint8Array(size*size*4);
  const sample=n=>Math.min(size-1,Math.floor(n*size));
  for(const edges of lines.values())for(const [a,b] of edges) {
    let [x,y]=a.map(sample);
    const [x1,y1]=b.map(sample),dx=Math.abs(x1-x),dy=-Math.abs(y1-y),sx=Math.sign(x1-x),sy=Math.sign(y1-y);
    let error=dx+dy;
    while(true) {
      pixels.set(ink,(y*size+x)*4);
      pixels[(y*size+x)*4+3]=255;
      if(x===x1&&y===y1)break;
      const two=2*error;
      if(two>=dy){error+=dy;x+=sx;}
      if(two<=dx){error+=dx;y+=sy;}
    }
  }
  return rgba(size,pixels);
}

function rasterOwnership(tile,layout,size,padding) {
  const count=size*size, owners=new Uint32Array(count), covered=new Uint8Array(count);
  const interiors=new Uint8Array(count), footprint=new Uint8Array(count), overlap=new Uint8Array(count);
  const rows=new Map();
  let texels=0,collisions=0,gutters=0;
  for(const [face,uv] of tile.uvs.entries()) {
    const id=layout.owner.get(tile.source[face]);
    if(!rows.has(id))rows.set(id,{id,color:swatch(id),texels:0,gutter:0});
    const row=rows.get(id);
    Grid.samples(Grid.triangle(uv,size),size,(i,_u,_v,interior)=>{
      if(interior) {
        if(interiors[i]&&!overlap[i]) {overlap[i]=1;collisions++;}
        interiors[i]=1;
      }
      if(covered[i])return;
      owners[i]=id;
      covered[i]=1;
      footprint[i]=255;
      row.texels++;
      texels++;
    });
  }
  Grid.gutters(covered,size,padding,()=>true,(from,to,next)=>{
    if(covered[to])return;
    const id=owners[from];
    covered[to]=1;
    owners[to]=id;
    rows.get(id).gutter++;
    gutters++;
    next.push(to);
  });
  const palette=new Map([...rows].map(([id,row])=>[id,rgb(row.color)])), pixels=new Uint8Array(count*4);
  for(let i=0;i<count;i++)if(covered[i]) {
    const at=i*4;
    pixels.set(overlap[i]?conflict:palette.get(owners[i]),at);
    pixels[at+3]=overlap[i]?255:footprint[i]?230:110;
  }
  return {coverage:PNG.encodeGray(size,size,footprint),ownership:rgba(size,pixels),texels,
    charts:rows.size,palette:[...rows.values()].sort((a,b)=>a.id-b.id).slice(0,64),overlaps:collisions,gutters};
}

function create(tasks,write,K) {
  if(!tasks.some(task=>debugMap(task.map)))return ()=>undefined;
  const groups=new Map(), after=new Map(), sources=new Map();
  let vectorsWritten=0;
  const keyOf=({authored,tile,settings})=>JSON.stringify([authored.id,tile.tile,settings.size,settings.padding]);
  for(const task of tasks) {
    const key=keyOf(task);
    if(!groups.has(key))groups.set(key,new Set());
    groups.get(key).add(task.map);
  }
  return task=>{
    const key=keyOf(task);
    if(after.has(key))return after.get(key);
    const {authored,selection,tile,settings:{size,padding}}=task;
    if(!sources.has(authored.id))sources.set(authored.id,{layout:charts(selection,K),tiles:new Map()});
    const {layout,tiles}=sources.get(authored.id);
    const [u,v]=tile.tile, root='uv-debug/'+authored.id+'/'+u+'_'+v, tileKey=tile.tile.join(',');
    if(!tiles.has(tileKey)) {
      vectorsWritten+=tile.uvs.length;
      if(vectorsWritten>1e6)throw new RangeError('UV debug exceeds one million vector triangles. Bake fewer tiles at a time.');
      const lines=outlines(selection,tile,layout);
      const vector=vectors(tile,layout,lines);
      const files={outlineSvg:root+'/outline.svg',coverageSvg:root+'/coverage.svg'};
      write(files.outlineSvg,vector.outline);
      write(files.coverageSvg,vector.coverage);
      tiles.set(tileKey,{lines,files});
    }
    const vector=tiles.get(tileKey), grid=root+'/'+size+'-'+padding, maps=groups.get(key);
    const mapPath=map=>maps.has(map)?'maps/'+authored.id+'/'+u+'_'+v+'/'+map+'.png':
      grid+'/'+coverageNames[map]+'.png';
    const files={...vector.files,coverage:mapPath('coverage'),outline:mapPath(outline),ownership:grid+'/ownership.png'};
    const {coverage,ownership,...raster}=rasterOwnership(tile,layout,size,padding);
    const hashes={coverage:write(files.coverage,coverage),outline:write(files.outline,rasterOutline(vector.lines,size))};
    write(files.ownership,ownership);
    const result={
      entry:{target:authored.id,tile:tile.tile,tileLabel:tile.label,size,padding,files,...raster},
      hashes
    };
    after.set(key,result);
    return result;
  };
}

module.exports = { outline, debugMap, create };
