'use strict';

const fs=require('node:fs');
const path=require('node:path');
const PNG=require('./png.js');
const R=require('./render.js');

const format='ink-studio/sculpt-detail-plan';
const record=(row,keys)=>row && Object.getPrototypeOf(row)===Object.prototype && Object.keys(row).every(key=>keys.includes(key));
const color={applied:[112,219,181],flat:[57,66,76],edge:[71,113,106],fold:[192,136,251],
  'thin-wall':[253,187,94],'lost-correspondence':[225,102,107],masked:[108,158,227]};
const filenames=['01-base.png','02-fine.png','03-coarse.png','04-transfer.png','comparison.png','diagnostics.png','transfer-delta.png','layer.json','report.json'];

function strokes(rows,P) {
  if (!Array.isArray(rows) || !rows.length || rows.length>32) throw new RangeError('Use 1–32 strokes for each sculpt level');
  return rows.map(row=>{
    if (!record(row,['operation','bounds','volume','smooth']) || !['union','subtract'].includes(row.operation))
      throw new TypeError('A sculpt detail plan stroke needs union or subtract, bounds and a tool volume');
    const {operation,bounds,volume,smooth}=row;
    return {operation,bounds:P.spatial.bounds(bounds),smooth,sdf:P.sculptMasks.field(volume)};
  });
}

function coarseLayer(source,cell,brushes,P) {
  let low=P.sparseBricks.create({cell,brickSize:source.brickSize,base:source.distance});
  for (const brush of brushes) low=low.edit(brush);
  let target=source;
  for (const {bounds} of brushes)
    target=target.edit({bounds:P.spatial.expand(bounds,cell+source.cell),operation:'reshape',transform:(x,y,z)=>low.distance(x,y,z)});
  return target;
}

function statusImage(report) {
  const [w,h]=report.chart.size, rgb=new Uint8Array(w*h*3);
  for (const {x,y,status} of report.rows) rgb.set(color[status],((h-1-y)*w+x)*3);
  return {w,h,rgb};
}

function transferDelta(before,after,object,tolerance) {
  const {w,h}=before,rgb=new Uint8Array(w*h*3), added=[112,219,181], removed=[244,149,100];
  const a=before.passes,b=after.passes, aId=a.objects.indexOf(object),bId=b.objects.indexOf(object);
  let changed=0;
  for (let i=0;i<w*h;i++) {
    const was=aId>=0 && a.objectId[i]===aId, now=bId>=0 && b.objectId[i]===bId;
    let pigment=[25,36,47];
    if (was || now) {
      pigment=[60,72,78];
      const delta=was && now ? a.depth[i]-b.depth[i] : now ? Infinity : -Infinity;
      if (Math.abs(delta)>tolerance) {
        pigment=delta>0 ? added : removed;
        changed++;
      }
    }
    rgb.set(pigment,i*3);
  }
  return {image:{w,h,rgb},changed,tolerance,legend:{closer:added,farther:removed}};
}

function run(world,plan,directory,{kit,time=0,objectId,inputs=[]}={}) {
  if (!record(plan,['format','version','w','h','chart','depth','maxRelief','fine','coarse','coarseCell','transfer','camera']) ||
      plan.format!==format || plan.version!==1) throw new TypeError('Use a version 1 sculpt detail plan');
  const {w=160,h=112,camera={},chart,depth,maxRelief,transfer={}}=plan;
  if (![w,h].every(n=>Number.isSafeInteger(n) && n>=32 && n<=384) ||
      !record(camera,['target','yaw','pitch','dist','fov','ortho']) ||
      !record(transfer,['reach','minWall','minNormalDot','targetFrame','masks','maxSamples']))
    throw new TypeError('Use a 32–384 native grid, camera and supported detail transfer settings');
  const {KIT:{procedural:P}}=kit;
  const rows=P.brickMeshes.frame(world).filter(row=>objectId===undefined || row.objectId===objectId);
  const initial=rows.length===1 && rows[0];
  const controller=initial && world.brickMeshes.find(row=>row.current?.()===initial);
  if (!controller) throw new RangeError('Choose one live brick mesh with --object');
  if (inputs.some(file=>filenames.some(name=>path.resolve(directory,name)===path.resolve(file))))
    throw new RangeError('Write the sculpt detail review separately from its inputs');
  const {cell}=initial.bricks, coarseCell=plan.coarseCell ?? cell*2;
  if (!Number.isFinite(coarseCell) || coarseCell<cell || coarseCell>cell*8)
    throw new RangeError('The coarse lattice cell must be 1–8 times the fine lattice cell');
  const fineBrushes=strokes(plan.fine,P), coarseBrushes=strokes(plan.coarse,P);
  const native=()=>R.render(world,{w,h,px:1,t:time,raw:true,passes:['depth','objectId'],...camera});
  const images=[native()];
  for (const brush of fineBrushes) controller.edit(brush);
  images.push(native());
  const layer=controller.captureDetail(initial.bricks,{chart,depth,maxRelief});
  const coarse=coarseLayer(initial.bricks,coarseCell,coarseBrushes,P);
  controller.update(coarse);
  images.push(native());
  const preview=controller.previewDetail(layer,coarse,transfer);
  const published=controller.commitDetail(preview);
  images.push(native());
  const {image:deltaImage,...depthChanges}=transferDelta(images[2],images[3],initial.objectId,cell*.35);
  const report={...preview.report,coarseEditCell:coarseCell,grid:{width:w,height:h,pixelSize:1},legend:color,depthChanges,
    files:{frames:filenames.slice(0,4),comparison:'comparison.png',diagnostics:'diagnostics.png',
      transferDelta:'transfer-delta.png',layer:'layer.json'},work:published.work};

  fs.mkdirSync(directory,{recursive:true});
  const png=(name,image)=>PNG.write(path.join(directory,name),image.w,image.h,image.rgb,image.alpha);
  for (const [i,image] of images.entries()) png(filenames[i],image);
  png('comparison.png',R.grid(images,2,['01','02','03','04']));
  png('diagnostics.png',statusImage(report));
  png('transfer-delta.png',deltaImage);
  for (const [name,value] of [['layer.json',layer],['report.json',report]])
    fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
  return report;
}

module.exports={run};
