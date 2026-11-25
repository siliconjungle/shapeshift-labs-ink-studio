/* Follow a kiln vent through its modifier stack, cut, rebake and upload. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..');
const PNG=require('../../cli/png.js');
const {fixture,materials}=require('../mesh-modifiers/fixture.cjs');
const {KIT:K}=ink.load();
const out=path.resolve(process.argv[2]??'kiln-review');
const file=name=>path.join(out,name);
const write=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const op=(op,inputs)=>({op,inputs});
const link=node=>({node});
const root=(nodes,outputs)=>({format:'ink-studio/graph-project',version:1,nodes,outputs});
const w=168,h=106,camera={target:[0,0,.12],dist:4.35,yaw:-.29,pitch:.24,ortho:true};
const {cage,target,stack}=fixture(K.meshTopology);
const seat=op('model.modifiers',{source:cage,modifiers:stack.slice(0,1),targets:{mount:target}});

const graph=root({
  seat,
  mirror:op('model.modifiers',{source:link('seat'),modifiers:[stack[1]]}),
  rim:op('model.modifiers',{source:link('mirror'),modifiers:[stack[2]]}),
  overlap:op('model.modifiers',{source:link('seat'),modifiers:[{id:'overlap',kind:'array',count:2,step:[.35,0,0]}]}),
  block:op('sdf.shape',{kind:'box',options:{half:[1.25,.64,.31],round:.17}}),
  port:op('sdf.shape',{kind:'capsule',options:{radius:.28,length:1.6,rotation:[Math.PI/2,0,0]}}),
  slots:op('data.record',{block:link('block'),port:link('port')}),
  operands:op('data.collect',{source:link('slots'),keys:['block','port']}),
  carve:op('sdf.combine',{sources:link('operands'),options:{operation:'subtract'}}),
  remesh:op('sdf.mesh',{source:link('carve'),options:{resolution:.085,color:'#cdae82'}})
},{panel:link('rim'),vent:link('remesh')});

function cli(args,stdout='pipe') {
  return execFileSync(process.execPath,[path.join(__dirname,'../../cli/ink-studio.js'),...args],
    {encoding:'utf8',stdio:['ignore',stdout,'pipe']});
}

function uploadProof(document,appearance) {
  return require('../../cli/look-webgl.js')({},()=>{},(kit,_create,createBackend,input)=>{
    const {KIT:K,makeBuilder}=kit;
    const {id,width,height,pixels}=input.appearance;
    const material={id,texture:{width,height,pixels:Uint8Array.from(pixels)}};
    const mesh=K.meshTopology.toSceneMesh(input.document,{materials:[material]});
    const world=makeBuilder(13,[0x14242e]).finish({meshes:[mesh],cam:input.camera,radius:5,dither:0});
    const browser=createBackend(168,106,{px:1,raw:true,offscreen:true});
    try {
      const receipts=[];
      const frame={onModelingWork:row=>receipts.push(row)};
      browser.draw(world,frame);
      const cold=receipts.splice(0), capture=browser.image();
      browser.draw(world,frame);
      return {cold,warm:receipts,capture};
    } finally {browser.close();}
  },{document,camera,appearance});
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  write('vent.graph.json',graph);
  write('stack.json',{format:'ink-studio/mesh-modifier-stack',version:1,document:cage,modifiers:stack.slice(0,5)});
  write('targets.json',{mount:target});
  write('view.json',{w,h,camera,materials:materials()});
  cli(['patch','run',file('vent.graph.json'),'--watch',
    'mirror=mirror:@model,rim=rim:@model,overlap=overlap:@model,carve=carve:@model,remesh=remesh:@model',
    '--size',w+'x'+h,'--out',file('watches')]);
  cli(['mesh-topology','modifiers','inspect',file('stack.json'),'--targets',file('targets.json'),
    '--diagnostics','--view',file('view.json'),'--preview',file('modifiers'),'--report',file('modifier-report.json')]);
  const watches=read('watches/report.json').previews, modifiers=read('modifier-report.json');
  const remesh=watches.remesh.value, overlap=watches.overlap.value.after.health;
  assert(remesh.work[0].counts.cells>0 && overlap.counts.selfIntersections>0);
  assert(modifiers.stages.every(row=>row.native.before&&row.native.after));
  const base=ink.exportGlb(cage,{out:file('bake-base/vent.glb'),bakeDir:file('bake-base'),textureSize:256});
  const webgl=process.argv.includes('--webgl');
  const operations={
    'review.rebake':{inputs:{source:'record'},outputs:{value:'record',appearance:'record'},run({source},context){
      const baked=ink.exportGlb(source,{out:file('bake-edited/vent.glb'),bakeDir:file('bake-edited'),
        rebakeFrom:base.materialBake,onModelingWork:context.recordWork});
      const pigment=JSON.parse(fs.readFileSync(baked.materialBake,'utf8')).meshes[0].maps.pigment.file;
      const {w:width,h:height,data}=PNG.raster(path.join(path.dirname(baked.materialBake),pigment));
      return {value:source,appearance:{id:'paint',width,height,pixels:Array.from(data)}};
    }},
    'review.upload':{inputs:{source:'record',appearance:'record'},outputs:{value:'record'},run({source,appearance},context){
      const proof=uploadProof(source,appearance);
      assert(proof.cold.some(row=>row.counts.geometryBytes>0));
      assert.equal(proof.warm.length,0);
      for (const receipt of proof.cold) context.recordWork?.(receipt);
      PNG.write(file('webgl.png'),w,h,Buffer.from(proof.capture,'base64'));
      return {value:source};
    }}
  };
  const jobs={seat,paint:op('review.rebake',{source:link('seat')})};
  if(webgl) jobs.upload=op('review.upload',{source:link('paint'),appearance:{node:'paint',port:'appearance'}});
  const project=ink.createGraphProject(root(jobs,{value:link(webgl?'upload':'paint')}),{operations});
  const reports=await project.previewFrame({paint:{node:'paint',modeling:true},
    ...(webgl&&{upload:{node:'upload',modeling:true}})}, {time:0},{encodeArtifacts:false,profile:true});
  write('downstream-work.json',reports.report);
  const bake=reports.values.paint.work[0], upload=reports.values.upload?.work.reduce((n,row)=>
    n+row.counts.geometryBytes+row.counts.textureBytes,0);
  assert(bake.counts.updatedCharts>0 && bake.counts.sampledTexels>0 && bake.sourceIds.includes('panel'));
  const panels=[
    ['Mirror the panel','UV AND COAT ATTRIBUTES','modifiers/stage-2','#9adac5'],
    ['Open the vent','SIGNED FIELD CUT','watches/previews/carve/','#f8c68a'],
    ['Spot the overlap',overlap.counts.selfIntersections+' SELF-INTERSECTIONS','watches/previews/overlap/','#f2a597']
  ];
  const width=1098,height=673,commands=[],mint='#9adac5',muted='#9ab4bd',paper='#e9ede4';
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text=(text,x,y,scale,color=paper)=>commands.push({type:'text',text,at:[x,y],scale,color});
  rect(0,0,width,height,'#0e1924');
  rect(22,21,13,3,mint);
  text('INK STUDIO / STAGE DIAGNOSTICS',47,16,2,mint);
  text('Kiln Vent',21,42,4);
  text('MATCHED NATIVE PIXELS AND WORK RECEIPTS',22,80,1,muted);
  for (const [i,[title,subtitle,,color]] of panels.entries()) {
    const x=22+i*356;
    text(title,x,108,2,color);
    text(subtitle,x,127,1,muted);
    for (let j=0;j<2;j++) {
      const y=144+j*224;
      rect(x-1,y-1,w*2+2,h*2+2,'#395a66');
    }
  }
  const columns=[
    ['REMESH',remesh.work[0].counts.cells+' CELLS  /  '+remesh.work[0].counts.triangles+' TRIANGLES'],
    ['REBAKE',bake.counts.sampledTexels+' SAMPLED TEXELS  /  '+bake.counts.updatedCharts+' UPDATED CHART'],
    ['WEBGL UPLOAD',webgl?upload+' BYTES SUBMITTED':'RUN WITH --WEBGL TO CAPTURE']
  ];
  for (const [i,[label,note]] of columns.entries()) {
    const x=22+i*356;
    text(label,x,605,2,mint);
    text(note,x,627,1,muted);
  }
  rect(22,649,width-44,1,'#355060');
  text('BEFORE ABOVE   /   AFTER BELOW   /   168 X 106 NATIVE GRID',22,658,1,muted);
  const board=K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  for (const [i,[,,source]] of panels.entries()) for (const [j,side] of ['before','after'].entries()) {
    const from=PNG.read(file(source+(i===0?'-':'')+side+'.png'));
    const x=22+i*356,y=144+j*224;
    for (let row=0;row<h*2;row++) for(let col=0;col<w*2;col++) {
      const index=(Math.floor(row/2)*w+Math.floor(col/2))*3;
      board.data.set(from.rgb.subarray(index,index+3),((y+row)*width+x+col)*4);
    }
  }
  const projectPoint=K.procedural.conversions;
  const overlapGrid=projectPoint.cameraGrid(watches.overlap.value.native.camera,{width:w,height:h},100);
  for (const {point} of overlap.findings.selfIntersections) {
    const hit=projectPoint.project(point,overlapGrid);
    if (!hit.visible) continue;
    const [x,y]=hit.value.map(Math.floor);
    for (const [dx,dy] of [[0,0],[-2,0],[-1,0],[1,0],[2,0],[0,-2],[0,-1],[0,1],[0,2]]) {
      if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h) continue;
      const at=22+2*356+(x+dx)*2, row=368+(y+dy)*2;
      for (let k=0;k<2;k++) for(let l=0;l<2;l++) board.data.set([249,140,122],((row+k)*width+at+l)*4);
    }
  }
  fs.writeFileSync(file('comparison.png'),PNG.encodeFrame(PNG.packRGBA(board)));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
