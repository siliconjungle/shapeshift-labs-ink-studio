module.exports=function review(brief,report) {
  const data=JSON.stringify({brief,report}).replace(/</g,'\\u003c');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ink Studio · Production benchmark</title>
<style>
:root { color-scheme:dark; font:16px/1.58 system-ui,sans-serif; background:#131a1c; color:#efeadf; }
* { box-sizing:border-box; }
main { width:min(900px,100% - 36px); margin:6vh auto; }
header { border-top:1px solid #586760; margin-bottom:38px; }
h1,h2 { font-family:Georgia,serif; font-weight:normal; margin:.4em 0; letter-spacing:-.04em; line-height:1.08; }
h1 { font-size:clamp(2.7rem,7vw,4.8rem); } h2 { font-size:clamp(2rem,4vw,3rem); }
h3 { margin-bottom:.3rem; color:#e9d5ad; }
p { color:#b5c2c1; max-width:70ch; } a { color:#a9dec9; }
section { border-top:1px solid #526463; padding:24px 0 32px; }
aside { margin:16px 0; }
article { margin:17px 0; padding:12px 16px; background:#1e292b; border:1px solid #415852; border-radius:7px; }
audio { width:100%; display:block; margin:8px 0; }
button,select,textarea { font:inherit; border:1px solid #658079; border-radius:5px; color:inherit; background:#172422; padding:.4rem .7rem; }
button { cursor:pointer; } button[aria-pressed="true"] { background:#cae5d9;color:#14211d; }
label { display:block;margin:10px 0; }
textarea { display:block;width:100%;margin-top:4px; }
img { display:block; width:min(100%,640px); aspect-ratio:288/176; object-fit:contain; image-rendering:pixelated; filter:brightness(.79) contrast(1.1) saturate(1.22); background:#10171b; }
details { margin:14px 0; }
:focus-visible { outline:2px solid #b7e6d4; outline-offset:2px; }
</style>
<main>
<header><h1>Production benchmark</h1><p>Three pieces, each with a previous print and a revised treatment. A and B are level-matched within each comparison. The briefs and listening references are below.</p></header>
<form id="form"><div id="pieces"></div><button type="submit">Download listening notes</button> <span id="message" role="status"></span></form>
</main>
<script>
const {brief,report}=${data};
const make=(tag,text)=>{const node=document.createElement(tag); if(text) node.textContent=text;return node;};
const link=(text,url)=>{const a=make('a',text);a.href=url;return a;};
const players=[], answers=[];
function syncPicture(audio,block,picture) {
  const image=make('img'); image.alt='Story footage on the revised picture cut';
  block.append(image);
  const stills=new Map();
  for (const file of new Set(picture.frames)) { const preload=new Image();preload.src=file;stills.set(file,preload); }
  let last=-1;
  const show=()=>{
    const frame=Math.min(picture.frames.length-1,Math.floor(audio.currentTime*picture.fps));
    if (frame!==last) {image.src=stills.get(picture.frames[frame]).src;last=frame;}
  };
  const animate=()=>{show();if(!audio.paused) requestAnimationFrame(animate);};
  audio.addEventListener('play',animate);
  for (const event of ['seeked','loadedmetadata','timeupdate']) audio.addEventListener(event,show);
  show();
}
function player(section,id,question,files,picture) {
  const block=make('article'), audio=make('audio'), nav=make('div');
  const order=(crypto.getRandomValues(new Uint8Array(1))[0]%2 ? ['revised','previous'] : ['previous','revised']);
  const buttons=[];
  let chosen=0, request=0;
  audio.controls=true;audio.preload='metadata';audio.src=files[order[0]];
  for (const [index,label] of ['A','B'].entries()) {
    const button=make('button','Play '+label);button.type='button';
    button.setAttribute('aria-pressed',String(chosen===index));
    button.onclick=()=>{
      if (chosen!==index) {
        const time=audio.ended ? 0 : audio.currentTime, token=++request;
        chosen=index;
        audio.addEventListener('loadedmetadata',()=>{
          if (request===token) audio.currentTime=Math.min(audio.duration,time);
        },{once:true});
        audio.src=files[order[index]];
        buttons.forEach((item,i)=>item.setAttribute('aria-pressed',String(i===index)));
      }
      audio.play().catch(()=>{});
    };
    buttons.push(button);nav.append(button,' ');
  }
  if (picture) syncPicture(audio,block,picture);
  audio.addEventListener('play',()=>players.forEach(other=>{if(other!==audio) other.pause();}));
  players.push(audio);
  const reason=make('textarea'), choice=make('select'), prompt=make('label',question), why=make('label','What did you hear?');
  reason.rows=2;reason.maxLength=1000;
  for (const [value,text] of [['','Skip'],['A','A'],['B','B'],['tie','Tie']]) {
    const option=make('option',text);option.value=value;choice.append(option);
  }
  prompt.append(' ',choice);why.append(reason);
  block.append(nav,audio,prompt,why);section.append(block);
  answers.push({id,choice,reason,order});
}
for (const id of ['cue','scene','world']) {
  const section=make('section'), spec=brief[id];
  section.append(make('h2',spec.title),make('p',spec.brief));
  if (id==='world') {
    section.append(link('Play the live world','world/play.html'));
    for (const route of report.world.routes) {
      section.append(make('h3',route.label));
      player(section,route.id,spec.question,{previous:'world/'+route.id+'/previous.wav',revised:'world/'+route.id+'/revised.wav'});
    }
  } else {
    if (id==='cue') section.append(make('p','The opening call begins near 0:01 and returns near 1:01. Listen through the quieter passage before the return.'));
    player(section,id,spec.question,{previous:id+'/previous.wav',revised:id+'/revised.wav'},
      id==='scene' && {fps:report.scene.fps,frames:report.scene.cuts.revised.map(file=>'scene/'+file)});
  }
  const details=make('details');
  details.append(make('summary','Production notes, references, and editable files'),
    make('p',spec.previous),make('p',spec.revision));
  for (const item of spec.references) {
    const row=make('p',item.listenFor+' ');
    row.append(link(item.title,item.url));details.append(row);
  }
  details.append(link('Render report',id+'/report.json'));
  for (const name of report[id].sessions) details.append(' · ',link(name,id+'/'+name));
  if (id==='scene') {
    details.append(' · ',link('Picture reconform report','scene/reconform.json'));
    const original=make('details');
    original.append(make('summary','Play the original picture and mix'));
    original.addEventListener('toggle',()=>{
      if (!original.open || original.querySelector('audio')) return;
      const audio=make('audio');
      audio.controls=true;audio.src='scene/original.print.wav';
      syncPicture(audio,original,{fps:report.scene.fps,frames:report.scene.cuts.original.map(file=>'scene/'+file)});
      audio.addEventListener('play',()=>players.forEach(other=>{if(other!==audio) other.pause();}));
      players.push(audio);original.append(audio);
    });
    details.append(original);
  }
  section.append(details);document.getElementById('pieces').append(section);
}
document.getElementById('form').onsubmit=event=>{
  event.preventDefault();
  const message=document.getElementById('message'), votes=[];
  for (const row of answers) {
    const preference=row.choice.value, reason=row.reason.value.trim();
    if (!preference && !reason) continue;
    if (!preference || !reason) {message.textContent='Choose a take or tie and give a reason for each answered question.';return;}
    votes.push({piece:row.id,preference,reason,labels:{A:row.order[0],B:row.order[1]}});
  }
  if (!votes.length) {message.textContent='Answer at least one question.';return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify({format:'ink-studio/production-benchmark-listening',
    version:1,votes},null,2)+'\\n'],{type:'application/json'}));
  const download=link('',url);download.download='listening-notes.json';download.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  message.textContent='Listening notes downloaded.';
};
</script>
</html>`;
};
