const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {Worker}=require('node:worker_threads');

const usage='story audition <recording|run-bundle> <soundtrack.json> --beat <beat-id> [--from seconds --to seconds] [--receipts receipts.json] [--port N]';

async function command(file,plan,rest,opt){
  const port=Number(opt.port??0);
  if(!file||!plan||rest.length||typeof opt.beat!=='string'||!Number.isInteger(port)||port<0||port>65535||
    Object.keys(opt).some(key=>!['beat','from','to','receipts','port'].includes(key))||
    opt.receipts!==undefined&&(typeof opt.receipts!=='string'||!opt.receipts.trim()))throw new TypeError('Use '+usage);
  const worker=new Worker(path.join(__dirname,'story-audition-worker.js'),{workerData:{
    file:path.resolve(file),plan:path.resolve(plan),beatId:opt.beat,from:opt.from,to:opt.to,
    ...(opt.receipts&&{receipts:path.resolve(opt.receipts)})
  }});
  let waiting, failure;
  function fail(error){
    failure=error;
    waiting?.reject(error);
  }
  worker.on('error',fail);
  worker.on('exit',code=>fail(new Error('World cue render worker stopped ('+code+')')));
  worker.on('message',message=>{
    const request=waiting;
    waiting=undefined;
    if(message.error)request?.reject(new RangeError(message.error));
    else request?.resolve(message);
  });
  function receive(edit){
    if(failure)return Promise.reject(failure);
    return new Promise((resolve,reject)=>{
      waiting={resolve,reject};
      if(edit!==undefined)worker.postMessage(edit);
    });
  }
  try{
    const {session}=await receive();
    const key=randomBytes(24).toString('hex');
    const page=path.join(__dirname,'../src/show');
    const staticFiles=new Map([
      ['/',[fs.readFileSync(path.join(page,'story-audition.html')),'text/html; charset=utf-8']],
      ['/audition.mjs',[fs.readFileSync(path.join(page,'story-audition.mjs')),'text/javascript; charset=utf-8']]
    ]);
    let busy=false;
    await new Promise((resolve,reject)=>{
      const server=http.createServer({requestTimeout:10000},async(req,res)=>{
        const host='127.0.0.1:'+server.address().port;
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
        function json(status,result){
          res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
          res.end(JSON.stringify(result));
        }
        if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!=='http://'+host)||
          req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'Open the loopback URL printed by Ink'});
        const staticFile=staticFiles.get(req.url);
        if(req.method==='GET'&&staticFile){
          res.writeHead(200,{'Content-Type':staticFile[1]});
          return res.end(staticFile[0]);
        }
        if(req.method==='GET'&&req.url==='/session')return json(200,{key,...session});
        if(req.method!=='POST'||req.url!=='/render')return json(404,{error:'Unknown route'});
        if(req.headers['x-ink-session']!==key)return json(403,{error:'Session key required'});
        try{
          const chunks=[];
          let size=0;
          for await(const chunk of req){
            size+=chunk.length;
            if(size<=4096)chunks.push(chunk);
          }
          if(size>4096)return json(413,{error:'Audition request exceeds its size limit'});
          if(busy)return json(409,{error:'A scene revision is rendering'});
          const edit=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          busy=true;
          try{
            const {result}=await receive(edit);
            if(!res.destroyed)json(200,result);
          }finally{busy=false;}
        }catch(error){
          if(!res.destroyed&&!res.headersSent)json(400,{error:error.message});
        }
      });
      server.once('error',reject);
      server.once('close',resolve);
      server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({
        url:'http://127.0.0.1:'+server.address().port,beatId:session.beatId})+'\n'));
    });
  }finally{await worker.terminate();}
}

module.exports={command,usage};
