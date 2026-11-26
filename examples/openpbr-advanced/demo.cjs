const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../..');
const PNG = require('../../cli/png.js');
const files = require('../../cli/asset-files.js');

const root = path.resolve(process.argv[2] ?? 'studio/out/openpbr-advanced');
const samples = Number(process.argv[3] ?? 36), width = Number(process.argv[4] ?? 432);
const action = process.argv[5] ?? 'all';
const at = file => path.join(root, file);
const kit = Ink.load(), P = kit.KIT.procedural;
const ref = (node, port='value') => ({node,port});
const variants = [
  {id:'combined',label:'All lobes',caption:'A glass prism, carved wax, and a coated foil wing over a backlit paper shade.'},
  {id:'no-dispersion',label:'No dispersion',caption:'The prism keeps its refraction and absorption. The white bars lose their colored fringes.'},
  {id:'no-scatter',label:'No scattering',caption:'The wax and paper use their opaque base color, and the prism loses its internal haze.'},
  {id:'no-finish',label:'No finish',caption:'Film, glaze, and fuzz are disabled. The thin-wall and volume materials keep their substrate settings.'}
];

function obj(name, points, uvs, faces) {
  const vertices=points.map(row=>'v '+row.join(' '));
  const texture=uvs.map(row=>'vt '+row.join(' '));
  const polygons=faces.map(row=>'f '+row.map(n=>[n+1,n+1].join('/')).join(' '));
  files.write(at(name),[...vertices,...texture,...polygons].join('\n')+'\n');
  return name;
}

function prism() {
  const outline=[[-.63,.29],[.58,.32],[.48,-.70]];
  const rounded=outline.flatMap(([x,z],i)=>{
    const step=([a,b])=>[x+(a-x)*.047,z+(b-z)*.047];
    return [step(outline[(i+2)%3]),step(outline[(i+1)%3])];
  });
  const points=[], tex=[], faces=[], stride=rounded.length;
  for(const [y,scale] of [[0,.94],[.052,1],[1.27,1],[1.32,.94]]) for(const [i,[x,z]] of rounded.entries()) {
    points.push([x*scale,y,z*scale]); tex.push([i/stride,y/1.32]);
  }
  faces.push([...rounded.keys()].reverse());
  faces.push(rounded.map((_,i)=>3*stride+i));
  for(let band=0;band<3;band++) for(let i=0;i<stride;i++){
    const a=band*stride+i,b=band*stride+(i+1)%stride;
    faces.push([a,b,b+stride,a+stride]);
  }
  return obj('prism.obj',points,tex,faces);
}

function foil() {
  const points=[], tex=[], normal=[], faces=[], uSteps=26, vSteps=13;
  for(let y=0;y<=vSteps;y++) for(let x=0;x<=uSteps;x++) {
    const u=x/uSteps*2-1, v=y/vSteps;
    const span=.05+.59*Math.sin(v*Math.PI)**.75;
    const hook=.16*v*v-.10*Math.sin(v*Math.PI);
    points.push([u*span+hook,1.30*v,.22*Math.sin(Math.PI*v)*(1-u*u)+.12*u*v]);
    tex.push([(u+1)*.5,v]);
    const dx=span,dz=-.44*Math.sin(Math.PI*v)*u+.12*v;
    const sx=.16*2*v-.10*Math.PI*Math.cos(Math.PI*v);
    const sz=.22*Math.PI*Math.cos(Math.PI*v)*(1-u*u)+.12*u;
    normal.push([-1.30*dz,dz*sx-dx*sz,1.30*dx]);
  }
  for(let y=0;y<vSteps;y++) for(let x=0;x<uSteps;x++) {
    const a=y*(uSteps+1)+x, d=a+uSteps+1;
    faces.push([a,a+1,d+1,d]);
  }
  const token=n=>[n+1,n+1,n+1].join('/');
  files.write(at('wing.obj'),[
    ...points.map(row=>'v '+row.join(' ')),...tex.map(row=>'vt '+row.join(' ')),
    ...normal.map(row=>'vn '+row.join(' ')),...faces.map(row=>'f '+row.map(token).join(' '))
  ].join('\n')+'\n');
  return 'wing.obj';
}

