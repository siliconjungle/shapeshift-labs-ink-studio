/* A relay beacon with one artist-pinned edge and a diagnostic UV atlas. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const studio=require('..');
const {KIT:K,makeBuilder,makeSculpt}=studio.load();
const {views}=require('../cli/mesh-uv.js');
const PNG=require('../cli/png.js');
const G=K.procedural.geometry;

function beacon() {
  const points=[],triangles=[],uvs=[],protectedSeams=[],shared=new Map();
  const outline=[[-.81,-.72],[.81,-.72],[1.12,-.41],[1.12,.41],[.81,.72],[-.81,.72],[-1.12,.41],[-1.12,-.41]];
  const rings=[[.9,-.55],[1,-.42],[1,.43],[.9,.58]];
  const positions=rings.map(([scale,z])=>outline.map(([x,y])=>[x*scale,y*scale+1.08,z]));
  const vertex=p=>{
    const rounded=p.map(x=>Math.round(x*1e8)*1e-8), key=rounded.join('/');
    if(!shared.has(key)){shared.set(key,points.length);points.push(rounded);}
    return shared.get(key);
  };
  function patch(corners, coords, count) {
    const blend=(rows,u,v)=>rows[0].map((n,k)=>n*(1-u-v)+rows[1][k]*u+rows[2][k]*v);
    const grid=Array.from({length:count+1},(_,i)=>Array.from({length:count-i+1},(_,j)=>
      [vertex(blend(corners,i/count,j/count)),blend(coords,i/count,j/count)]));
    function face(a,b,c) {
      triangles.push([a[0],b[0],c[0]]);
      uvs.push([a[1],b[1],c[1]]);
    }
    for (let i=0;i<count;i++) for (let j=0;j<count-i;j++) {
      face(grid[i][j],grid[i+1][j],grid[i][j+1]);
      if(j+1<count-i)face(grid[i+1][j],grid[i+1][j+1],grid[i][j+1]);
    }
    return grid;
  }
  const octagon=(front)=>positions[front?3:0];
  for (const front of [true,false]) {
    const ring=octagon(front);
    const center=[0,1.08,ring[0][2]];
    const map=([x,y])=>front?[.304+x*.238,.341-(y-1.08)*.403]:[.795+x*.162,.245-(y-1.08)*.31];
    for (let i=0;i<8;i++) {
      const s=front?i:(i+1)%8, t=front?(i+1)%8:i, corners=[center,ring[s],ring[t]];
      const patchGrid=patch(corners,corners.map(map),10);
      if(front&&i===1)for(let j=0;j<10;j++)protectedSeams.push([patchGrid[j][0][0],patchGrid[j+1][0][0]]);
    }
  }
  for (let i=0;i<8;i++) {
    const next=(i+1)%8, x=.025+(i%4)*.24, y=i<4?.706:.875;
    const span=i===3?.103:.211, height=i===6?.039:.105;
    const left=i===5?x-.05:x, seamX=[left,left+span];
    const ts=[0,.16,.81,1];
    for(let k=0;k<3;k++){
      const a=positions[k][i],b=positions[k][next],c=positions[k+1][next],d=positions[k+1][i];
      const [u,v]=seamX, low=y+height*ts[k], high=y+height*ts[k+1];
      patch([a,b,c],[[u,low],[v,low],[v,high]],10);
      patch([a,c,d],[[u,low],[v,high],[u,high]],10);
    }
  }
  return {points,triangles,uvs,protectedSeams};
}

function atlas() {
  const width=256,height=256,pixels=new Uint8Array(width*height*4);
  const metal=[0x3a4b4e,0x556764,0x7a8271,0xc3a873,0xe0c181,0x3b353e];
  const digits=[
    ['111','101','101','101','111'],
    ['111','101','111','001','111']
  ];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(x+.5)/width, v=(y+.5)/height;
    let color=0x31424a;
    if(u<.56&&v<.66){
      const s=(u-.304)/.242, t=(v-.341)/.269, r=Math.hypot((s+.11)*.72,(t+.13)*.91);
      const border=Math.max(Math.abs(s),Math.abs(t),.61*(Math.abs(s)+Math.abs(t)));
      color=border>.91?metal[t<0?4:2]:border>.84?metal[0]:metal[t+s*.32<-.16?3:2];
      if(r<.68)color=r>.59?metal[5]:r>.53?metal[4]:r>.46?0x345051:r>.40?0x172b38:0x285d64;
      if(r<.41&&(Math.abs(s+.11)<.016||Math.abs(t+.13)<.019))color=0x62bdb6;
      if(r<.36 && t<-.17&&(Math.floor(x/5)+Math.floor(y/4))%3===0)color=0x408b86;
      if(r<.42 && Math.abs(t+.38+.18*s)<.04)color=0x92ddd0;
      if(r<.31 && Math.abs(t+.13+.21*s)<.025)color=0xabebcf;
      if(t>.59&&t<.80&&s>-.73&&s<.63){
        color=0x232e36;
        if((x%8)<3&&y>Math.round(.508*height)&&y<Math.round(.543*height))color=0xda7c58;
      }
      if(s>.63&&s<.87&&t>-.14&&t<.35)color=0x2d3a37;
      const tx=x-102, ty=y-80, digit=Math.floor(tx/8);
      if(digit>=0&&digit<2&&tx%8<6&&ty>=0&&ty<10&&digits[digit][Math.floor(ty/2)][Math.floor((tx%8)/2)]==='1')
        color=0xffdb9c;
    } else if(v<.59 && u>.56) {
      color=(Math.floor(y/6)%3) ? 0x4b706d : 0x304f51;
    } else if (v>.69) {
      const id=Math.floor(u/.24), row=v>.856;
      const shine=(!row&&v<.735)||(row&&v<.900);
      color=metal[shine?4:2];
      if(id%2===0 && ((x+2*y)%17<5))color=shine?0x8c6b52:0x59645d;
      if(id===1&&row)color=(x+y)%18<6?0x334341:0xb48358;
      if(y%19<2)color=0x2c3e43;
    }
    pixels.set([color>>16,color>>8&255,color&255,255],(y*width+x)*4);
  }
  return {width,height,pixels};
}

function nativeMesh(shape,id,texture) {
  const positions=[],uvs=[],indices=[],vertex=new Map();
  for (const [i,face] of shape.triangles.entries()) for(const [j,p] of face.entries()) {
    const uv=shape.uvs[i][j], key=[p,...uv.map(n=>n.toFixed(9))].join('/');
    if(!vertex.has(key)){
      vertex.set(key,positions.length/3); positions.push(...shape.points[p]); uvs.push(...uv);
    }
    indices.push(vertex.get(key));
  }
  return K.sceneMeshes.create({id,positions,uvs,indices,materials:[{id:'relay-atlas',texture}]});
}

function show(mesh) {
  const B=makeBuilder(1,[0x1b2634,0x293a4a,0x415360,0x60727a,0x8a948b,0xc3a873]);
  const S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:[-.56,.65,.47],amb:.45,sky:.14,sunK:.48,wob:0});
  S.lathe([0,-.26,0],.49,[1.58,1.58,1.44,1.39],{r:[1,2,3,4]},{res:.072,objectId:'display-plinth'});
  S.lathe([0,.17,0],.09,[1.35,1.39],{r:[2,3,4,5]},{res:.064,objectId:'display-top'});
  S.bake();
  return B.finish({meshes:[mesh],cam:{target:[0,1.04,0],dist:4.85,ortho:true,pitch:.17,yaw:.32,sway:0},
    radius:4,dither:0,look:{splatCoverage:'continuous'},skyEnvironment:{
      defaults:{zenith:'#202c41',horizon:'#70828a',ground:'#19212d',sunStrength:0}}});
}

function main(dir) {
  const out=path.resolve(dir), original=beacon(), texture=atlas();
  const reduced=G.simplifyQEM(original,{ratio:.29});
  assert(reduced.triangles.length<original.triangles.length*.7);
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'relay-atlas.png'),PNG.encode(texture.width,texture.height,texture.pixels,4));
  for (const [tag,shape] of [['original',original],['reduced',reduced]]) {
    const report=G.inspectUV(shape,{size:texture.width,padding:6});
    const {atlas,seams}=views(shape,report,'Tide relay / '+tag);
    for(const [name,data] of [['report.json',JSON.stringify(report,null,2)+'\n'],['atlas.svg',atlas],['seams.svg',seams]])
      fs.writeFileSync(path.join(out,tag+'-'+name),data);
    const model={name:'Tide relay',points:shape.points,faces:shape.triangles,uvs:shape.uvs,
      materials:[{name:'Relay atlas',color:[1,1,1],texture}]};
    studio.exportGlb(model,{out:path.join(out,tag+'.glb'),textureSize:256});
    const world=show(nativeMesh(shape,tag,texture));
    for(let i=0;i<24;i++){
      const frame=studio.render(world,{w:280,h:198,px:1,raw:true,yaw:.32+.73*Math.sin((i/23)*Math.PI*2)});
      PNG.write(path.join(out,tag+'-'+String(i).padStart(2,'0')+'.png'),frame.w,frame.h,frame.rgb);
    }
    console.log(tag,report.summary);
  }
  fs.writeFileSync(path.join(out,'protected-seams.json'),JSON.stringify(original.protectedSeams)+'\n');
  fs.writeFileSync(path.join(out,'relay.uv.json'),JSON.stringify(original)+'\n');
  const seamKey=edge=>edge.uses.map(u=>JSON.stringify([edge.position,u.uv])).sort().join('|');
  const a=G.inspectUV(original), b=G.inspectUV(reduced);
  const after=new Set(b.seams.filter(e=>e.protected||e.kind==='seam').map(seamKey));
  assert(a.seams.filter(e=>e.protected||e.kind==='seam').every(e=>after.has(seamKey(e))));
  const {status,work}=reduced;
  fs.writeFileSync(path.join(out,'reduction.json'),JSON.stringify({status,work,sourceTriangles:original.triangles.length,
    triangles:reduced.triangles.length,uvCuts:b.summary.uvSeams,protectedEdges:b.summary.protectedSeams},null,2)+'\n');
}
if(require.main===module) main(process.argv[2]??'uv-seam-review');
module.exports={beacon,atlas,nativeMesh,show};
