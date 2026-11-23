/* Opt-in CLAP worker adapter. Session files can only reference manifest aliases. */
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const stateLimit=4*1024*1024, rateOk=rate=>Number.isInteger(rate) && rate>=8000 && rate<=96000;
const numeric=key=>/^(0|[1-9][0-9]{0,9})$/.test(key) && Number(key)<0xffffffff;
const record=x=>x && Object.getPrototypeOf(x)===Object.prototype;
const fields=(x,keys)=>record(x) && Object.keys(x).every(key=>keys.includes(key));
const text=x=>typeof x==='string' && x.length>0;
function check(ok,message) {if (!ok) throw new RangeError(message);}
function hashFile(file) {
  const result=createHash('sha256'), descriptor=fs.openSync(file,'r');
  try {
    const chunk=Buffer.alloc(128*1024);
    for (;;) {
      const count=fs.readSync(descriptor,chunk);
      if (!count) return result.digest('hex');
      result.update(chunk.subarray(0,count));
    }
  } finally {fs.closeSync(descriptor);}
}
const fileStamp=file=>{
  const s=fs.statSync(file,{bigint:true});
  check(s.isFile(),'Expected a regular CLAP binary');
  return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
};
function stateBytes(state) {
  if (state===undefined || state==='') return Buffer.alloc(0);
  check(typeof state==='string' && state.length<=Math.ceil(stateLimit/3)*4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(state),'Invalid base64 plugin state');
  const bytes=Buffer.from(state,'base64');
  check(bytes.length<=stateLimit && bytes.toString('base64')===state,'Invalid or oversized CLAP state');
  return bytes;
}
function encodeJob({sampleRate,state,input,key,frames=0,latency=0,tail=0,parameters,notes=[],transport,kind}) {
  const saved=stateBytes(state), header=Buffer.alloc(36), entries=Object.entries(parameters);
  check((kind===undefined || kind==='instrument') && rateOk(sampleRate) && entries.length<=64 && entries.every(([id])=>numeric(id)),
    'CLAP requires numeric parameter IDs and a valid render sample rate');
  [0x314b4e49,sampleRate,frames,(input?.length ?? 0)/2,(key?.length ?? 0)/2,saved.length,
    entries.length,latency,tail].forEach((value,i)=>header.writeUInt32LE(value,4*i));
  const instrument=kind==='instrument';
  check(notes.length<=2000000 && (instrument || !notes.length),'Invalid CLAP note event budget');
  const chunks=[header];
  if (instrument) {
    header.writeUInt32LE(0x324b4e49,0);
    const count=Buffer.alloc(12);
    count.writeUInt32LE(notes.length,0);
    count.writeUInt32LE(transport?.meter ?? 4,4);
    count.writeUInt32LE(transport?.changes.length ?? 0,8);
    chunks.push(count);
  }
  for (const [name,{points,curve}] of entries) {
    const row=Buffer.alloc(12+12*points.length);
    row.writeUInt32LE(Number(name),0);
    row.writeUInt32LE(Number(curve==='linear'),4);
    row.writeUInt32LE(points.length,8);
    for (const [i,{sample,value}] of points.entries()) {
      row.writeInt32LE(sample,12+12*i);
      row.writeDoubleLE(value,16+12*i);
    }
    chunks.push(row);
  }
  if (instrument) {
    const events=Buffer.alloc(notes.length*24);
    for (let i=0;i<notes.length;i++) {
      const {sample,id,key,type,value}=notes[i], at=i*24;
      events.writeUInt32LE(sample,at);
      events.writeInt32LE(id,at+4);
      events.writeInt16LE(key,at+8);
      events.writeInt16LE(type,at+10);
      events.writeDoubleLE(value,at+16);
    }
    chunks.push(events);
    if (transport) {
      const map=Buffer.alloc(transport.changes.length*20);
      for (const [i,{sample,beat,tempo}] of transport.changes.entries()) {
        const at=i*20;
        map.writeUInt32LE(sample,at);
        map.writeDoubleLE(beat,at+4);
        map.writeDoubleLE(tempo,at+12);
      }
      chunks.push(map);
    }
  }
  chunks.push(saved);
  for (const samples of [input,key]) if (samples?.length) {
    const audio=Float32Array.from(samples);
    chunks.push(Buffer.from(audio.buffer));
  }
  return Buffer.concat(chunks);
}
function load(file) {
  check(text(file) && os.endianness()==='LE','--clap-host needs a manifest on a little-endian host');
  const config=JSON.parse(fs.readFileSync(file,'utf8')), dir=path.dirname(path.resolve(file));
  check(fields(config,['worker','plugins']) && text(config.worker) && record(config.plugins) &&
    Object.keys(config.plugins).length<=64,'Invalid CLAP worker manifest');
  const worker=path.resolve(dir,config.worker), cache=new Map(), probes=new Map();
  function plugin(alias) {
    if (cache.has(alias)) return cache.get(alias);
    const row=Object.hasOwn(config.plugins,alias) && config.plugins[alias];
    check(fields(row,['file','id','sha256']) && text(row.file) && text(row.id) && row.id.length<=256 &&
      (row.sha256===undefined || /^[a-f0-9]{64}$/.test(row.sha256)), 'No registered CLAP plugin alias '+alias);
    let binary=path.resolve(dir,row.file), entry=binary;
    if (fs.statSync(binary).isDirectory()) {
      check(binary.endsWith('.clap'),'Expected a CLAP binary or bundle');
      const folder=path.join(binary,'Contents','MacOS'), entries=fs.readdirSync(folder,{withFileTypes:true}).filter(x=>x.isFile());
      check(entries.length===1,'Provide the explicit CLAP binary in a multi-executable bundle');
      binary=path.join(folder,entries[0].name);
    } else {
      const bundle=binary.match(/^(.*\.clap)\/Contents\/MacOS\//);
      if (bundle) entry=bundle[1];
    }
    const stamp=fileStamp(binary), sha256=hashFile(binary);
    check(stamp===fileStamp(binary),'CLAP binary changed during identification');
    check(row.sha256===undefined || row.sha256===sha256,'CLAP binary does not match its registered SHA-256');
    const result={binary,entry,stamp,id:row.id,identity:'clap:'+createHash('sha256').update(sha256+'\0'+row.id).digest('hex')};
    cache.set(alias,result);
    return result;
  }
  function execute(mode,row,request,read) {
    check(row.stamp===fileStamp(row.binary),'CLAP binary changed after registration');
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-clap-'));
    try {
      const job=path.join(temp,'job.bin'), output=path.join(temp,'output.bin'), meta=path.join(temp,'meta.txt');
      fs.writeFileSync(job,encodeJob(request));
      execFileSync(worker,[mode,row.binary,row.entry,row.id,job,output,meta,...(request.preset ? [request.preset] : [])],{timeout:45000,maxBuffer:2*1024*1024,encoding:'utf8'});
      return read(output,meta);
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
  }
  function initial(values) {
    check(record(values) && Object.entries(values).every(([key,value])=>numeric(key)&&Number.isFinite(value)),
      'Expected scalar CLAP parameters keyed by numeric ID');
    return Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{curve:'hold',points:[{sample:0,value}]}]));
  }
  function describe(request) {
    const row=plugin(request.plugin), data={...request,parameters:initial(request.initial)};
    const cacheKey=JSON.stringify([row.identity,request.sampleRate,request.kind,request.state,request.initial]);
    if (probes.has(cacheKey)) return probes.get(cacheKey);
    const result=execute('probe',row,data,(_audio,meta)=>{
      const [head,...rows]=fs.readFileSync(meta,'utf8').trim().split('\n');
      const [latency,tail,key,dialect]=head.trim().split(' ').map(Number);
      return {latency,tail,sidechain:key!==0,identity:row.identity,
        ...(request.kind==='instrument' && {notes:dialect===1 ? 'clap' : dialect===2 ? 'midi' : null}),parameters:Object.fromEntries(rows.map(line=>{
        const [id,min,max,automatable,stepped]=line.trim().split(' ').map(Number);
        return [id,{min,max,automatable:automatable===1,stepped:stepped===1}];
      }))};
    });
    if (probes.size<128) probes.set(cacheKey,result);
    return result;
  }
  function render(request) {
    const row=plugin(request.plugin);
    check(request.identity===row.identity,'CLAP identity changed after planning');
    return execute('render',row,request,output=>{
      const data=fs.readFileSync(output);
      check(data.length===request.frames*8,'CLAP returned the wrong frame count');
      return Float64Array.from({length:request.frames*2},(_,i)=>data.readFloatLE(i*4));
    });
  }
  function snapshot(alias,settings={}) {
    check(fields(settings,['sampleRate','state','parameters','kind','preset']) &&
      (settings.preset===undefined || text(settings.preset) && settings.state===undefined),
      'Invalid plugin state settings. Use either state or a preset file');
    const {sampleRate=48000,state,parameters={},kind,preset}=settings, row=plugin(alias);
    const presetFile=preset===undefined ? undefined : path.resolve(preset);
    if (presetFile) check(fs.statSync(presetFile).isFile(),'Expected a regular CLAP preset file');
    const saved=execute('snapshot',row,{sampleRate,state,kind,preset:presetFile,parameters:initial(parameters)},output=>fs.readFileSync(output,'base64'));
    return {plugin:alias,identity:row.identity,state:saved};
  }
  function inspect(plugin,settings={}) {
    check(fields(settings,['sampleRate','state','parameters','kind']),'Invalid plugin inspection settings');
    const {sampleRate=48000,state,parameters:initial={},kind}=settings;
    return {plugin,...describe({plugin,sampleRate,state,initial,kind})};
  }
  return {adapters:{clap:{describe,render}},snapshot,inspect,pluginId:alias=>plugin(alias).id};
}
module.exports={load};
