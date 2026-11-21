/* Audition bundles give tools playable takes, portable scores, and reusable references. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const PNG = require('./png.js');
const WAV = require('./wav.js');
const { readGraphProject } = require('./graph-project.js');

const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const json = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const clamp = x => Math.max(0,Math.min(1,x));
const palette = ['#83ddd7','#91adef','#fecb99','#eb9f9b','#d0b9fa','#f9dba6','#abc5e8','#abe5ad'];

function plate(K,take,width,height) {
  const { arrangement: plan, range, id }=take, score=K.music.score.compile(plan.score);
  const rows=Object.keys(plan.parts), layout=K.procedural.drawing2d;
  const rect=(x,y,w,h,fill,falloff)=>({type:'rect',rect:[x,y,w,h],fill,falloff});
  const line=(points,color,width=1)=>({type:'path',points,color,width});
  const label=(x,y,text,color='#a7b4cc',scale=1)=>({type:'text',at:[Math.round(x),Math.round(y)],text,color,scale});
  const eye=[width*.66,height*.37], size=Math.min(width*.34,height*.48);
  const left=20, right=width-20, top=Math.round(height*.66), low=height-30;
  const step=(low-top)/rows.length, span=range.end-range.start;
  const along=t=>left+(right-left)*(t-range.start)/span;
  const ring=(radius,turn,phase) => Array.from({length:61},(_,index)=>{
    const theta=index/60*turn+phase, x=Math.cos(theta)*radius, y=Math.sin(theta)*radius*.43;
    return [eye[0]+x,eye[1]+y+.25*x];
  });
  const background=[
    rect(0,0,width,height,'#090f1a'),
    {type:'grid',origin:[20.5,35.5],counts:[12,7],step:[(width-41)/12,(top-52)/7],
      color:'#6b83ad35',majorColor:'#7c9dc54d',
      falloff:{type:'radial',center:eye,radii:[size*.25,size*1.6],opacity:[.92,.19]}},
    line([[left,top-9.5],[right,top-9.5]],'#4a627b'),
    label(left,11,'INK / ARRANGEMENT AUDITION','#adbbd5'),
    label(left,51,id.toUpperCase().slice(0,Math.floor((width-42)/12)),'#f2f3fa',2)
  ];
  for (const section of plan.sections) {
    if (section.time < range.start || section.time >= range.end) continue;
    const x=along(section.time);
    background.push(line([[x+.5,top-5],[x+.5,low]],'#67839b70'),
      label(Math.round(x)+3,low+8,section.id.toUpperCase().slice(0,Math.max(0,Math.floor((right-x-3)/6)))));
  }
  for (const [index,key] of rows.entries()) {
    const y=top+index*step, color=palette[index];
    background.push(line([[left,y+step-2],[right,y+step-2]],'#354358aa'));
    const row = new Map();
    for (const cue of plan.cues) {
      if (cue.part!==key || cue.time<range.start || cue.time>=range.end) continue;
      const x=Math.floor(along(cue.time)), length=Math.max(1,Math.min(right-x,along(cue.endTime)-x));
      row.set(x,Math.max(length,row.get(x) ?? 0));
    }
    for (const [x,length] of row) background.push(rect(x,y+2,length,Math.max(1,step-4),color+'6e'));
  }
  const backdrop=layout.render({width,height,commands:background});
  return time=>{
    const frame=score.sample(time), section=plan.sections.findLast(row=>row.time <= time) ?? plan.sections[0];
    const tint=Object.values(frame.bindings).find(value=>typeof value==='string' && /^#[\da-f]{6}/i.test(value)) ?? '#96badc';
    const baseTint=tint.slice(0,7), focus=clamp(Object.values(frame.bindings).find(value=>typeof value==='number') ?? .5);
    const commands=[
      rect(20,35,width-40,top-50,baseTint+'20',{type:'radial',center:eye,radii:[12,size*1.5]}),
      label(left,76,section.id.toUpperCase(),'#8fa8c5'),
      label(left,92,frame.chord ? frame.chord.root+' / '+frame.chord.quality.toUpperCase() : 'REST'),
      label(left,108,'BAR '+String(frame.bar+1).padStart(2,'0')),
      {type:'rayFan',origin:[eye[0]-.66*size,eye[1]+.42*size],angles:[-1.12+focus*.12,-.1+focus*.2],
        count:29,radii:[size*.35,size*1.57],width:.61,color:baseTint+'80',
        falloff:{type:'radial',center:eye,radii:[18,size*1.25]}}
    ];
    for (const [index,key] of rows.entries()) {
      const voice=frame.voices[key], color=palette[index], radius=size*(1-index*.065);
      const arc=ring(radius,Math.PI*(.25+voice.level),voice.phase*Math.PI*2);
      const y=123+index*Math.min(11,(top-134)/rows.length);
      commands.push(line(ring(radius,Math.PI*2,0),color+'35',.7),
        line(arc,color+(voice.level>.2?'df':'55'),.7+voice.level),
        rect(18,y+3,2+42*voice.level,2,color),
        label(68,y,key.toUpperCase().slice(0,22),color));
    }
    const x=along(time);
    if (x>left && x<right) commands.push(line([[x,top-7],[x,low]],'#f3f3fc',1.2));
    const light=layout.render({width,height,commands});
    const image=K.procedural.raster.stack({width,height,layers:[{source:backdrop},{source:light}]}).value;
    return PNG.encode(width,height,image.data,4);
  };
}

function graphPicture(file,raw,kit,take) {
  if (!raw || typeof raw.project !== 'string' || typeof raw.output !== 'string')
    throw new TypeError('A custom audition picture needs a project file and named image output');
  const graph=readGraphProject(path.resolve(path.dirname(file),raw.project),{kit});
  const inputs={...raw.inputs,[raw.scoreInput ?? 'score']:take.arrangement.score};
  if (raw.cuesInput) inputs[raw.cuesInput]=take.arrangement.cues;
  function sample(time) {
    const result=graph.run({time,inputs});
    if (!result.report.passed) throw new Error('Audition picture graph assertions failed');
    const value=result.outputs[raw.output];
    if (value?.rgb && value.w*value.h<=1048576) return PNG.encode(value.w,value.h,value.rgb);
    if (value?.data && value.channels===4 && value.width*value.height<=1048576)
      return PNG.encode(value.width,value.height,Uint8Array.from(value.data),4);
    throw new TypeError('Audition picture must output a render frame or RGBA raster');
  }
  return {sample,close:()=>graph.clear()};
}

function audition(file,opt,kit) {
  if (typeof opt.out !== 'string') throw new TypeError('Use --out with an audition directory');
  const recipe=read(file), { arrangement,variants,options={},picture }=recipe;
  const { fps=24,width=768,height=432,...sound }=options;
  if (![width,height].every((value,i)=>Number.isSafeInteger(value) && value%2===0 &&
      value >= (i===0?384:288) && value <= 1280) || !Number.isSafeInteger(fps) || fps<1 || fps>30 ||
      (opt.ffmpeg!==undefined && typeof opt.ffmpeg!=='string'))
    throw new RangeError('Audition dimensions must be bounded even integers and fps must be 1–30');
  const { takes,report }=kit.KIT.music.composer.audition(arrangement,variants,{...sound,audio:true});
  const count=Math.ceil((report.end-report.start)*fps-1e-9);
  if (count*width*height*takes.length>450e6) throw new RangeError('Audition exceeds the picture budget');
  fs.mkdirSync(opt.out,{recursive:true});
  const folder=fs.mkdtempSync(path.join(path.resolve(opt.out),'audition-'));
  const results=[];
  for (const take of takes) {
    const reportBase=path.join(folder,take.id), frames=path.join(reportBase,'frames');
    fs.mkdirSync(frames,{recursive:true});
    const wav=path.join(reportBase,'music.wav'), film=path.join(reportBase,'preview.mp4');
    fs.writeFileSync(wav,WAV.encode(take.audio,{encoding:'pcm24'}));
    json(path.join(reportBase,'arrangement.json'),take.arrangement);
    json(path.join(reportBase,'report.json'),{id:take.id,edits:take.edits,range:take.range,...take.report});
    const camera=picture ? graphPicture(file,picture,kit,take) : null;
    const sample=camera?.sample ?? plate(kit.KIT,take,width,height);
    try {
      const keep=opt['frames-only'] ? 1 : count;
      for (let i=0;i<keep;i++) fs.writeFileSync(path.join(frames,String(i).padStart(4,'0')+'.png'),sample(report.start+i/fps));
      fs.copyFileSync(path.join(frames,'0000.png'),path.join(reportBase,'still.png'));
      if (!opt['frames-only']) execFileSync(opt.ffmpeg ?? 'ffmpeg',['-hide_banner','-loglevel','error',
        '-framerate',String(fps),'-i',path.join(frames,'%04d.png'),'-i',wav,'-c:v','libx264','-pix_fmt','yuv420p',
        '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-crf','17','-c:a','aac','-b:a','192k','-movflags','+faststart','-shortest',film],{stdio:'inherit',timeout:240000});
    } finally { camera?.close(); }
    fs.rmSync(frames,{recursive:true});
    const relative=name=>take.id+'/'+name;
    results.push({id:take.id,arrangement:relative('arrangement.json'),report:relative('report.json'),
      audio:relative('music.wav'),still:relative('still.png'),...(opt['frames-only'] ? {} : {video:relative('preview.mp4')})});
  }
  const manifest={format:'ink-studio/music-audition',version:1,fps,report,takes:results};
  const target=path.join(folder,'manifest.json');
  json(target,manifest);
  process.stdout.write(JSON.stringify({manifest:target,takes:results})+'\n');
  return manifest;
}

module.exports=function musicCommand(pos,opt,kit) {
  const [mode,file,editFile]=pos;
  if (!file) throw new TypeError('Use music arrange, revise, reference, or audition with a JSON file');
  if (mode==='audition') return audition(file,opt,kit);
  const {compose,revise,reference}=kit.KIT.music.composer;
  let output;
  if (mode==='arrange') output=compose(read(file));
  else if (mode==='revise' && editFile) output=revise(read(file),read(editFile)).value;
  else if (mode==='reference') output=reference(read(file),{part:opt.part,section:opt.section});
  else throw new TypeError('Use music arrange, revise, reference, or audition');
  if (typeof opt.out==='string') json(opt.out,output);
  else process.stdout.write(JSON.stringify(output,null,2)+'\n');
  return output;
};
