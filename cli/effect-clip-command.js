/* Local workbench transport and headless commands for an editable effect clip. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {randomBytes} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {readEffectClip} = require('./effect-clip.js');
const assets = require('./asset-files.js');
const usage = [
  'ink-studio effect-clip serve <clip.json> [--port N]',
  'ink-studio effect-clip preview <clip.json> [--at seconds] [--edits file.json] [--out directory]',
  'ink-studio effect-clip export <clip.json> [--edits file.json] --out directory'
];

async function startEffectClipEditor(clip,{port=0}={}) {
  const page=path.join(__dirname,'../src/show');
  const staticFiles=new Map([
    ['/',[fs.readFileSync(path.join(page,'effect-clip.html')),'text/html; charset=utf-8']],
    ['/editor.mjs',[fs.readFileSync(path.join(page,'effect-clip.mjs')),'text/javascript; charset=utf-8']]
  ]);
  const key=randomBytes(24).toString('hex'), maxBody=1024*1024, maxResponse=16*1024*1024;
  let busy=false,previousEdit;
  const server=http.createServer({requestTimeout:10000},async(req,res)=>{
    const host='127.0.0.1:'+server.address().port;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    function reply(status,value){
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    }
    if(req.headers.host!==host || req.headers.origin && req.headers.origin!=='http://'+host ||
      req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Open the loopback URL printed by Ink.'});
    if(req.method==='GET'&&staticFiles.has(req.url)){
      const [body,type]=staticFiles.get(req.url);
      res.writeHead(200,{'Content-Type':type});
      return res.end(body);
    }
    if(req.method==='GET'&&req.url==='/session')return reply(200,{key,state:clip.state()});
    if(req.method!=='POST'||!['/preview','/download'].includes(req.url))return reply(404,{error:'Unknown editor route.'});
    if(req.headers['x-ink-session']!==key)return reply(403,{error:'Session key required.'});
    if(busy)return reply(409,{error:'A frame is already rendering.'});
    try {
      const chunks=[];
      let size=0;
      for await(const chunk of req){
        size+=chunk.length;
        if(size<=maxBody)chunks.push(chunk);
      }
      if(size>maxBody)return reply(413,{error:'Editor request exceeds 1 MiB.'});
      if(busy)return reply(409,{error:'A frame is already rendering.'});
      const {time,edit,kind}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      busy=true;
      try {
        if(edit!==undefined&&!isDeepStrictEqual(edit,previousEdit)){
          clip.edit(edit);
          previousEdit=edit;
        }
        if(req.url==='/download'){
          if(!['clip','group'].includes(kind))return reply(400,{error:'Choose clip or group.'});
          const document=clip.documents(null)[kind];
          const filename=clip.snapshot().id+(kind==='clip'?'.effect.json':'.group.json');
          return reply(200,{document,filename});
        }
        const result=await clip.preview(time);
        const shown=result.artifacts.filter(entry=>entry.format==='png'||entry.format==='json');
        if(shown.reduce((sum,entry)=>sum+entry.bytes.length,0)>maxResponse)
          return reply(413,{error:'Pinned previews exceed 16 MiB. Unpin some passes.'});
        return reply(200,{ state:clip.state(),report:result.report,
          artifacts:shown.map(({file,format,bytes})=>({
            file,format,data:format==='png'?bytes.toString('base64'):bytes.toString('utf8')
          })) });
      } finally { busy=false; }
    } catch(error) {
      if(!res.destroyed&&!res.headersSent)reply(400,{error:error.message});
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
  return {server,url:'http://127.0.0.1:'+server.address().port};
}

async function command(args,opt,context){
  const [mode,file]=args;
  const flags={serve:['port'],preview:['at','edits','out'],export:['edits','out']};
  const allowed=flags[mode];
  if(args.length!==2||!file||!allowed||Object.keys(opt).some(key=>!allowed.includes(key)||opt[key]===true)||
     mode==='export'&&typeof opt.out!=='string')throw new TypeError(usage.join('\n'));
  const clip=readEffectClip(file,context);
  try {
    if(opt.edits!==undefined)clip.edit(JSON.parse(fs.readFileSync(path.resolve(opt.edits),'utf8')));
    if(mode==='serve'){
      const port=Number(opt.port??0);
      if(!Number.isInteger(port)||port<0||port>65535)throw new RangeError('--port needs an integer from 0 through 65535');
      const {server,url}=await startEffectClipEditor(clip,{port});
      console.log(JSON.stringify({url,id:clip.snapshot().id}));
      await new Promise(resolve=>server.once('close',resolve));
    } else if(mode==='export') console.log(JSON.stringify(clip.export(opt.out)));
    else {
      const result=await clip.preview(Number(opt.at??0));
      if(opt.out){
        const directory=path.resolve(opt.out);
        const source=fs.realpathSync(file);
        for(const name of ['report.json',...result.artifacts.map(row=>row.file)]){
          const target=path.join(directory,name);
          if(fs.existsSync(target)&&fs.realpathSync(target)===source)throw new RangeError('Preview would overwrite the effect clip');
        }
        for(const {file,bytes} of result.artifacts)assets.write(path.join(directory,file),bytes);
        assets.json(path.join(directory,'report.json'),result.report);
      }
      console.log(JSON.stringify(result.report));
    }
  } finally { clip.clear(); }
}

module.exports={command,startEffectClipEditor,usage};
