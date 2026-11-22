const fs=require('node:fs');
const path=require('node:path');
const {readCheckpoint}=require('./checkpoint-file.js');
const {json}=require('./asset-files.js');
const Fixture=require('./simulation-fixture.js');
const {graphOutputs}=require('./graph-outputs.js');

function command(file,options,{kit}={}) {
  const {format='report'}=options;
  if (!['report','timeline'].includes(format)||Object.keys(options).some(key=>key!=='out'&&key!=='format')||options.out!==undefined&&
      (typeof options.out!=='string'||!options.out.trim()))
    throw new TypeError('Use take map <clock-map.json> [--format report|timeline] [--out file.json]');
  const {KIT:K}=kit??require('../index.js').load(), W=K.world;
  const full=path.resolve(file), root=path.dirname(full), deps=[full];
  const plan=JSON.parse(fs.readFileSync(full,'utf8'));
  function linked(ref) {
    if(typeof ref.file!=='string'||!ref.file.trim()||Object.keys(ref).length!==1||
        path.isAbsolute(ref.file)||path.win32.isAbsolute(ref.file))
      throw new TypeError('Clock map links need a relative file path');
    const input=path.resolve(root,ref.file);
    deps.push(input);
    return readCheckpoint(input,{onBlock:block=>deps.push(block)});
  }
  if(W.data.record(plan?.sources)) for(const row of Object.values(plan.sources)) {
    if(!W.data.record(row)) continue;
    if(W.data.own(row.words,'file')) row.words=linked(row.words);
    if(W.data.own(row.events,'file')) {
      const value=linked(row.events);
      const isFixture=value?.format===Fixture.format;
      const original=isFixture?value.checkpoint:value?.end??value;
      const known=original?.world?.takeClock;
      if(known&&W.data.record(row.clock??{})) {
        const rates=Object.fromEntries(['fps','simulationRate','sampleRate']
          .filter(name=>known[name]!==undefined).map(name=>[name,known[name]]));
        row.clock={...rates,...row.clock};
      }
      row.events=value?.format===W.storyEvents.envelopeFormat?value:
        W.storyEvents.envelopes(isFixture?Fixture.eventRecording(W,value):value,
          {stream:isFixture?original.eventStream:undefined});
    }
  }
  const report=W.clockMapping.map(plan), result=format==='timeline'?W.clockMapping.timeline(report):report;
  if(options.out) {
    const output=path.resolve(options.out);
    graphOutputs(deps).protect(fs.statSync(output,{throwIfNoEntry:false}));
    json(output,result);
  } else process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports={command};
