const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const directory = path.resolve(process.argv[2] ?? 'studio/out/output-latency-demo');
const cli = path.join(__dirname, '../../cli/ink-studio.js');
fs.mkdirSync(directory, { recursive: true });
const at = name => path.join(directory, name);
const run = (...args) => execFileSync(process.execPath, [cli, 'output-latency', ...args], { cwd: directory, stdio: 'inherit' });
const read = name => JSON.parse(fs.readFileSync(at(name), 'utf8'));
const data = (name, type) => 'data:' + type + ';base64,' + fs.readFileSync(at(name)).toString('base64');

function capture(stimulus, result) {
  // A simulated output chain with 84 ms more speaker delay than display delay.
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', at(stimulus), '-itsoffset', '0.084',
    '-i', at(stimulus), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
    '-movflags', '+faststart', at(result)], { stdio: 'inherit' });
}

function measure(recording, profile, report) {
  const plan = recording.replace(/\.mp4$/, '.plan.json');
  fs.writeFileSync(at(plan), JSON.stringify({
    format: 'ink-studio/output-latency-plan', version: 1, recording, region: [.25, .25, .5, .5],
    output: { id: 'screen-a-front-row', display: 'Simulated display', speakers: 'Simulated speaker',
      playback: 'Local video output with an injected delay' }
  }, null, 2) + '\n');
  run('measure', plan, '--out', profile, '--report', report);
  return read(profile);
}

run('signal', '--out', 'flash-click.mp4');
capture('flash-click.mp4', 'before.mp4');
const initial = measure('before.mp4', 'calibrated-output.json', 'before-report.json');
run('signal', '--profile', 'calibrated-output.json', '--out', 'verification-signal.mp4');
capture('verification-signal.mp4', 'after.mp4');
const verified = measure('after.mp4', 'verification-profile.json', 'after-report.json');

const views = [
  { title: 'Before calibration', profile: initial, clip: 'before.mp4', report: 'before-report.json' },
  { title: 'Verification capture', profile: verified, clip: 'after.mp4', report: 'after-report.json' }
].map(row => ({
  title: row.title, offset: row.profile.calibration.audioMinusPictureMs, trials: row.profile.calibration.trialCount,
  uncertainty: row.profile.calibration.uncertaintyMs, video: data(row.clip, 'video/mp4'),
  report: data(row.report, 'application/json')
}));
const delay = initial.correction.pictureDelayMs.toFixed(1);
fs.writeFileSync(at('index.html'), `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ink Studio output latency calibration</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#10171e;color:#edf4ef}
body{margin:0}main{width:min(1040px,calc(100% - 40px));margin:45px auto 60px}
header{max-width:660px;margin-bottom:28px}h1{font-size:clamp(2rem,5vw,3.45rem);letter-spacing:-.065em;line-height:1.04;margin:12px 0}
p{color:#b6c5c8;line-height:1.55;margin:8px 0}.eyebrow{font:600 .76rem ui-monospace,monospace;letter-spacing:.1em;color:#8ae1c1;text-transform:uppercase}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}button,a{font:inherit;color:inherit}button{cursor:pointer;padding:10px 14px;border:1px solid #40505c;background:#1a242e;border-radius:6px}
button[aria-pressed=true]{color:#10221d;background:#8ae1c1;border-color:#8ae1c1;font-weight:650}button:focus-visible,a:focus-visible{outline:2px solid #ffcf85;outline-offset:3px}
.workspace{display:grid;grid-template-columns:1.6fr 1fr;gap:18px;align-items:start}
video{width:100%;display:block;aspect-ratio:16/9;background:#111821;border:1px solid #36444e;border-radius:9px;box-sizing:border-box}
aside{background:#17222b;border:1px solid #36444e;border-radius:9px;padding:18px}
h2{font-size:1rem;margin:0 0 10px}.reading{font:650 2.6rem ui-monospace,monospace;letter-spacing:-.09em;color:#ffcf85}
.axis{position:relative;background:#101820;border:1px solid #344752;border-radius:5px;margin-top:16px;padding:3px 0}
.track{height:25px;position:relative;border-bottom:1px solid #2d3b45}.track:last-child{border-bottom:0}
.marker{position:absolute;top:4px;bottom:4px;width:3px;background:#8ae1c1}.click{background:#ffcf85}
.track-name{padding-left:7px;font-size:.75rem;color:#b6c5c8;line-height:25px}
.downloads{display:flex;flex-wrap:wrap;gap:16px;margin-top:16px;color:#8ae1c1;font-size:.92rem}
@media(max-width:730px){main{margin-top:27px}.workspace{grid-template-columns:1fr}}
</style>
<main>
<header><div class="eyebrow">Ink Studio · Simulated camera capture</div>
<h1>Output latency calibration</h1>
<p>Play the four flash-click pairs before and after correction. Both captures use the same injected 84 ms speaker delay.</p></header>
<nav aria-label="Compare captures">
<button type="button" aria-pressed="true">Before calibration</button>
<button type="button" aria-pressed="false">Verification capture</button>
</nav>
<div class="workspace">
<div><video controls playsinline preload="metadata" aria-label="Simulated flash and click capture"></video>
<div class="downloads">
<a download="calibrated-output.json" href="${data('calibrated-output.json', 'application/json')}">Download output profile</a>
<a id="report" download="measurement.json">Download measurement</a>
</div></div>
<aside aria-live="polite">
<h2 id="title">Before calibration</h2>
<div class="reading" id="offset"></div>
<p id="uncertainty"></p>
<div class="axis" aria-label="Measured positions of the flash and click on a relative timeline">
<div class="track"><span class="track-name">Flash</span><i class="marker" style="left:42%"></i></div>
<div class="track"><span class="track-name">Click</span><i class="marker click" id="click"></i></div>
</div>
<p>The saved profile delays picture by ${delay} ms. The verification capture replays the adjusted signal through the same simulated setup.</p>
</aside>
</div>
</main>
<script>
const views = ${JSON.stringify(views)};
const video = document.querySelector('video'), buttons = [...document.querySelectorAll('button')];
function select(index) {
  const row = views[index], offset = row.offset;
  video.src = row.video;
  buttons.forEach((button, slot) => button.setAttribute('aria-pressed', String(index === slot)));
  document.querySelector('#title').textContent = row.title;
  document.querySelector('#offset').textContent = (offset > 0 ? '+' : '') + offset.toFixed(1) + ' ms';
  document.querySelector('#uncertainty').textContent = 'Audio minus picture · ±' +
    row.uncertainty.toFixed(1) + ' ms · ' + row.trials + ' trials';
  document.querySelector('#click').style.left = (42 + offset * .43) + '%';
  document.querySelector('#report').href = row.report;
}
buttons.forEach((button, index) => button.addEventListener('click', () => select(index)));
select(0);
</script>
</html>
`);
console.log('wrote', at('index.html'));
