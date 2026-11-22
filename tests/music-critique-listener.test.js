const {test}=require('node:test'), assert=require('node:assert/strict');
const {listener}=require('..').load().KIT.music.production.critique;
const rate=8000, frames=1600;
const wave=f=>({sampleRate:rate,channels:1,samples:Float32Array.from({length:frames},(_,i)=>.32*Math.sin(f*i/rate*2*Math.PI))});
const clips={low:{audio:wave(220),firstSample:24000},high:{audio:wave(440),firstSample:72000}};
const cases=[
  {id:'pitch',kind:'known',criterion:'pitch',question:'Which has a higher pitch?',left:'low',right:'high',expected:'right'},
  {id:'lower',kind:'known',criterion:'pitch',question:'Which has a lower pitch?',left:'low',right:'high',expected:'left'},
  {id:'rough',kind:'preference',criterion:'tone',question:'Which texture fits the scene?',left:'low',right:'high',votes:['right','right','left']},
  {id:'unclear',kind:'preference',criterion:'tone',question:'Which texture fits the scene?',left:'low',right:'high',votes:['right','left']}
];

test('the listener gets identical-length blinded swaps, identity controls, and no answer key',()=>{
  const settings={id:'calibration',seed:6,cases};
  const pack=listener.pack(clips,settings);
  assert.deepEqual(pack.value,listener.pack(clips,settings).value);
  assert.equal(pack.value.trials.length,12);
  const publicJson=JSON.stringify(pack.value);
  assert.doesNotMatch(publicJson,/"(control|origins|expected|votes|left|right|order)"/);
  const halves=record=>{
    const trial=pack.value.trials.find(row=>row.id===record.id), pcm=pack.audio[record.id].samples;
    return ['A','B'].map(side=>pcm.slice(trial.halves[side].firstSample,trial.halves[side].endSample));
  };
  const [a,b,identity]=pack.key.cases[0].records.map(halves);
  assert.deepEqual(a,[b[1],b[0]]);
  assert.deepEqual(identity[0],identity[1]);
  assert.notDeepEqual(a[0],a[1]);
});

test('calibration grades inverse orders, abstentions, human votes and source-addressed evidence separately',()=>{
  const {key}=listener.pack(clips,{cases});
  const replies=key.cases.flatMap((row,index)=>row.records.flatMap((trial,i)=>{
    if (index===3 && i>0) return [];
    const choice=i===2 ? 'tie' : index===3 ? 'abstain' : trial.order[0]===row.expected ? 'A' : 'B';
    return [{trial:trial.id,choice,...(index===0 && i===0 && {evidence:[
      {side:choice,from:.01,to:.05,observation:'Higher pitch starts here.'},
      {side:'A',from:-1,to:.02,observation:'Outside either clip.'}
    ]})}];
  }));
  const grade=response=>listener.evaluate(key,{token:key.token,model:'Fixture listener',responses:response},{minLabeled:2});
  const result=grade(replies), [pitch,tone]=result.criteria;
  assert.equal(pitch.status,'passed');
  assert.equal(pitch.knownCorrect,2);
  assert.equal(pitch.addressed,1);
  assert.equal(pitch.rejectedAddresses,1);
  assert.equal(tone.status,'insufficient');
  assert.equal(tone.humanLabeled,1);
  assert.equal(tone.humanCorrect,1);
  assert.equal(tone.unlabeled,1);
  assert.equal(tone.abstained,1);
  assert.equal(tone.missing,2);
  assert.deepEqual(result.cases[0].trials[0].evidence[0],{clip:'high',firstSample:72080,endSample:72400,
    sampleRate:rate,observation:'Higher pitch starts here.'});
  const biased=grade(replies.map(({trial})=>({trial,choice:'A'}))).criteria[0];
  assert.equal(biased.status,'failed');
  assert.equal(biased.orderConsistency,0);
  assert.equal(biased.falsePreferences,2);
  const abstained=grade(replies.map(({trial})=>({trial,choice:'abstain'}))).criteria[0];
  assert.equal(abstained.status,'failed');
  assert.equal(abstained.coverage,0);
  assert.throws(()=>listener.evaluate({...key,id:'tampered'},{token:key.token,model:'Fixture',responses:[]}),/token/);
});