function graphAssets() {
  const size=128, thickness=new Float32Array(size*size), fuzz=new Uint8Array(size*size);
  for(let y=0,p=0;y<size;y++) for(let x=0;x<size;x++,p++) {
    const u=(x+.5)/size,v=(y+.5)/size;
    thickness[p]=.23+.54*v+.15*u+.032*Math.sin(29*u+21*v);
    fuzz[p]=Math.round(128*Math.max(0,(Math.abs(2*u-1)-.58)/.42) * Math.sin(Math.PI*v));
  }
  const film=P.graphImages.declare({width:size,height:size,channels:1,data:thickness},{intent:'data',units:'um'});
  files.write(at('film-thickness.exr'),Ink.encodeTexture(film,{encoding:'exr',bitDepth:32}));
  files.write(at('fiber-edge.png'),PNG.encodeGray(size,size,fuzz));
  const assets={
    film:{format:'bitmap',interpretation:{intent:'data',units:'um',sampling:'linear'},source:{file:'film-thickness.exr'}},
    fibers:{format:'bitmap',interpretation:{intent:'mask',sampling:'linear'},source:{file:'fiber-edge.png'}}
  };
  const nodes={
    film:{op:'bitmapAsset',inputs:{name:'film'}},fibers:{op:'bitmapAsset',inputs:{name:'fibers'}},
    maps:{op:'data.record',inputs:{thin_film_thickness:ref('film'),fuzz_weight:ref('fibers')}}
  };
  const parameters={base_color:[.22,.32,.39],base_metalness:.9,specular_ior:1.52,specular_weight:.86,
    specular_color:[.81,.95,1],specular_roughness:.34,specular_roughness_anisotropy:.64,
    thin_film_weight:1,thin_film_ior:2.42,coat_weight:.38,coat_ior:1.33,coat_roughness:.18,
    coat_color:[.68,.94,.94],coat_darkening:.78,coat_roughness_anisotropy:.46,
    geometry_coat_tangent:[0,1,0],fuzz_color:[.93,.68,.42],fuzz_roughness:.25,geometry_thin_walled:true};
  nodes.finished={op:'material.openPbr',inputs:{parameters,maps:ref('maps')}};
  nodes.bare={op:'material.openPbr',inputs:{parameters:{...parameters,thin_film_weight:0,coat_weight:0,fuzz_weight:0}}};
  const doc={format:'ink-studio/graph-project',version:1,assets,nodes,
    outputs:{finished:ref('finished'),bare:ref('bare'),inputs:ref('finished','report')}};
  const source=Ink.openMaterialGraph(doc,{id:'mothglass-foil',baseDir:root});
  source.label='Mothglass foil and fiber';
  Ink.writeMaterialGraph(at('wing.material.json'),source);
}

