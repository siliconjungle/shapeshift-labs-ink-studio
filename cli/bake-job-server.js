const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {inspectBakeJob,runBakeJob,latestBakeJob}=require('./bake-jobs.js');

const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.tiff':'image/tiff','.svg':'image/svg+xml; charset=utf-8','.exr':'image/x-exr'};
const reference=/^\/revisions\/bake-[A-Za-z0-9]{6}\/(?:[\w.-]+\/)*[\w.-]+$/;
const response=(res,code,value,mime)=>{res.writeHead(code,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Content-Type':mime??type['.json']});res.end(mime?value:JSON.stringify(value));};

async function read(req) {
  const parts=[];
  let length=0;
  for await(const chunk of req) {
    length+=chunk.length;
    if(length>65536)throw new RangeError('Bake request exceeds its byte budget');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

async function serveBakeJob(file,{directory,port=0,signal,presetFile}={}) {
  if(typeof directory!=='string'||!directory.trim()||!Number.isSafeInteger(port)||port<0||port>65535)
    throw new TypeError('The bake workstation needs a directory and a valid local port');
  const root=path.resolve(directory), initial=await inspectBakeJob(file,{signal,presetFile});
  const token=randomBytes(24).toString('hex');
  const src=name=>fs.readFileSync(path.join(__dirname,name));
  let active, event, failure, origin;
  let latest=latestBakeJob(root);
  function state() {
    return {event:event??{event:'idle',completed:0,total:0},error:failure,active:Boolean(active),latest};
  }
  function launch(body) {
    if(active)throw new Error('A bake job is already running');
    if(!body.preset||!Array.isArray(body.targets)||Object.keys(body).some(key=>!['action','preset','targets'].includes(key)))
      throw new TypeError('Run needs an edited preset and target selections');
    const controller=new AbortController();
    event={event:'preparing',completed:0,total:0};failure=undefined;
    const job=runBakeJob(file,{directory:root,signal:controller.signal,presetFile,presetValue:body.preset,targetValues:body.targets,
      onProgress:row=>{event=row;}});
    active={controller,job};
    job.then(result=>{
      if(result.status==='completed')latest=latestBakeJob(root);
      event={...event,event:result.status};
    },error=>{failure=error.message;event={...event,event:'failed'};}).finally(()=>{active=undefined;});
  }
  const server=http.createServer(async (req,res)=>{
    if(req.headers.host!==origin?.slice('http://'.length))return response(res,403,{error:'Use the local bake workstation URL'});
    const endpoint=req.url;
    try {
      if(req.method==='POST') {
        if(endpoint!=='/api/control'||req.headers.origin!==origin||req.headers['x-ink-bake']!==token||
          req.headers['content-type']!=='application/json')
          return response(res,403,{error:'Use the local bake workstation controls'});
        const body=await read(req);
        if(body?.action==='run')launch(body);
        else if(body?.action==='cancel'&&Object.keys(body).length===1)active?.controller.abort(new Error('Bake cancelled'));
        else throw new TypeError('Unknown bake action');
        return response(res,202,state());
      }
      if(req.method!=='GET')return response(res,405,{error:'Unsupported method'});
      if(endpoint==='/api/state')return response(res,200,state());
      if(endpoint==='/')return response(res,200,src('bake-job.html'),type['.html']);
      if(endpoint==='/live.js')return response(res,200,src('bake-job.browser.js'),type['.js']);
      if(endpoint==='/data.js')return response(res,200,'const bakeJob = '+JSON.stringify({...initial,token})+';',type['.js']);
      if(reference.test(endpoint)&&endpoint.split('/').every(p=>p!=='.'&&p!=='..')) {
        const filename=path.join(root,endpoint.slice(1)), ext=path.extname(filename);
        if(type[ext]&&fs.statSync(filename,{throwIfNoEntry:false})?.isFile()) {
          const resolved=fs.realpathSync(filename), inside=path.relative(fs.realpathSync(root),resolved);
          if(!inside.startsWith('..'+path.sep)&&inside!=='..'&&!path.isAbsolute(inside))
            return response(res,200,fs.readFileSync(resolved),type[ext]);
        }
      }
      return response(res,404,{error:'Bake resource not found'});
    } catch(error) {
      return response(res,400,{error:error.message});
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
  origin='http://127.0.0.1:'+server.address().port;
  const close=async()=>{
    const job=active?.job;
    active?.controller.abort(new Error('Bake workstation closed'));
    await job?.catch(()=>{});
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  };
  return {url:origin,close};
}
module.exports={serveBakeJob};
