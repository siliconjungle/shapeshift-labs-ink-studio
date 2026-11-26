const fs=require('node:fs');
const path=require('node:path');
const {runBakeJob}=require('../../cli/bake-jobs.js');
const {readTexture}=require('../../cli/texture-files.js');
const PNG=require('../../cli/png.js');
const {writeCoupons}=require('./coupons.cjs');

const out=path.resolve(process.argv[2]??'studio/out/halcyon-gauge'), at=name=>path.join(out,name);
const save=(name,document)=>fs.writeFileSync(at(name),JSON.stringify(document,null,2)+'\n');
const clamp=n=>Math.max(0,Math.min(1,n));

function painted(distance,valid,coverage,scale) {
  const {width,height,data}=distance, bytes=new Uint8Array(width*height*4);
  const mix=(a,b,t)=>a.map((value,i)=>Math.round(value+(b[i]-value)*t));
  for(let i=0;i<data.length;i++) {
    if(!coverage.data[i])continue;
    const x=i%width,y=Math.floor(i/width), u=x/width*4%1,v=y/height*2%1;
    const border=Math.min(u-.092,.908-u,v-.118,.882-v);
    const rings=Math.abs(u-.5)+Math.abs(v-.5),
      line=Math.abs(rings-.19)<.009||Math.abs(rings-.25)<.008;
    const grain=.96+.04*Math.sin(x*85.7+y*14.9)*Math.cos(y*13.6-x*6.7);
    let color;
    if(valid.data[i]) {
      const length=distance.bitDepth===16?data[i]*scale/65535:data[i];
      color=mix([28,99,110],[234,168,99],clamp(length/.7));
      if(line||border<.027)color=mix(color,[252,225,166],.70);
    } else {
      color=((x+y)%9<3)?[86,53,57]:[51,46,56];
      if(border<.025)color=[149,91,85];
    }
    bytes.set([...color.map(value=>Math.round(value*grain)),255],i*4);
  }
  return PNG.encode(width,height,bytes,4);
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  const fixture=writeCoupons(at('coupons.glb'));
  const plan={format:'ink-studio/bake-job',version:1,label:'Halcyon Gauge',source:'coupons.glb',
    preset:'normal.preset.json',targets:[{id:'coupons',mesh:'Test coupons',submeshes:fixture.selected,thicknessParts:fixture.labels}]};
  const variants=[
    ['normal','Inward normal',{encoding:'exr',thicknessScale:.65}],
    ['axis','Oblique ray',{encoding:'exr',thicknessDirection:'axis',thicknessAxis:[.6,0,.8],thicknessScale:.65}],
    ['short','Short search range',{encoding:'exr',thicknessRange:.25,thicknessScale:.65}],
    ['png16','Normalized PNG16',{encoding:'png16',thicknessScale:.5}]
  ];
  save('halcyon.bake.json',plan);
  save('reference.json',fixture.coupons);
  const data={presets:{},coupons:fixture.coupons};
  for(const [id,label,overrides] of variants) {
    const preset={format:'ink-studio/bake-preset',version:1,label,defaults:{size:256,padding:2},
      maps:[{id:'thickness',overrides},{id:'coverage'}]};
    save(id+'.preset.json',preset);
    const baked=await runBakeJob(at('halcyon.bake.json'),{directory:at(id),presetFile:at(id+'.preset.json')});
    const base=id+'/revisions/'+baked.revision+'/', rows=baked.report.maps;
    const row=rows.find(row=>row.map==='thickness');
    const open=file=>readTexture(at(base+file));
    const thickness=open(row.file), valid=open(row.validityFile), coverage=open(rows.find(row=>row.map==='coverage').file);
    const scale=row.geometry.thicknessScale, preview=id+'.png';
    fs.writeFileSync(at(preview),painted(thickness,valid,coverage,scale));
    const readings=fixture.coupons.map((_,i)=>{
      const x=((i%4)+.5)*thickness.width/4,y=(Math.floor(i/4)+.5)*thickness.height/2,p=x+y*thickness.width;
      return valid.data[p]?thickness.data[p]*(thickness.bitDepth===16?scale/65535:1):null;
    });
    data.presets[id]={label,preview,original:base+row.file,validity:base+row.validityFile,
      workstation:base+'index.html',readings,stats:row.geometry.thickness,encoding:row.output.encoding};
  }
  fs.writeFileSync(at('data.js'),'const demo='+JSON.stringify(data)+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
