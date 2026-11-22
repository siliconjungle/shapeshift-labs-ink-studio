const fs=require('node:fs'),path=require('node:path');
const WAV=require('./wav.js'),{write,json}=require('./asset-files.js'),{readAssets}=require('./music-mixer.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const presets=new Map([
  require('../examples/audio-racks/steel-bus.json'),
  require('../examples/audio-racks/porcelain-room.json'),
  require('../examples/audio-racks/pocket-repeater.json'),
  ...require('../examples/audio-racks/production-tools.cjs')
].map(rack=>[rack.id,rack]));
const print=value=>{process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;};
function rackCommand([mode,name,file],opt,kit) {
  if (mode==='list') return print([...presets.values()].map(({id,title,description,inputs,macros})=>
    ({id,title,description,inputs:Object.keys(inputs),macros:Object.fromEntries(Object.entries(macros).map(([id,row])=>[id,row.label]))})));
  if (!name) throw new TypeError('Choose a rack preset ID or a definition file');
  const host=opt['clap-host']===undefined ? undefined : require('./clap-adapter').load(opt['clap-host']);
  if (mode==='plugin-info' || mode==='plugin-state') {
    if (!host) throw new TypeError('Plugin commands need --clap-host manifest.json');
    const saved=host[mode==='plugin-info' ? 'inspect' : 'snapshot'](name,file ? read(file) : {});
    if (typeof opt.out==='string') json(opt.out,saved);
    return print(saved);
  }
  const preset=presets.get(name), rack=preset ?? read(name), P=kit.KIT.procedural, A=P.mediaGraph.audioRack;
  const root=preset ? path.resolve(__dirname,'../examples/audio-racks') : path.dirname(path.resolve(name));
  if (mode==='describe') {
    A.state(rack);
    if (typeof opt.out!=='string') return print(rack);
    const folder=path.dirname(path.resolve(opt.out));
    const output=rack.assets ? {...rack,assets:Object.fromEntries(Object.entries(rack.assets).map(([id,file])=>
      [id,path.relative(folder,path.resolve(root,file))]))} : rack;
    json(opt.out,output);
    return print(output);
  }
  if (mode==='state') {
    const state=A.state(rack,file ? read(file) : {});
    if (typeof opt.out==='string') json(opt.out,state);
    return print(state);
  }
  if (!['render','audition'].includes(mode) || !file || typeof opt.out!=='string')
    throw new TypeError('Use music rack render or audition <rack> recipe.json --out directory');
  const recipe=read(file),{fields,record,check}=P.musicInstruments;
  check(fields(recipe,['assets','state','options']) && record(recipe.assets),'Rack recipe needs audio assets and optional state and settings');
  A.state(rack);
  const bundled=Object.fromEntries(Object.entries(rack.assets ?? {}).map(([id,file])=>[id,path.resolve(root,file)]));
  const inputs=readAssets({...bundled,...recipe.assets},file,P), state=typeof recipe.state==='string' ?
    read(path.resolve(path.dirname(path.resolve(file)),recipe.state)) : recipe.state;
  const result=A[mode](rack,inputs,state,recipe.options,host), folder=path.resolve(opt.out);
  const paths={rack:path.join(folder,'rack.wav'),state:path.join(folder,'state.json'),report:path.join(folder,'report.json')};
  write(paths.rack,WAV.encode(result.value,{encoding:'pcm24'}));
  json(paths.state,result.state);
  json(paths.report,result.report);
  for (const name of ['bypass','difference','effect']) if (result[name]) {
    paths[name]=path.join(folder,name+'.wav');
    write(paths[name],WAV.encode(result[name],{encoding:'pcm24'}));
  }
  for (const [name,audio] of Object.entries(result.taps ?? {})) {
    paths.taps ??= {};
    const file=path.join(folder,'taps',name+'.wav');
    write(file,WAV.encode(audio,{encoding:'pcm24'}));
    paths.taps[name]=file;
  }
  return print(paths);
}
module.exports=rackCommand;