function build() {
  const prismFile=prism(), foilFile=foil();
  const shade=[[-.55,-.52],[-.60,-.47],[-.57,.40],[-.50,.50],[.43,.57],[.53,.50],[.61,-.40],[.55,-.47]].reverse();
  const shadeFile=obj('paper-shade.obj',shade.map(([x,y])=>[x,y,-.11*(1-x*x)]),
    shade.map(([x,y])=>[x+.5,y+.5]),[shade.map((_,i)=>i)]);
  graphAssets();
  const mesh=(id,file,material,position,rotation,scale)=>({id,kind:'mesh',file,material,position,rotation,scale});
  const plane=(id,material,position,scale,rotation)=>({id,kind:'plane',material,position,scale,rotation});
  const box=(id,material,position,scale,rotation)=>({id,kind:'cube',material,position,scale,rotation});
  const sphere=(id,material,position,scale,rotation)=>({id,kind:'sphere',material,position,scale,rotation});
  const rows=[
    plane('floor','floor',[0,0,0],[9,10,1],[-90,0,0]),
    plane('wall','wall',[0,2.1,-3.1],[12,7,1]),
    box('plinth','floor',[0,.11,0],[2.23,.11,.89],[0,0,0]),
    box('binding','brass',[0,.13,.895],[2.22,.013,.012],[0,0,0]),
    box('prism-seat','brass',[-1.42,.259,.14],[.67,.037,.53],[0,-11,0]),
    mesh('prism',prismFile,'prism',[-1.42,.297,.22],[0,-12,0],[.95,.95,.95]),
    box('target','target',[-1.41,.92,-.92],[.61,.62,.025],[0,0,0]),
    sphere('wax','wax',[-.02,.841,.16],[.53,.61,.32],[0,-13,18]),
    sphere('wax-bead','wax',[.30,.535,.40],[.266,.205,.14],[0,-10,0]),
    box('wax-seat','brass',[-.03,.258,.14],[.58,.037,.41],[0,0,0]),
    box('wing-seat','brass',[1.40,.26,.12],[.56,.041,.42],[0,0,0]),
    mesh('paper-shade',shadeFile,'paper',[1.43,.85,-.02],[0,10,0]),
    plane('cyan-filter','filter',[-1.90,.96,.565],[.104,.694,1],[0,-14,1]),
    box('filter-holder','brass',[-1.91,.492,.575],[.124,.016,.023],[0,-14,1]),
    mesh('foil-wing',foilFile,'wing',[1.38,.30,.22],[0,-9,-17],[.91,.92,1]),
    plane('left-key','softbox',[-3.9,4.08,3.04],[1.82,1.5,1],[147,-15,7]),
    plane('right-rim','cyan',[3.88,2.88,1.28],[.69,1.52,1],[25,-104,0]),
    plane('wax-key','amber',[-.63,3.44,-1.18],[.48,.65,1],[48,12,-15]),
    plane('foil-key','foil-key',[1.9,3.1,2.18],[.68,.93,1],[152,12,-15])
  ];
  for(const [i,x] of [-1.94,-1.84,-1.65,-1.4,-1.07,-.90].entries())
    rows.push(plane('pattern-'+i,i===2||i===4?'cyan-mark':'white-mark',
      [x,.93,-.879],[i%2?.018:.032,.748,1],[0,0,0]));
  const materials={
    floor:{baseColor:[.028,.054,.073],roughness:.37,metalness:.17},
    wall:{baseColor:[.021,.052,.087],roughness:.76},
    target:{baseColor:[.009,.025,.035],roughness:.65},
    brass:{openPbr:{base_color:[.58,.27,.083],base_metalness:1,specular_roughness:.27,specular_roughness_anisotropy:.68}},
    softbox:{baseColor:[0,0,0],emission:[6.3,5.5,4.6]},
    cyan:{baseColor:[0,0,0],emission:[4.2,9.0,11.3]},
    amber:{baseColor:[0,0,0],emission:[14,7.5,3.9]},
    'foil-key':{baseColor:[0,0,0],emission:[6.4,5.7,4.9]},
    filter:{openPbr:{base_weight:0,geometry_thin_walled:true,transmission_weight:1,
      transmission_color:[.13,.72,.79],specular_ior:1.39,specular_roughness:.02,coat_weight:.25,coat_roughness:.03}},
    'white-mark':{baseColor:[0,0,0],emission:[3.45,3.45,3.45]},
    'cyan-mark':{baseColor:[0,0,0],emission:[.72,2.3,2.8]}
  };
  const glass={transmission_weight:1,transmission_color:[.69,.89,.96],transmission_depth:1.26,
    transmission_scatter:[.022,.045,.046],transmission_scatter_anisotropy:.41,
    transmission_dispersion_scale:.98,transmission_dispersion_abbe_number:9.2,
    base_weight:0,specular_roughness:.028,specular_ior:1.65};
  const wax={base_color:[.47,.165,.065],specular_roughness:.31,specular_weight:.54,
    subsurface_weight:.91,subsurface_color:[.96,.58,.25],subsurface_radius:.40,
    subsurface_radius_scale:[1,.61,.29],subsurface_scatter_anisotropy:.24,
    coat_weight:.24,coat_roughness:.24,coat_color:[.97,.70,.36],coat_ior:1.37,fuzz_weight:.09,fuzz_roughness:.63};
  const paper={geometry_thin_walled:true,base_color:[.61,.35,.12],specular_ior:1.35,specular_weight:.31,
    specular_roughness:.57,base_diffuse_roughness:.34,subsurface_weight:.94,
    subsurface_color:[.98,.74,.37],subsurface_scatter_anisotropy:.82,
    fuzz_weight:.14,fuzz_color:[.65,.39,.12],fuzz_roughness:.77};
  for(const {id,label} of variants) {
    const scatter=id!=='no-scatter', finish=id!=='no-finish';
    const plan={format:'ink-studio/physical-reference',version:1,label:'Mothglass / '+label,
      metersPerUnit:.01,view:{width,height:Math.round(width*.64)},
      settings:{quality:'final',samples,batch:samples,seed:774901,bounces:11,exposure:.08,denoise:'strong'},
      camera:{target:[0,.83,.04],yaw:10,pitch:9,distance:7.15,focalLength:51},
      lights:[{position:[1.35,1.02,-.63],intensity:[2.55,1.42,.60]},
        {position:[1.73,.50,-.55],intensity:[1.25,.63,.27]}],
      environment:{color:[.16,.25,.39],strength:.38,background:false},meshes:rows,
      materials:{...materials,
        prism:{openPbr:{...glass,...(!scatter&&{transmission_scatter:[0,0,0]}),
          ...(id==='no-dispersion'&&{transmission_dispersion_scale:0})}},
        wax:{openPbr:{...wax,...(!scatter&&{subsurface_weight:0}),...(!finish&&{coat_weight:0,fuzz_weight:0})}},
        paper:{openPbr:{...paper,...(!scatter&&{subsurface_weight:0}),...(!finish&&{fuzz_weight:0})}},
        wing:{graph:{file:'wing.material.json',output:finish?'finished':'bare'}}
      }};
    files.json(at(id+'.plan.json'),plan);
  }
}

function review() {
  const receipts={};
  for(const {id} of variants) {
    const filename=at(path.join(id,'report.json'));
    if(fs.existsSync(filename)) {
      const {stats,openPbr,settings}=JSON.parse(fs.readFileSync(filename,'utf8'));
      receipts[id]={stats,inputs:Object.fromEntries(['prism','wax','paper','wing','filter'].map(name=>[name,openPbr.materials[name].fields])),
        samples:settings.samples};
    }
  }
  const html=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
  files.write(at('index.html'),html.replace('/*MOTHGLASS*/',()=>JSON.stringify({variants,receipts}).replaceAll('<','\\u003c')));
}
async function main() {
  if(action==='review') return review();
  if(action==='prepare'||action==='all') build();
  if(action==='prepare') return;
  const selected=action==='all'?variants:variants.filter(row=>row.id===action);
  if(!selected.length) throw new Error('Expected one Mothglass variant, prepare, review, or all');
  for(const {id,label} of selected) {
    const report=await Ink.writePhysicalReference(at(id+'.plan.json'),{directory:at(id),toolkit:kit});
    console.log(label+' · '+report.totalSamples+' spp · '+JSON.stringify(report.stats));
  }
  if(action==='all') review();
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
