const fs = require('node:fs');
const path = require('node:path');
const Assets = require('./asset-files.js');
const Bitmap = require('../src/bitmap-resources.js');
const C = require('./texture-common.js');
const Textures = require('./texture-files.js');
const ColorManagement = require('./color-management.js');
const ColorFiles = require('./color-management-files.js');

const format='ink-studio/color-review';
const id = value => typeof value==='string' && /^[a-z][a-z0-9-]{0,43}$/.test(value);
const label = value => typeof value==='string' && value.trim() && value.length<=100;
const filename = value => typeof value==='string'&&value.trim()&&value.length<=4096&&!value.includes('\0');

function countSwatches(image, indices, palette) {
  const histogram=Array(palette.length).fill(0);
  const {data}=indices;
  for(let p=0;p<data.length;p++) if(data[p]>=0) histogram[data[p]]++;
  return {pixels:image.width*image.height,used:histogram.filter(Boolean).length,
    slots:palette.map((color,i)=>({color,pixels:histogram[i]}))};
}

function visit(image,pixel) {
  const {channels,width,data}=image, i=(pixel.y*width+pixel.x)*channels;
  return Array.from(data.subarray(i,i+channels));
}

function writeColorReview(filenameInput,{directory,toolkit=require('../index.js').load()}={}) {
  if (!filename(directory)||!filename(filenameInput)) throw new TypeError('Color review needs a JSON plan and output directory');
  const input=path.resolve(filenameInput), baseDir=path.dirname(input), output=path.resolve(directory);
  const plan=JSON.parse(fs.readFileSync(input,'utf8'));
  if (!C.fields(plan,['format','version','label','input','colorManagement','views','palette','probes']) ||
      plan.format!==format||plan.version!==1||!label(plan.label)||
      !C.fields(plan.input,['file','interpretation'])||!filename(plan.input.file)||
      !C.fields(plan.palette,['policy','options'])||!C.record(plan.palette.policy)||
      plan.palette.options!==undefined&&!C.record(plan.palette.options))
    throw new TypeError('Expected a version 1 color review plan, source, and palette policy');
  const interpretation=Bitmap.interpretation(plan.input.interpretation);
  if ((interpretation.intent??'color')!=='color') throw new TypeError('Color review needs a color source');
  const sourcePath=path.resolve(baseDir,plan.input.file), paths=new Set([input,sourcePath]);
  const managed=ColorManagement.configure(plan.colorManagement,{baseDir,onFile:file=>paths.add(file)});
  const raw=Textures.readTexture(sourcePath);
  const {raw:working,report:source}=managed.importColor(raw,interpretation,{target:'working'});
  const {width,height}=working;
  const choices=plan.views??[{id:'default',label:'Project view',...managed.description.primary}];
  if (!Array.isArray(choices)||!C.uint(choices.length,1,12)||new Set(choices.map(row=>row?.id)).size!==choices.length)
    throw new TypeError('Choose 1–12 distinct color review views');
  const views=Array.from(choices,row=>{
    if (!C.fields(row,['id','label','display','view','encoding','exposure','hdr'])||!id(row.id)||!label(row.label)||
        !ColorManagement.encodings.includes(row.encoding))
      throw new TypeError('A color review view needs a stable ID, label and output encoding');
    ColorFiles.displayTags(row.encoding,row.hdr);
    return row;
  });
  const probes=plan.probes??[];
  if (!Array.isArray(probes)||probes.length>32||!Array.from(probes).every(p=>
    C.fields(p,['label','x','y'])&&label(p.label)&&C.uint(p.x,0,width-1)&&C.uint(p.y,0,height-1)))
    throw new RangeError('Color review probes must be on the original image grid');

  const fixed=['index.html','report.json','working.exr'];
  const members=[...fixed,...views.flatMap(({id})=>[id+'-display.png',id+'-proof.png',id+'-palette.png'])];
  const targets=new Set(members.map(file=>path.join(output,file)));
  if ([...paths].some(p=>targets.has(path.resolve(p)))) throw new RangeError('Color review outputs would overwrite a dependency');

  const write=(file,bytes)=>Assets.write(path.join(output,file),bytes);
  const P=toolkit.KIT.procedural;
  const results=views.map(({id,label,display,view,encoding,exposure,hdr})=>{
    const result=managed.output(working,{fromWorking:true,exposure,viewport:{display,view,encoding}});
    const resolve=P.rasterColor.resolve(result.value,plan.palette.policy,plan.palette.options);
    const names={display:id+'-display.png',proof:id+'-proof.png',palette:id+'-palette.png'};
    write(names.display,ColorFiles.display(result.display,encoding,hdr));
    write(names.proof,ColorFiles.proof(result.value));
    write(names.palette,ColorFiles.proof({...resolve.value,alpha:'straight'}));
    return {id,label,files:names,...result.report,metadata:ColorFiles.displayTags(encoding,hdr),
      palette:countSwatches(resolve.value,resolve.indices,resolve.palette),
      probes:probes.map(p=>({...p,working:visit(working,p),display:visit(result.display,p),
        proof:visit(result.value,p),palette:visit(resolve.value,p)}))};
  });
  write('working.exr',ColorFiles.exr(working,managed.description));
  const report={format,version:1,label:plan.label,grid:{width,height},source:{file:plan.input.file,...source},
    colorManagement:managed.description,views:results,working:'working.exr'};
  Assets.json(path.join(output,'report.json'),report);
  const html=fs.readFileSync(path.join(__dirname,'color-management-review.html'),'utf8');
  write('index.html',html.replace('/*INK_COLOR_REPORT*/',()=>JSON.stringify(report).replaceAll('<','\\u003c')));
  return {file:path.join(output,'index.html'),...report};
}

module.exports={writeColorReview};
