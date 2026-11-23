/* Render the native Ink studies and publish a self-contained playback gallery. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {encode,read,write} = require('../../cli/png');
const atlas = require('./index');
const {KIT} = require('../..').load();
const output = path.resolve(process.argv[2] ?? 'ink-effects-atlas');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-atlas-'));
const fps = 16;
fs.mkdirSync(output,{recursive:true});
fs.mkdirSync(path.join(output,'media'),{recursive:true});

const rows = [];
try {
  for(const study of atlas({KIT})){
    const {render,id,loop,duration} = study, frames=Math.round(fps*duration);
    const poster='media/'+id+'.png',clip='media/'+id+'.mp4';
    const temp=path.join(root,id);
    fs.mkdirSync(temp);
    for(let f=0;f<frames;f++){
      const phase=f/(frames-(loop?0:1)),{data,width,height}=render(phase);
      const png=encode(width,height,data,4);
      fs.writeFileSync(path.join(temp,String(f).padStart(4,'0')+'.png'),png);
      if(f===Math.round(frames*(id==='spark'?.52:id==='material'?.18:.27)))fs.writeFileSync(path.join(output,poster),png);
    }
    execFileSync('ffmpeg',['-nostdin','-v','error','-y','-framerate',String(fps),'-i',path.join(temp,'%04d.png'),
      '-vf','scale=iw*4:ih*4:flags=neighbor,pad=576:432:(ow-iw)/2:(oh-ih)/2:color=0x131621','-an','-c:v','libx264','-crf','14','-pix_fmt','yuv420p','-movflags','+faststart',
      path.join(output,clip)],{stdio:'inherit'});
    fs.rmSync(temp,{recursive:true});
    rows.push({id,name:study.name,description:study.description,duration:frames/fps,loop,reference:study.reference,poster,clip,frames,fps});
    process.stdout.write(id+' · '+frames+' frames\n');
  }
  const columns=4,tileW=192,tileH=144,gutter=8;
  const sheetW=columns*(tileW+gutter)+gutter, sheetH=Math.ceil(rows.length/columns)*(tileH+gutter)+gutter;
  const data=new Uint8Array(sheetW*sheetH*3);
  for(let i=0;i<data.length;i+=3)data.set([18,23,35],i);
  for(const [i,row] of rows.entries()){
    const img=read(path.join(output,row.poster)),x=gutter+i%columns*(tileW+gutter),y=gutter+Math.floor(i/columns)*(tileH+gutter);
    const tile=KIT.procedural.raster.resize({width:img.w,height:img.h,channels:3,data:img.rgb},{width:tileW,height:tileH});
    for(let scan=0;scan<tileH;scan++)data.set(tile.data.subarray(scan*tileW*3,(scan+1)*tileW*3),((y+scan)*sheetW+x)*3);
  }
  write(path.join(output,'overview.png'),sheetW,sheetH,data);
  const template=fs.readFileSync(path.join(__dirname,'gallery.html'),'utf8');
  fs.writeFileSync(path.join(output,'index.html'),template.replace('/*STUDIES*/',JSON.stringify(rows).replaceAll('<','\\u003c')));
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(rows,null,2)+'\n');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
