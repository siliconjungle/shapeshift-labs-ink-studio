'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const studio=require('../..'),kit=studio.load().KIT,Files=require('../../cli/asset-files.js'),PNG=require('../../cli/png.js');
const {chunkId}=require('../../cli/gaussian-pack-files.js');
const Canal=require('./canals.cjs');
const out=path.resolve(process.argv[2]??'studio/canal-signals');
const file=name=>path.join(out,name), parse=name=>JSON.parse(fs.readFileSync(file(name)));
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const run=(...args)=>execFileSync(process.execPath,[cli,'stream-splats',...args],{encoding:'utf8',maxBuffer:16*1024**2});
const manifest=file('pack/manifest.json'), before=file('pack/previous.json');
const warm=Canal.palette.light;

async function demo() {
  const {writeGaussianPack}=await import('../../scripts/pack-gaussian-chunks.mjs');
  // Build a fresh pack for each replay. Separate runs can use independent output folders.
  const old=fs.statSync(manifest,{throwIfNoEntry:false});
  if(old)throw new Error('Build the Canal Signals demo in a fresh output directory');
  const world=Canal.build(), layer=world.layer;
  await writeGaussianPack(world,file('pack'),{layer,cellSize:4,voxelSizes:[.32,.16,0],encoding:'irc1',lossless:true});
  process.stdout.write(run('index',manifest));
  const source=parse('pack/manifest.json');
  const near=chunkId('lantern',[0,0,0]), far=chunkId('lantern',[14,0,10]);
  const rows=id=>JSON.parse(run('inspect',manifest,'--chunk',id)).chunk.rows;
  const a=rows(near), b=rows(far);
  const selected=items=>items.filter(row=>row.position[1]>.63&&row.position[1]<1.08&&
    row.pigment>=warm-0x0a0804&&row.pigment<=warm);
  const edits=[...selected(a).map(({id})=>({id,pigment:0x66cbbc})),
    ...selected(b).map(({id})=>({id,pigment:0xf27996}))];
  const cap=a.filter(row=>row.pigment===Canal.palette.jewel);
  for(const row of cap)edits.push({id:row.id,layer:'flare',translate:[.43,.13,0]});
  const spare=b.find(row=>row.pigment===Canal.palette.jewel);
  edits.push({id:spare.id,remove:true});
  Files.json(file('patch.json'),{format:'ink-studio/stream-splat-patch',version:1,asset:source.edit.asset,epoch:source.epoch,edits});
  process.stdout.write(run('edit',manifest,file('patch.json'),'--previous',before,'--out',file('edit-report.json')));
  const receipt=parse('edit-report.json'), fitted=parse('pack/manifest.json'), flare=chunkId('flare',[0,0,0]);
  assert.deepEqual(receipt.read.chunks.slice().sort(),[near,far].sort());
  assert.deepEqual(receipt.rebuilt.map(row=>row.id).sort(),[near,far,flare].sort());
  assert.equal(receipt.untouched.length,source.chunks.length-2);
  assert.equal(fitted.edit.redirects.length,cap.length);
  assert.equal(fitted.edit.retired.length,1);
  const replacements=new Map(fitted.chunks.map(row=>[row.id,row]));
  for(const row of source.chunks)if(row.id!==near&&row.id!==far)assert.deepEqual(replacements.get(row.id),row);
  assert(rows(flare).some(row=>row.id===cap[0].id));

  const registered=(id,phase,target,extra={})=>({id,phase,w:224,h:192,camera:{...world.cam,target,...extra}});
  const settings={budgetBytes:310000,maxSplats:4200,referenceSplats:45000,targetPx:2.5,
    exportLayers:['lantern','flare','quay','reeds'],views:[
      registered('home-before','before',[2,.96,2]),
      registered('home-after','after',[2,.96,2]),
      registered('remote-after','after',[58,.96,42],{yaw:-.67,pitch:.42})]};
  Files.json(file('views.json'),settings);
  process.stdout.write(run('review',manifest,file('views.json'),'--previous',before,'--out',file('review')));
  const report=parse('review/report.json'), [first,second,third]=report.views;
  assert(first.streaming.levels.some(row=>row.chunk===near));
  assert(!first.streaming.requests.some(row=>row.chunk===far));
  assert(second.streaming.requests.some(row=>row.chunk===near));
  assert(second.streaming.reused.length>0);
  assert(!second.streaming.requests.some(row=>row.chunk===far));
  assert(third.streaming.requests.some(row=>row.chunk===far));
  assert(report.views.every(row=>row.streaming.residentBytes<=settings.budgetBytes&&row.quality.depthOverlap>100));
  assert(report.views.some(row=>row.reference.splats>row.streaming.drawSplats));

  const width=704,height=474, gap=8, v=224,h=192;
  const labels=(text,x,y,color,scale=1)=>({type:'text',text,at:[x,y],color,scale});
  const commands=[{type:'rect',rect:[0,0,width,height],fill:'#14212d'},labels('CANAL SIGNALS / STREAMED SPLAT EDITS',gap,8,'#f0d49b',2),
    labels(receipt.rebuilt.length+' REBUILT   /   '+receipt.untouched.length+' UNTOUCHED   /   '+world.count+' SOURCE SPLATS',gap,27,'#9ebec4')];
  for(const [i,label] of ['HOME / BEFORE','HOME / AFTER','REMOTE CHUNK / AFTER'].entries())
    commands.push(labels(label,gap+i*(v+gap),40,'#c6deda'));
  commands.push(labels('STREAMED COLOR',gap,247,'#d1e3df'),labels('STRONGEST CONTRIBUTION DEPTH',gap,458,'#d1e3df'));
  const board=kit.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  for(const [i,entry] of report.views.entries()){
    const source=entry.artifacts.streamed;
    const relative=path.dirname(source.manifest);
    const color=PNG.raster(file('review/'+relative+'/'+source.files.color));
    const depth=PNG.raster(file('review/'+relative+'/'+source.contributionDepth.png));
    const left=gap+i*(v+gap);
    for(let y=0;y<h;y++)for(let x=0;x<v;x++){
      const p=(y*v+x)*4,j=((52+y)*width+left+x)*4,k=((262+y)*width+left+x)*4;
      const a=color.data[p+3]/color.max;
      for(let c=0;c<3;c++)board.data[j+c]=Math.round(color.data[p+c]*255/color.max*a+world.bg[c]*(1-a));
      const n=depth.data[p]?1-(depth.data[p]-1)/(depth.max-1):0;
      board.data.set(depth.data[p]?[40+168*n,71+150*n,108+112*n].map(Math.round):world.bg,k);
    }
  }
  Files.write(file('canal-signals.png'),PNG.encode(width,height,board.data,4));
  Files.json(file('demo-report.json'),{sourceRows:world.count,sourceChunks:source.chunks.length,editedRows:edits.length,
    rebuilt:receipt.rebuilt.length,untouched:receipt.untouched.length,decodedRowsForEdit:receipt.read.rows,published:receipt.published,
    paint:{resident:near,unloaded:far},reused:second.streaming.reused,quality:report.views.map(({id,quality})=>({id,quality}))});
  console.log('Wrote '+file('canal-signals.png'));
}

demo().catch(error=>{console.error(error);process.exitCode=1;});
