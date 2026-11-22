/* The public player gets anonymous labels and linked excerpts without the edit key. */
module.exports=function ballotPage(test) {
  const manifest=JSON.stringify(test).replace(/</g,'\\u003c');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ink Studio · Four-way listening ballot</title>
<style>
:root { color-scheme: dark; font: 16px/1.5 system-ui, sans-serif; background:#171b20; color:#f0f0ea; }
* { box-sizing:border-box; }
main { max-width:46rem; padding:clamp(1.2rem,5vw,3rem); margin:auto; }
h1 { font-size:clamp(1.8rem,5vw,3rem); letter-spacing:-.04em; line-height:1.1; }
fieldset { border:1px solid #53606a; border-radius:.6rem; padding:1rem; margin:1rem 0; min-width:0; }
legend { font-weight:700; }
p { color:#c9d0d6; }
audio, textarea { width:100%; display:block; margin:.75rem 0; }
button, input, textarea { font:inherit; }
button { border:1px solid #8a9aa6; border-radius:.35rem; padding:.4rem .75rem; cursor:pointer; }
button[aria-pressed="true"], button[type="submit"] { background:#aee4ce; color:#12241d; border-color:#aee4ce; }
:focus-visible { outline:2px solid #aee4ce; outline-offset:.2rem; }
nav, .choices { display:flex; flex-wrap:wrap; gap:.7rem; }
.choices label { min-width:3rem; }
textarea { min-height:4rem; resize:vertical; }
</style>
<main>
<h1>Four-way listening ballot</h1>
<p>Play at the same volume. Select one favorite or mark every take that ties. The letter labels reset for each question.</p>
<form id="review">
<div id="questions"></div>
<label>Listener ID <input id="listener" required maxlength="48" value="listener"></label>
<button type="submit">Download ballot</button>
<p id="status" role="status"></p>
</form>
</main>
<script>
const test=${manifest};
const form=document.getElementById('review'), list=document.getElementById('questions');
const active=[];
const make=(tag,text)=>{ const el=document.createElement(tag); if(text) el.textContent=text; return el; };
for (const question of test.questions) {
  const panel=make('fieldset'), legend=make('legend',question.prompt), player=make('audio'), buttons=make('nav');
  const choices=make('div'), reason=make('textarea'), explanation=make('label','What did you hear?');
  player.controls=true;
  player.preload='metadata';
  choices.className='choices';
  buttons.setAttribute('aria-label','Audition takes');
  let current=test.labels[0], request=0;
  player.src=question.files[current];
  panel.append(legend,buttons,player);
  if (question.sequence.length>1) panel.append(make('p',
    'The call returns at '+(question.sequence[1].firstFrame/test.sampleRate).toFixed(2)+' s in each take.'));
  else panel.append(make('p','Each take includes the lead-in and aftermath.'));
  const controls=[];
  for (const label of test.labels) {
    const button=make('button','Play '+label.toUpperCase());
    button.type='button';
    button.setAttribute('aria-pressed',String(label===current));
    button.addEventListener('click',()=>{
      for (const {player:other} of active) if (other!==player) other.pause();
      if (current!==label) {
        const at=player.ended ? 0 : player.currentTime, change=++request;
        player.addEventListener('loadedmetadata',()=>{
          if (change===request) player.currentTime=Math.min(at,player.duration);
        },{once:true});
        player.src=question.files[label];
        current=label;
        for (const row of controls) row.button.setAttribute('aria-pressed',String(row.label===current));
      }
      player.play().catch(()=>{});
    });
    buttons.append(button);
    const input=make('input'), choice=make('label');
    input.type='checkbox';
    choice.append(input,' '+label.toUpperCase());
    choices.append(choice);
    controls.push({label,input,button});
  }
  player.addEventListener('play',()=>{
    for (const {player:other} of active) if (other!==player) other.pause();
  });
  reason.maxLength=2000;
  explanation.append(reason);
  panel.append(choices,explanation);
  list.append(panel);
  active.push({id:question.id,controls,reason,player});
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  const answers={}, listener=document.getElementById('listener').value.trim(), status=document.getElementById('status');
  if (!/^[a-z][a-z0-9_-]{0,47}$/i.test(listener) || ['constructor','prototype','__proto__'].includes(listener)) {
    status.textContent='Use a listener ID that starts with a letter and contains only letters, numbers, hyphens, or underscores.';
    return;
  }
  for (const row of active) {
    const choices=row.controls.filter(({input})=>input.checked).map(({label})=>label), reason=row.reason.value.trim();
    if (!choices.length && !reason) continue;
    if (!choices.length || !reason) {
      status.textContent='For each question you answer, select a take and write what you heard.';
      return;
    }
    answers[row.id]={choices,reason};
  }
  if (!Object.keys(answers).length) { status.textContent='Answer at least one question.'; return; }
  const data=JSON.stringify({token:test.token,listener,answers},null,2)+'\\n';
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'})), link=make('a');
  link.href=url;
  link.download='performance-ballot.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status.textContent='Ballot downloaded.';
});
</script>
</html>`;
};
