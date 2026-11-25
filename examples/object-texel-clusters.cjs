/* Restore the enamel band on a rotating harbour signal lantern. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const ink=require('..');
const PNG=require('../cli/png.js');
const Composite=require('../src/frame-composite.js');

const oldBand=0xb78253;
const newBand=0x4caa99;
const sectors=8;
const rings=[[-.91,.46],[-.82,.65],[-.68,.66],[-.58,.58],[-.45,.62],[-.13,.63],
  [-.075,.68],[.52,.69],[.65,.72],[.75,.59],[.83,.29],[.96,.22],[1.01,.19]];

function geometry() {
  const points=[],triangles=[];
  for(const [y,r] of rings) for(let i=0;i<sectors;i++) {
    const a=(i+.5)*2*Math.PI/sectors;
    points.push(r*Math.sin(a),y,.9*r*Math.cos(a));
  }
  for(let ring=0;ring<rings.length-1;ring++) for(let i=0;i<sectors;i++) {
    const a=ring*sectors+i,b=ring*sectors+(i+1)%sectors,c=a+sectors,d=b+sectors;
    triangles.push(a,b,c,b,d,c);
  }
  const cap=points.length/3;
  points.push(0,rings[0][0],0,0,rings.at(-1)[0],0);
  const last=(rings.length-1)*sectors;
  for(let i=0;i<sectors;i++) {
    const j=(i+1)%sectors;
    triangles.push(cap,j,i,cap+1,last+i,last+j);
  }
  return {points,triangles};
}

function finish(K) {
  const {font,per,chars}=K.ascii.atlas();
  function glyph(message,x,y) {
    const u=Math.floor((x+.365)*message.length*6/.73),v=Math.floor((.345-y)*8/.27);
    if(u<0||u>=message.length*6||v<0||v>=8) return false;
    const slot=chars.indexOf(message[Math.floor(u/6)]);
    return font.data[(Math.floor(slot/per)*8+v)*font.w+(slot%per)*6+u%6];
  }
  return ({point:[x,y,z],face=0,x:ix=0,y:iy=0})=>{
    const a=Math.atan2(x,z), local=((a+Math.PI/8+8*Math.PI)%(Math.PI/4))/ (Math.PI/4);
    const grain=(ix*29+iy*17+face*13)%19;
    if(y>=-.45&&y<=-.15) return {pigment:oldBand,roughness:.39,metalness:.34};
    if(y>.76 || y<-.56) {
      const trim=y>.81&&y<.91 || y<-.70&&y>-.81;
      return {pigment:trim?(grain<3?0xceac70:0x896346):(grain<4?0x3f5660:0x243845),
        roughness:trim?.34:.66,metalness:trim?.42:.14};
    }
    if(y>.55 || y<-.45) return {pigment:grain<4?0x7d8e7a:0x344f55,roughness:.57};
    const brace=local<.19||local>.81, socket=(local<.22||local>.78)&&(y>.35&&y<.43||y<.015&&y>-.06);
    if(socket) return {pigment:0xd1b37e,roughness:.32,metalness:.47};
    if(brace) return {pigment:grain<4?0x668280:0x36565b,roughness:.54};
    if(z>.48 && glyph('KITE',x,y)) return {pigment:0xf1ba72,emission:0xb76d37,roughness:.55};
    if(Math.abs(x)>.48 && y>.03&&y<.35) {
      const scale=(Math.floor(z*29)+Math.floor(y*20))%4;
      return {pigment:scale===0?0x946745:0x29444c,emission:scale===0?0x8a4422:0,roughness:.43};
    }
    const ribs=Math.floor(y*29)%3===0;
    return {pigment:ribs?0x2c4551:grain<4?0x496b6c:0x3a5a62,roughness:.51};
  };
}

async function demo(directory) {
  const dir=path.resolve(directory),kit=ink.load(),{KIT:K}=kit,api=await import('../webgl.mjs');
  fs.mkdirSync(dir,{recursive:true});
  const mesh=geometry(),material=finish(K),resolution=20,origin=[.007,.019,.011];
  const baked=api.bakeObjectTexels(mesh,{resolution,origin,material,fallback:(_,normal,cell)=>material({...cell,normal})});
  const occupied=baked.cells.filter(Boolean);
  const bakeSource={format:'ink-studio/object-texel-source',version:1,id:'kite-7',mesh,origin,resolution,
    material:{pigment:0x253844},cells:occupied.map(cell=>({id:cell.id,...material(cell)}))};
  const save=(name,data)=>{
    const file=path.join(dir,name+'.json');
    fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
    return file;
  };
  const source=save('lantern',bakeSource);
  const views=save('views',{format:'ink-studio/object-texel-watch',version:1,w:268,h:192,
    views:[{id:'signal-face',camera:{yaw:.15,pitch:.08,dist:3.26}},
      {id:'quarter-turn',poseYaw:.82,camera:{yaw:.12,pitch:.17,dist:3.26},light:[-.40,.58,.66]},
      {id:'rear-turn',poseYaw:2.53,camera:{yaw:-.14,pitch:.12,dist:3.26},light:[-.60,.65,.45]}]});
  const session=path.join(dir,'session');
  const cli=(action,...args)=>JSON.parse(execFileSync(process.execPath,
    [path.resolve(__dirname,'../cli/ink-studio.js'),'pixel-art','texels',action,session,...args],
    {stdio:['ignore','pipe','inherit'],maxBuffer:4e6}));
  const run=(id,operation)=>{
    const result=cli('run',save(id,operation));
    save(id+'-receipt',result);
    return result;
  };
  cli('init',source);
  const seed=occupied.find(row=>row.face===4&&row.x===10&&material(row).pigment===oldBand);
  const {status:{selection}}=run('select-band',{op:'select',seed:seed.id});
  const selected=selection.map(id=>baked.cells[id]);
  const faces=new Set(selected.filter(row=>!row.fallback).map(row=>row.face));
  assert(faces.size>=3&&selection.length>30,JSON.stringify({selection:selection.length,faces:[...faces]}));
  const locks=[...faces].flatMap(face=>{
    const rows=selected.filter(row=>row.face===face);
    const picks=[8,12].map(x=>rows.find(row=>row.x===x&&row.y===seed.y)).filter(Boolean);
    return picks.map(row=>row.id);
  });
  assert(locks.length>=4);
  run('protect-rivets',{op:'protect',ids:locks});
  const capture=id=>{
    const out=path.join(dir,id);
    cli('watch',views,'--out',out);
    return {out,report:JSON.parse(fs.readFileSync(path.join(out,'watch.json')))};
  };
  const before=capture('before');
  const change={values:{pigment:newBand,emission:0x174a3d,roughness:.32}};
  const {receipt:preview}=run('preview-restoration',{op:'preview',...change});
  const {receipt:paint}=run('brush-restoration',{op:'brush',revision:preview.revision,...change});
  assert.deepEqual(preview.changed,paint.changed);
  assert.equal(paint.changed.length,selection.length-locks.length);
  const after=capture('after');
  run('undo-restoration',{op:'undo'});
  const undone=capture('undone');
  for(const row of before.report.views) {
    assert.deepEqual(fs.readFileSync(path.join(before.out,row.image)),fs.readFileSync(path.join(undone.out,row.image)));
    assert.deepEqual(row.cellAt,after.report.views.find(view=>view.id===row.id).cellAt);
  }
  run('redo-restoration',{op:'redo'});
  const w=834,h=534,layers=[],draw=[];
  const text=(message,x,y,size,color='#d8e7e2')=>draw.push({type:'text',text:message,at:[x,y],size,color});
  text('KITE 07  /  HARBOUR SIGNAL',417,19,17,'#f4daa5');
  text('ONE OBJECT TEXEL CLUSTER AT THREE NATIVE VIEWS',417,42,9);
  for(const [i,row] of after.report.views.entries()) {
    const x=9+i*273, earlier=before.report.views[i];
    text(['SIGNAL FACE','QUARTER TURN','REAR TURN'][i],x+134,63,10);
    for(const [j,file] of [[before.out,earlier.image],[after.out,row.watch]].entries()) {
      const image=PNG.raster(path.join(...file));
      layers.push({source:{w:image.w,h:image.h,rgba:image.data},rect:[x,78+j*205,image.w,image.h]});
    }
    text(row.selectedPixels+' MAPPED PIXELS',x+134,486,8,'#8fe7cf');
  }
  text('TOP  ORIGINAL ENAMEL',165,513,9,'#f5ce92');
  text('BOTTOM  SELECTED CLUSTER',417,513,9,'#8fe7cf');
  text(locks.length+' PROTECTED CELLS',678,513,9,'#ffb66b');
  const plan=K.frameComposite.prepare({layers:[...layers,{draw}]},w,h,1);
  const sheet=Composite.compose({w:1,h:1,rgb:Uint8Array.of(12,22,31)},K.frameComposite.layers(plan,{},0),w,h,'nearest');
  PNG.write(path.join(dir,'comparison.png'),w,h,sheet.rgb);
  save('summary',{cells:selection.length,faces:faces.size,protected:locks.length,edited:paint.changed.length,
    views:after.report.views.map(({id,selectedPixels,hidden})=>({id,selectedPixels,hidden:hidden.length})),undoMatches:true});
}

if(require.main===module) demo(process.argv[2]??'object-texel-review').catch(error=>{console.error(error);process.exitCode=1;});
