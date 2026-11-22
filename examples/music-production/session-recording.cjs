/* Make a self-contained session for trying the recording desk. */
const fs=require('node:fs'), path=require('node:path');
const {exportSoundPack}=require('../../cli/music-sound-library.js');
const {json}=require('../../cli/asset-files.js');

const folder=path.resolve(process.argv[2] ?? 'take-room');
fs.mkdirSync(folder,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(exportSoundPack('breath-and-reed',path.join(folder,'reed')), 'utf8'));
const assets=Object.fromEntries(Object.entries(manifest.assets).map(([name,file])=>[name,'reed/'+file]));
const note=(beat,midi,duration,velocity,play)=>({beat,midi,duration,velocity,...(play && {play})});
const clip=(id,notes,mode)=>[{id,beat:0,length:8,...(mode && {mode}),voices:[{id:'line',notes:
  notes.map((row,i)=>({id:'note-'+(i+1),...row}))}]}];
const tempo=112, sampleRate=32000;
const production={
  seed:32, gain:-5,
  arrangement:{
    score:{tempoMap:{tempo},key:{root:'E3',mode:'minor'},harmonies:{home:{root:'E3',quality:'unison'}}},
    sections:[{id:'play',bars:2,harmony:'home'}],
    parts:{reed:{role:'lead'},bass:{role:'bass'},kick:{role:'percussion'},rim:{role:'percussion'}},motifs:{}
  },
  patches:{
    reed:manifest.patches['breathing-reed'],
    bass:{type:'subtractive',saw:.17,pulse:.17,sub:.55,filter:{cutoff:570,resonance:.61},env:{attack:.018,decay:.24,sustain:.49,release:.115}},
    kick:{type:'drum',kind:'kick',tune:43,decay:.35,click:.09},
    rim:{type:'drum',kind:'rim',tune:280,decay:.13,click:.29}
  },
  tracks:{
    reed:{patch:'reed',gain:-3,highpass:115,pan:-.12,send:.21,clips:clip('reed-line',[
      note(.48,64,.54,.64),note(1.47,67,.37,.53),note(1.92,69,1.04,.66,{articulation:'vib'}),
      note(3.56,67,.19,.46),note(4.44,62,.64,.47),note(5.95,64,1.16,.64)
    ])},
    bass:{patch:'bass',gain:-12,highpass:34,clips:clip('bass-line',[
      note(.027,28,.89,.83),note(1.7,35,.42,.59),note(2.55,28,.57,.72),note(4.037,33,1.17,.78),
      note(6.23,35,.66,.77),note(7.52,31,.30,.51)
    ])},
    kick:{patch:'kick',gain:-8,clips:clip('kick-line',[0,2.53,4,6.18,7.53].map(beat=>note(beat,36,.17,.81)),'layer')},
    rim:{patch:'rim',gain:-16,pan:.21,send:.15,clips:clip('rim-line',[1.02,3.02,5.03,7.08].map(beat=>note(beat,38,.13,.73)),'layer')}
  },
  room:{gain:-14,size:.96,decay:.82,damping:.71}
};
const session={format:'ink-studio/music-edit-session',version:1,id:'Take-Room',sampleRate,production};
json(path.join(folder,'session.json'),{session,assets});
json(path.join(folder,'loop.json'),{from:{beat:0},to:{beat:8},preroll:false});
process.stdout.write(folder+'\n');
