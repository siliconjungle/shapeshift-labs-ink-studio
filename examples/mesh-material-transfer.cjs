/* A replacement cage for a painted harbour survey case. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const Composite = require('../src/frame-composite.js');
const { fixture: fieldCase } = require('./mesh-uv-workshop.cjs');
const { render, worldFor } = require('../cli/mesh-native-view.js');

function indexedPlate(K) {
  const width = 128, height = 96, indices = new Uint8Array(width * height), seal = new Uint8Array(indices.length);
  const palette = [0x0d222f, 0x173340, 0x285561, 0x367580, 0x59949a, 0x94beb8,
    0xf0d99c, 0xeabc69, 0xd27c54, 0x285561, 0xf7eac3, 0x292f42];
  const put = (x,y,n) => { indices[y * width + x] = n; };
  const box = (x,y,w,h,n) => {
    for (let iy=y; iy<y+h; iy++) for (let ix=x; ix<x+w; ix++) put(ix,iy,n);
  };
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const check=(Math.floor(x/4)+Math.floor(y/3))%2;
    put(x,y,(x*13+y*17)%31 === 0 ? 4 : (check ? 2 : 9));
  }
  for (const [x,w] of [[5,29],[35,47],[82,34]]) {
    box(x,26,w,29,2);
    box(x,27,w,2,4);
    box(x,53,w,1,0);
    box(x,30,w,1,3);
  }
  box(37,32,43,17,1);
  box(38,33,41,1,2);
  box(42,44,33,1,3);
  box(39,37,2,2,8); box(77,37,2,2,8);
  for (let x=43; x<74; x+=3) box(x,47,2,1,x<62?5:3);
  for (const x of [17,24,91,98,105]) {
    box(x,36,3,12,1); box(x+1,38,1,4,7);
  }
  box(2,79,43,13,1); box(5,81,37,2,3);
  const glyphs = K.ascii.atlas();
  for (const [i, ch] of [...'TIDE07'].entries()) {
    const glyph = glyphs.chars.indexOf(ch), u = glyph % glyphs.per * 6, v = Math.floor(glyph / glyphs.per) * 8;
    for (let y=0; y<8; y++) for (let x=0; x<6; x++) if (glyphs.font.data[(v+y)*glyphs.font.w+u+x]) {
      put(41+i*6+x,35+y,10);
      seal[(35+y)*width+41+i*6+x] = 255;
    }
  }
  return { id:'enamel', texture:{width,height,indices:Array.from(indices),palette}, masks:{seal:Array.from(seal)} };
}

function fixture(kit) {
  const { KIT: K } = kit, topology = K.meshTopology, base = fieldCase(kit).doc;
  const vertices = base.vertices.concat([
    ['a0',[-.77,-.665,.531]], ['a1',[-.10,-.665,.531]], ['a2',[.57,-.665,.531]],
    ['a3',[-.77,-.452,.531]], ['a4',[-.10,-.452,.531]], ['a5',[.57,-.452,.531]]
  ].map(([id,position]) => ({ id,position })));
  const face = (id, material, ring, uv) => ({ id, material, corners: ring.map((vertex,i) => ({
    id:id+'/'+vertex, vertex, uv:uv?.[i] })) });
  const panel = base.faces.find(row => row.id==='faceplate');
  const sourcePanel = { ...panel, corners:panel.corners.map(corner => ({ ...corner, normal:[0,0,1],
    attributes:{ wetness:corner.uv[0] } })) };
  const left=face('badge-port','brass',['a0','a1','a4','a3'],[[0,.85],[.42,.85],[.42,.15],[0,.15]]);
  const right=face('badge-starboard','brass',['a1','a2','a5','a4'],[[.58,.85],[1,.85],[1,.15],[.58,.15]]);
  const retained = base.faces.filter(row => row.id!=='faceplate');
  const source = topology.create({ id:base.id,vertices,faces:[sourcePanel,...retained,left,right] });
  const sector = panel.corners.map(({ vertex },i) => face('panel-sector-'+i,'blank',
    [vertex,panel.corners[(i+1)%panel.corners.length].vertex,'panel-inset']));
  const replacementVertices = [...vertices,{ id:'panel-inset',position:[.18,.087,.51] }];
  const stripped = faces => faces.map(row => face(row.id,'blank',row.corners.map(corner=>corner.vertex)));
  const common = { id:base.id,vertices:replacementVertices };
  const replacement = topology.create({ ...common,faces:[...sector,...stripped(retained),
    face('badge-merged','review',['a0','a2','a5','a3'])] });
  const repaired = topology.create({ ...common,faces:[...sector,...stripped(retained),
    face('badge-port-new','blank',['a0','a1','a4','a3']),face('badge-starboard-new','blank',['a1','a2','a5','a4'])] });
  const badge = { id:'brass',texture:{width:32,height:12,palette:[0x3f2731,0x955843,0xd49563,0xefd381],
    indices:Array.from({length:384},(_,i) => {
      const x=i%32,y=Math.floor(i/32);
      if (y===3 || y===8) return 3;
      if (y>=4&&y<=7&&((x+1)%5<2||x>23)) return 1;
      return (x+y)%11===0?3:2;
    })} };
  const inherited = sector.map(row=>({from:'faceplate',to:row.id}));
  return { source,replacement,repaired,materials:[indexedPlate(K),badge],
    mergedLineage:{faces:[...inherited,{from:left.id,to:'badge-merged'},{from:right.id,to:'badge-merged'}]},
    repairedLineage:{faces:[...inherited,{from:left.id,to:'badge-port-new'},{from:right.id,to:'badge-starboard-new'}]} };
}

function demo(directory) {
  const kit = ink.load(), { KIT: K } = kit, data = fixture(kit), dir = path.resolve(directory);
  fs.mkdirSync(dir,{recursive:true});
  const save = (name,value) => {
    const file = path.join(dir,name + '.json');
    fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
    return file;
  };
  const run = (...args) => execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'mesh-topology',...args],
    {stdio:['ignore','pipe','inherit']});
  const source = save('original',data.source), materials = save('materials',data.materials);
  const projection = (name, doc, lineage, partial) => {
    const next = save(name + '-cage',doc);
    const map = path.join(dir,name+'-revision-map.json'), receipt = path.join(dir,name+'-receipt.json');
    const mesh = path.join(dir,name+'.json'), transferred = path.join(dir,name+'-materials.json');
    run('correspond',source,next,'--lineage',save(name+'-lineage',lineage),'--out',map);
    run('transfer-materials',source,next,map,'--materials',materials,'--out-materials',transferred,
      '--out',mesh,'--report',receipt,...(partial?['--partial','on']:[]));
    const read = file => JSON.parse(fs.readFileSync(file));
    return { document:read(mesh),materials:read(transferred),report:read(receipt) };
  };
  const merged=projection('seam-review',data.replacement,data.mergedLineage,true);
  const final=projection('repaired',data.repaired,data.repairedLineage,false);
  assert.deepEqual(merged.report.issues.map(row=>row.reason),['uv-seam']);
  assert(final.report.complete);
  const indexed=final.materials.find(row=>row.id==='enamel');
  assert.deepEqual(indexed,data.materials[0]);
  const texture=indexed.texture, rgb=n=>[n>>16,n>>8&255,n&255];
  PNG.writeIndexed(path.join(dir,'retained-pigment.png'),texture.width,texture.height,texture.indices,texture.palette.map(rgb));
  fs.writeFileSync(path.join(dir,'retained-seal-mask.png'),PNG.encodeGray(texture.width,texture.height,Uint8Array.from(indexed.masks.seal)));
  const view={w:260,h:186,raw:true,t:0,camera:{target:[0,0,0],dist:6.6,yaw:.38,pitch:.21,ortho:true}};
  const reviewTexture={id:'review',texture:{width:4,height:4,palette:[0xe17e91,0x6c475c],
    indices:[0,1,0,0,0,0,1,0,0,0,0,1,1,0,0,0]}};
  function shot(name, doc, active) {
    const sceneView={...view,materials:active};
    const frame=render(worldFor(doc,sceneView,kit),sceneView,kit);
    PNG.write(path.join(dir,name+'.png'),frame.w,frame.h,frame.rgb);
    return frame;
  }
  const src=shot('original',data.source,data.materials);
  const rejected=shot('seam-review',merged.document,[...merged.materials,reviewTexture]);
  const fixed=shot('repaired',final.document,final.materials);
  const width=804,height=448, layers=[], draw=[];
  const text=(message,at,size,color='#cbdfe4')=>draw.push({type:'text',text:message,at,size,color});
  text('TIDE SURVEY CASE  /  07',[402,21],16,'#f5deae');
  text('MATERIAL TRANSFER THROUGH A REPLACEMENT CAGE',[402,42],9);
  for (const [i,frame] of [src,rejected,fixed].entries()) {
    const x=8+i*264;
    layers.push({source:frame,rect:[x,77,260,186]});
    text(['ORIGINAL PAINT','MERGED SEAM NEEDS REVIEW','SEAM RESTORED ON REPLACEMENT'][i],[x+130,64],9,
      i===1?'#f0a0aa':'#cbdfe4');
  }
  function atlas(name,x,y,w,h) {
    const image=PNG.raster(path.join(dir,name+'.png'));
    layers.push({source:{w:image.w,h:image.h,rgba:image.data},rect:[x,y,w,h]});
  }
  atlas('retained-pigment',86,278,192,144);
  atlas('retained-seal-mask',305,278,192,144);
  text('INDEXED PIGMENT',[182,433],9);
  text('REGISTERED SEAL MASK',[401,433],9);
  const exact=final.report.transferred.reduce((n,row)=>n+row.exactCorners,0);
  const sampled=final.report.transferred.reduce((n,row)=>n+row.projectedCorners,0);
  text('REPAIRED CAGE',[632,298],11,'#f5deae');
  text(final.report.transferred.length+' FACES TRANSFERRED',[632,325],9);
  text(exact+' EXACT CORNERS',[632,347],9);
  text(sampled+' PROJECTED CORNERS',[632,367],9);
  text('PALETTE INDICES KEPT',[632,400],9,'#8fd6ca');
  const plan=K.frameComposite.prepare({ layers:[...layers,{ draw }] },width,height,1);
  const sheet=Composite.compose({ w:1,h:1,rgb:Uint8Array.of(12,22,31) },
    K.frameComposite.layers(plan,{},0),width,height,'nearest');
  PNG.write(path.join(dir,'comparison.png'),width,height,sheet.rgb);
}

if (require.main === module) demo(process.argv[2] ?? 'mesh-material-transfer-review');
module.exports = { fixture };
