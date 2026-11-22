const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const {randomBytes}=require('node:crypto');

const files=new Map([
  ['/', ['music-session-player.html','text/html; charset=utf-8']],
  ['/player.mjs', ['music-session-player.mjs','text/javascript; charset=utf-8']]
]);

module.exports=function play(transport,{port,prepare,recipe,save}) {
  const key=randomBytes(24).toString('hex');
  const staticFiles=new Map([...files].map(([route,[file,type]])=>
    [route,{body:fs.readFileSync(path.join(__dirname,'../src/show',file)),type}]));
  let listener,lastPull=0,queued=Promise.resolve();
  function edit(changes) {
    const result=queued.then(async()=>{
      const ready=await prepare(transport.document(),changes);
      return transport.applyPrepared(ready);
    });
    queued=result.catch(()=>{});
    return result;
  }
  const command=({op,...args})=>{
    switch (op) {
      case 'state': return transport.state();
      case 'inspect': return transport.inspect();
      case 'switch': return transport.switchTake(args);
      case 'loop': return transport.setLoop(args);
      case 'monitor': return transport.setMonitor(args.selection ?? null);
      case 'keep': return edit([transport.keepEdit(args)]);
      case 'edit': return edit(args.changes);
      case 'pause': if (listener===args.client) listener=undefined; return transport.state();
      case 'save': return queued.then(()=>save ? save(transport.document()) : recipe(transport.document()));
      default: throw new RangeError('Unknown live session command');
    }
  };

  const server=http.createServer({requestTimeout:10000},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    function respond(status,value) {
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    }
    const host='127.0.0.1:'+server.address().port;
    if (req.headers.host!==host || (req.headers.origin && req.headers.origin!=='http://'+host) ||
      req.headers['sec-fetch-site']==='cross-site') return respond(403,{error:'Open the loopback URL printed by Ink'});
    const entry=staticFiles.get(req.url);
    if (req.method==='GET' && entry) {
      res.writeHead(200,{'Content-Type':entry.type});
      return res.end(entry.body);
    }
    if (req.method==='GET' && req.url==='/session') return respond(200,{key,state:transport.state()});
    if (req.method!=='POST' || !['/audio','/command'].includes(req.url)) return respond(404,{error:'Unknown route'});
    if (req.headers['x-ink-session']!==key) return respond(403,{error:'Session key required'});
    let bytes=0, chunks=[];
    try {
      for await (const chunk of req) {
        bytes+=chunk.length;
        if (bytes<=65536) chunks.push(chunk);
        else chunks=[];
      }
      if (bytes>65536) return respond(413,{error:'Session command exceeds 64 KiB'});
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url==='/command') return respond(200,await command(body));
      if (typeof body.client!=='string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.client))
        return respond(400,{error:'Provide a player ID'});
      if (listener && listener!==body.client && Date.now()-lastPull<2500)
        return respond(409,{error:'The session already has an audio listener'});
      const {value,start,clippedFrames}=transport.pull(body.frames);
      listener=body.client;
      lastPull=Date.now();
      const pcm=Buffer.allocUnsafe(value.samples.length*4);
      for (let i=0;i<value.samples.length;i++) pcm.writeFloatLE(value.samples[i],i*4);
      res.writeHead(200,{'Content-Type':'application/octet-stream',
        'X-Ink-Transport':JSON.stringify({...start,clippedFrames})});
      return res.end(pcm);
    } catch (error) {
      if (!res.destroyed && !res.headersSent) respond(400,{error:error.message});
    }
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{
      process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+server.address().port})+'\n');
    });
    server.once('close',resolve);
  });
};
