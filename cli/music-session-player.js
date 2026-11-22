const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const {randomBytes,createHash}=require('node:crypto');
const WAV=require('./wav.js'), {write}=require('./asset-files.js');
const Recording=require('./music-session-recording.js');
const {createSoundBrowser}=require('./music-sound-browser.js');

const files=new Map([
  ['/', ['music-session-player.html','text/html; charset=utf-8']],
  ...Object.entries({
    'player':'music-session-player',
    'sound-browser':'music-session-sound-browser',
    'recording':'music-session-recording',
    'recording-clock':'music-session-recording-clock',
    'instrument-worklet':'music-session-instrument-worklet',
    'sample-capture':'sample-capture',
    'sample-capture-worklet':'sample-capture-worklet',
    'rolling-audio':'rolling-audio'
  }).map(([route,file])=>['/'+route+'.mjs',[file+'.mjs','text/javascript; charset=utf-8']])
]);

module.exports=function play(transport,{port,prepare,searchSounds,discard,editor,assets,paths,P,recordings,recipe,save}) {
  const key=randomBytes(24).toString('hex');
  const staticFiles=new Map([...files].map(([route,[file,type]])=>
    [route,{body:fs.readFileSync(path.join(__dirname,'../src/show',file)),type}]));
  const recorded=Object.create(null), commits=new Map();
  const browser=createSoundBrowser(P,assets,paths);
  staticFiles.set('/instrument-core.mjs',{body:Recording.instrumentCore(),type:'text/javascript; charset=utf-8'});
  let listener,lastPull=0,queued=Promise.resolve();
  function enqueue(job) {
    const result=queued.then(job);
    queued=result.catch(()=>{});
    return result;
  }
  const edit=changes=>enqueue(async()=>transport.applyPrepared(await prepare(transport.document(),changes)));
  function record(payload) {
    return enqueue(async()=>{
      const {meta,audio}=Recording.unpack(payload);
      if (!listener || listener!==meta?.client) throw new RangeError('Play this loop in the recording window first');
      const digest=createHash('sha256').update(payload).digest('hex'), prior=commits.get(meta.id);
      if (prior) {
        if (prior.digest!==digest) throw new RangeError('Capture ID already used');
        return prior.ack;
      }
      const {take,changes,asset,micLane,range,pass}=Recording.capture(P,transport.document(),
        transport.state(),meta,audio,transport.inspect().pins);
      let staged=false, written;
      try {
        if (asset) {
          editor.addAsset(asset.name,asset.pcm);
          staged=true;
          const target=path.join(recordings,asset.name+'.wav');
          if (fs.existsSync(target)) throw new RangeError('Recording file already exists');
          write(target,WAV.encode(asset.pcm,{encoding:'float32'}));
          written=target;
        }
        const ready=await prepare(transport.document(),changes,asset);
        transport.applyPrepared(ready);
      } catch (error) {
        if (staged) {
          editor.discardAsset(asset.name);
          discard(asset.name);
        }
        if (written) fs.unlinkSync(written);
        throw error;
      }
      if (written) recorded[asset.name]=written;
      const ack={take,range,pass,...(micLane && {micLane})};
      commits.set(meta.id,{digest,ack});
      return ack;
    });
  }
  function instrument(lane) {
    const {production}=transport.document(), track=Object.hasOwn(production.tracks,lane) && production.tracks[lane];
    const patch=track && production.patches[track.patch];
    if (!patch || patch.type==='clap') throw new RangeError('Choose a native instrument lane');
    const {performance,echo,gestures,...voice}=patch;
    const recorded=performance?.rules?.filter(rule=>rule.recorded);
    return {patch:voice,...(recorded?.length && {performance:{connect:performance.connect,rules:recorded}}),
      assets:[...new Set(P.musicInstruments.assetNames(voice))],gain:Math.min(1,10**((track.gain ?? 0)/20))};
  }
  const soundRange=({from,to})=>({from:{samples:from},to:{samples:to}});
  function audition(args) {
    return enqueue(()=>{
      if (args.id===null) return transport.setSound(null);
      const session=transport.document(), {lane,source,id}=args, {loop,scoreSample}=transport.state();
      const {revision,additions}=browser.candidate(session,args);
      const {range,material}=editor.prepareSound(session,{lane,revision,warmAt:scoreSample,...soundRange(loop)},
        Object.fromEntries(additions.map(({name,pcm})=>[name,pcm])));
      return transport.setSound({lane,source,id,from:range.from,to:range.to,material});
    });
  }
  function keepSound(args) {
    return enqueue(async()=>{
      const before=transport.state(), {sound}=before, session=transport.document(), {fields,id}=P.musicInstruments;
      if (!fields(args,['lane','id','source','take']) || !sound || args.id!==sound.id ||
        args.lane!==sound.lane || args.source!==sound.source)
        throw new RangeError('Audition this sound before keeping it');
      const take=args.take ?? browser.nameTake(session,sound.id);
      if (!id(take) || take==='reference' || Object.hasOwn(session.takes ?? {},take))
        throw new RangeError('Choose a new take name using letters, digits, hyphens or underscores');
      const {revision,additions}=browser.candidate(session,sound), changes=[
        {op:'score-take',take,revision},
        {op:'comp',lane:sound.lane,take,...soundRange(sound)}
      ], staged=[];
      let workerStaged=false;
      try {
        for (const asset of additions) {
          editor.addAsset(asset.name,asset.pcm);
          staged.push(asset);
        }
        const ready=await prepare(session,changes,additions.map(({name,pcm})=>({name,pcm})));
        workerStaged=true;
        transport.applyPrepared(ready);
      } catch (error) {
        for (const {name} of staged) {
          editor.discardAsset(name);
          if (workerStaged) discard(name);
        }
        throw error;
      }
      for (const {name,pcm,file} of staged) {
        recorded[name]=file;
        assets[name]=pcm;
      }
      const {loop,lanes}=transport.state(), selection=lanes[sound.lane].take;
      if (selection && selection===before.lanes[sound.lane].take && loop.from===sound.from && loop.to===sound.to)
        transport.switchTake({lane:sound.lane,take:null});
      return {lane:sound.lane,take,from:sound.from,to:sound.to};
    });
  }
  const command=({op,...args})=>{
    switch (op) {
      case 'state': return transport.state();
      case 'sounds': return searchSounds(transport.document(),{...transport.state(),pins:transport.inspect().pins},args);
      case 'audition-sound': return audition(args);
      case 'keep-sound': return keepSound(args);
      case 'inspect': return transport.inspect();
      case 'instrument': return instrument(args.lane);
      case 'recording-lanes': {
        const {production}=transport.document();
        return Object.keys(production.tracks).filter(lane=>production.patches[production.tracks[lane].patch].type!=='clap');
      }
      case 'trace': return transport.trace(args.preview);
      case 'switch': return transport.switchTake(args);
      case 'loop': return transport.setLoop(args);
      case 'monitor': return transport.setMonitor(args.selection ?? null);
      case 'keep': return edit([transport.keepEdit(args)]);
      case 'edit': return edit(args.changes);
      case 'pause': if (listener===args.client) listener=undefined; return transport.state();
      case 'save': return queued.then(()=>save ? save(transport.document(),recorded) : recipe(transport.document(),recorded));
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
    if (req.method!=='POST' || !['/audio','/command','/record','/instrument-asset'].includes(req.url)) return respond(404,{error:'Unknown route'});
    if (req.headers['x-ink-session']!==key) return respond(403,{error:'Session key required'});
    const limit=req.url==='/record' ? Recording.bodyBudget : 65536;
    let bytes=0, chunks=[];
    try {
      for await (const chunk of req) {
        bytes+=chunk.length;
        if (bytes<=limit) chunks.push(chunk);
        else chunks=[];
      }
      if (bytes>limit) return respond(413,{error:'Session request exceeds its size limit'});
      const payload=Buffer.concat(chunks);
      if (req.url==='/record') return respond(200,await record(payload));
      const body=JSON.parse(payload.toString('utf8'));
      if (req.url==='/command') return respond(200,await command(body));
      if (req.url==='/instrument-asset') {
        const audio=instrument(body.lane).assets.includes(body.asset) && assets[body.asset];
        if (!audio) return respond(404,{error:'Unknown instrument WAV'});
        res.writeHead(200,{'Content-Type':'audio/wav'});
        return res.end(WAV.encode(audio,{encoding:'float32'}));
      }
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
