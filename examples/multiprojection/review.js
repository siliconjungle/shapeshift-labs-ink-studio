const path = require('node:path');
const ink = require('../..');
const {write,json} = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');
const demo=require('./signal-dial.js')(ink.load());

const directory=path.resolve(process.argv[2] ?? 'dial-review');
const world=demo.build(), w=176,h=132,fps=12,count=18;
const stats=[], pairs=[];
for (let i=0;i<count;i++) {
  const t=i/fps, phase=i/(count-1), yaw=.06+.15*phase;
  world.anim.update(0,t);
  const view={w,h,px:1,t,yaw,raw:true,passes:['objectId','depth']};
  const baseline=ink.render(world,{...view,multiprojection:false});
  const local=ink.render(world,view);
  const rule=local.multiprojection.rules[0];
  const names=frame=>Array.from(frame.passes.objectId,id=>frame.passes.objects[id]);
  const a=names(baseline), b=names(local);
  const onHand=name=>name==='operator-hand'||name==='operator-finger'||name==='operator-sleeve';
  const points=rule.pins.map(pin=>pin.error);
  const contact=rule.pins.find(pin=>pin.id==='finger contact');
  const [x,y]=contact.master.map(Math.floor), pixel=y*w+x;
  function measure(labels) {
    let lo=w,hi=-1;
    for (let p=0;p<labels.length;p++) if (labels[p]==='relay-dial') {
      lo=Math.min(lo,p%w);
      hi=Math.max(hi,p%w);
    }
    return hi-lo+1;
  }
  let handChanged=0, backgroundChanged=0;
  for (let p=0;p<a.length;p++) {
    if (onHand(a[p]) && (b[p]!==a[p] || local.passes.depth[p]!==baseline.passes.depth[p])) handChanged++;
    if (a[p]!=='relay-dial' && b[p]!=='relay-dial' &&
      [0,1,2].some(c=>baseline.rgb[3*p+c]!==local.rgb[3*p+c])) backgroundChanged++;
  }
  stats.push({time:t,yaw,pinError:Math.max(...points),pins:rule.pins,masterDialWidth:measure(a),localDialWidth:measure(b),
    handPixelsChanged:handChanged,backgroundPixelsChanged:backgroundChanged,
    contactAtPixel:{master:a[pixel] ?? null,local:b[pixel] ?? null}});
  const width=2*w+4,rgb=new Uint8Array(width*h*3).fill(26);
  for (let y=0;y<h;y++) {
    rgb.set(baseline.rgb.subarray(y*w*3,(y+1)*w*3),y*width*3);
    rgb.set(local.rgb.subarray(y*w*3,(y+1)*w*3),(y*width+w+4)*3);
  }
  const tag=String(i).padStart(2,'0');
  write(path.join(directory,'pair-'+tag+'.png'),PNG.encode(width,h,rgb));
  pairs.push({w:width,h,rgb});
}
PNG.animate(path.join(directory,'comparison.png'),pairs,fps);
json(path.join(directory,'report.json'),{scene:demo.id,width:w,height:h,fps,frames:stats});
