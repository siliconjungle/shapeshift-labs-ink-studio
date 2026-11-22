/* Standalone player for a public listening pack. The label key stays in a separate file. */
module.exports=function listeningPage(test) {
  const manifest=JSON.stringify(test).replace(/</g,'\\u003c');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ink Studio · Blind listening</title>
<style>
:root { color-scheme: dark; --ink:#f2eee6; --muted:#a9b4b4; --line:#3b494b; --accent:#b0e0cb; font:16px/1.55 system-ui,sans-serif; background:#151b1c; color:var(--ink); }
* { box-sizing:border-box; }
main { width:min(100% - 40px,740px); margin:clamp(24px,7vw,80px) auto; }
header { border-top:1px solid var(--line); padding:18px 0 26px; }
small { color:var(--accent); font-weight:650; letter-spacing:.07em; }
h1 { margin:5px 0; font-size:clamp(2rem,8vw,3.7rem); line-height:1.05; font-weight:620; letter-spacing:-.055em; }
p { margin:10px 0 18px; color:var(--muted); }
fieldset { border:0; margin:0; padding:0; }
legend { font-weight:650; }
section { background:#1d2627; padding:clamp(13px,4vw,24px); margin-bottom:18px; border:1px solid var(--line); border-radius:14px; }
audio { display:block; width:100%; margin:14px 0; }
button, select, input, textarea { font:inherit; color:inherit; background:#151b1c; border:1px solid #58696a; border-radius:6px; padding:6px 11px; }
button { cursor:pointer; }
button[aria-pressed="true"], button[type="submit"] { background:var(--accent); color:#162724; font-weight:650; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.actions { display:flex; gap:8px; margin:10px 0; flex-wrap:wrap; }
.grid { display:grid; gap:10px 16px; grid-template-columns:1fr 1fr; }
[hidden] { display:none !important; }
label { display:grid; gap:5px; }
textarea { width:100%; min-height:100px; resize:vertical; margin-bottom:14px; }
.answer { margin-top:15px; }
@media(max-width:500px) { .grid { grid-template-columns:1fr; } }
</style>
<main>
<header>
<small>INK STUDIO</small>
<h1>Blind listening</h1>
<p>Compare the same passage at matched levels. Choose a take for any question you have an opinion on.</p>
</header>
<form id="ballot">
<section>
<label>Pair <select id="pairs"></select></label>
<div class="actions" id="takes"></div>
<audio id="player" controls preload="metadata"></audio>
<p id="windows" hidden></p>
<div id="ratings" class="grid"></div>
</section>
<section>
<div class="grid">
<label>Listener ID <input id="listener" value="listener" pattern="[a-zA-Z][a-zA-Z0-9_\\x2D]{0,47}" maxlength="48" required></label>
<label id="keep">Take to keep <select id="winner"></select></label>
</div>
<label class="answer">What did you hear? <textarea id="reason" required maxlength="2000"></textarea></label>
<button type="submit" id="download">Download listening decision</button>
<p id="status" role="status" aria-live="polite"></p>
</section>
</form>
</main>
<script>
const test = ${manifest};
const names = {groove:'Which has a better groove?',identity:'Which has a clearer identity?',shape:'Which has a stronger shape?',replay:'Which would you play again?'};
const byId = id => document.getElementById(id);
const caps = label => label.toUpperCase();
const state = Object.fromEntries(test.trials.map(trial=>[trial.id,{}]));
const player = byId('player');
let loadedLabel, request = 0;
function option(label,value){ const item=document.createElement('option'); item.textContent=label; item.value=value; return item; }
function switchTo(label, play=false, preserve=true) {
  const time=preserve ? player.currentTime : 0;
  const active=++request;
  const start=()=>{ if(active!==request) return; if(time>0) player.currentTime=Math.min(time,player.duration || time);
    if(play) player.play().catch(()=>{}); };
  if(label!==loadedLabel) {
    player.addEventListener('loadedmetadata', start, {once:true});
    player.src=test.files[label];
    loadedLabel=label;
    if(play) player.play().catch(()=>{});
  } else if(!preserve) player.currentTime=0;
  else if(play) player.play().catch(()=>{});
  for(const button of byId('takes').children) button.setAttribute('aria-pressed',String(button.dataset.label===label));
}
for (const [i,trial] of test.trials.entries()) byId('pairs').append(option((i+1)+' of '+test.trials.length,trial.id));
for (const label of test.labels) byId('winner').append(option('Take '+caps(label),label));
byId('winner').prepend(option('Choose a take',''));
byId('winner').value='';
if(test.sequence) {
  const timing=byId('windows');
  timing.hidden=false;
  timing.textContent='The return begins at '+(test.sequence[1].firstFrame/test.sampleRate).toFixed(2)+' s in both takes.';
}
if(test.question) {
  byId('keep').hidden=true;
  byId('download').textContent='Download ballot';
} else byId('winner').required=true;
function selectPair() {
  const trial=test.trials.find(row=>row.id===byId('pairs').value);
  const controls=byId('takes'), ratings=byId('ratings');
  controls.replaceChildren();
  ratings.replaceChildren();
  for (const label of trial.takes) {
    const button=document.createElement('button');
    button.type='button';
    button.textContent='Play '+caps(label);
    button.dataset.label=label;
    button.addEventListener('click',()=>switchTo(label,true));
    controls.append(button);
  }
  for(const goal of test.criteria) {
    const label=document.createElement('label'), choices=document.createElement('select');
    label.textContent=test.question || names[goal];
    choices.append(option('Skip',''),...trial.takes.map(label=>option('Take '+caps(label),label)),option('Tie','tie'));
    choices.value=state[trial.id][goal] || '';
    choices.addEventListener('change',()=>{ if(choices.value) state[trial.id][goal]=choices.value;
      else delete state[trial.id][goal]; });
    label.append(choices);
    ratings.append(label);
  }
  player.pause();
  switchTo(trial.takes[0],false,false);
}
byId('pairs').addEventListener('change',selectPair);
selectPair();
byId('ballot').addEventListener('submit',event=>{
  event.preventDefault();
  const take=byId('winner').value,reason=byId('reason').value.trim(), listener=byId('listener').value;
  const votes=Object.entries(state).filter(([,choices])=>Object.keys(choices).length)
    .map(([trial,preferences])=>({trial,listener,preferences}));
  if(!reason || (test.question ? !votes.length : !votes.some(row=>Object.values(row.preferences).includes(take)))) {
    byId('status').textContent=test.question ? 'Choose A, B or a tie, and say what you heard.' :
      'Record at least one preference for the take you want to keep, and say why.';
    return;
  }
  const url=URL.createObjectURL(new Blob([JSON.stringify({token:test.token,...(!test.question && {take}),reason,votes},null,2)+'\\n'],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=test.question ? 'listening-ballot.json' : 'listening-decision.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  byId('status').textContent=test.question ? 'Ballot downloaded.' : 'Listening decision downloaded.';
});
</script>
</html>
`;
};
