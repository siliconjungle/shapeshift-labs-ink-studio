const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const Assets=require('./asset-files.js');

function hashFile(file) {
  const hash=createHash('sha256'), chunk=Buffer.allocUnsafe(256*1024);
  const fd=fs.openSync(file,'r');
  try {
    if(!fs.fstatSync(fd).isFile())throw new TypeError('Bake dependencies need regular files');
    let size;
    while((size=fs.readSync(fd,chunk,0,chunk.length,null)))hash.update(chunk.subarray(0,size));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hex=/^[a-f0-9]{64}$/;
const ordinary=/^(?:[\w.-]+\/)*[\w.-]+$/;
function safeFile(root,name) {
  if(typeof name!=='string'||!ordinary.test(name)||name.split('/').some(piece=>piece==='.'||piece==='..'))
    throw new TypeError('Invalid bake artifact path');
  const file=path.join(root,name);
  const resolved=fs.realpathSync(file), inside=path.relative(fs.realpathSync(root),resolved);
  if(inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside)||!fs.lstatSync(file).isFile())
    throw new RangeError('Bake artifact must be a regular file within its revision');
  return file;
}

function paths(report) {
  const found=new Set(['report.json']);
  for(const row of report.maps)for(const level of [row,...(row.mips??[])])
    for(const key of ['file','previewFile','validityFile'])if(level[key])found.add(level[key]);
  for(const debug of report.uvDebug??[])for(const file of Object.values(debug.files))found.add(file);
  return [...found].sort();
}

function readUnit(directory,report,inputs) {
  const files=paths(report).map(name=>{
    const file=safeFile(directory,name);
    return {name,bytes:fs.statSync(file).size,sha256:hashFile(file)};
  });
  const expected=new Map(files.map(row=>[row.name,row.sha256]));
  for(const row of report.maps)for(const part of [row,...(row.mips??[])]) {
    if(expected.get(part.file)!==part.sha256||part.validityFile&&expected.get(part.validityFile)!==part.validitySha256)
      throw new Error('Bake output hash changed before publication');
  }
  return {directory,report,files,inputs,bytes:files.reduce((size,row)=>size+row.bytes,0)};
}

function open(root,options) {
  const folder=path.join(root,'ink-bake-cache-v1');
  const receipt='cache.json', limit=options.maxMb*1024**2;
  const entry=key=>path.join(folder,key);
  function read(key) {
    if(options.policy!=='reuse')return;
    try {
      const directory=entry(key), manifest=json(safeFile(directory,receipt));
      if(manifest.version!==1||manifest.key!==key||!Array.isArray(manifest.inputs)||!Array.isArray(manifest.files))
        return;
      if(manifest.inputs.some(({file,sha256})=>!path.isAbsolute(file)||!hex.test(sha256)||hashFile(file)!==sha256))
        return;
      for(const {name,bytes,sha256} of manifest.files) {
        const file=safeFile(directory,name);
        if(!hex.test(sha256)||fs.statSync(file).size!==bytes||hashFile(file)!==sha256)return;
      }
      const report=json(safeFile(directory,'report.json')), expected=paths(report);
      if(report.format!=='ink-studio/bake-job-report'||report.version!==1||
        expected.length!==manifest.files.length||expected.some((name,i)=>name!==manifest.files[i].name))return;
      try {const now=new Date();fs.utimesSync(directory,now,now);} catch {}
      return {directory,report,inputs:manifest.inputs,files:manifest.files,
        bytes:manifest.files.reduce((size,row)=>size+row.bytes,0)};
    } catch { return undefined; }
  }
  function write(key,unit) {
    if(options.policy==='off'||unit.bytes>limit)return false;
    let scratch;
    try {
      fs.mkdirSync(folder,{recursive:true});
      scratch=fs.mkdtempSync(path.join(folder,'.entry-'));
      for(const row of unit.files)copy(unit.directory,row.name,scratch);
      Assets.json(path.join(scratch,receipt),{version:1,key,inputs:unit.inputs,files:unit.files});
      fs.rmSync(entry(key),{recursive:true,force:true});
      fs.renameSync(scratch,entry(key));
      return true;
    } catch { return false; }
    finally { if(scratch)fs.rmSync(scratch,{recursive:true,force:true}); }
  }
  function prune() {
    if(options.policy==='off'||!fs.existsSync(folder))return;
    const entries=fs.readdirSync(folder,{withFileTypes:true}).filter(row=>row.isDirectory()&&hex.test(row.name)).map(row=>{
      const directory=entry(row.name), time=fs.statSync(directory).mtimeMs;
      let bytes;
      try {bytes=json(safeFile(directory,receipt)).files.reduce((n,file)=>n+file.bytes,0);}
      catch {bytes=0;}
      return {directory,time,bytes};
    }).sort((a,b)=>a.time-b.time||a.directory.localeCompare(b.directory));
    let total=entries.reduce((n,row)=>n+row.bytes,0), count=entries.length;
    for(const row of entries) {
      if(total<=limit&&count<=options.maxEntries)break;
      fs.rmSync(row.directory,{recursive:true,force:true});
      total-=row.bytes;count--;
    }
  }
  return {read,write,prune};
}

function copy(from,name,to,alias=name) {
  const source=safeFile(from,name), file=path.join(to,alias);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.copyFileSync(source,file);
  return file;
}

module.exports={open,readUnit,copy,safeFile,hashFile};
