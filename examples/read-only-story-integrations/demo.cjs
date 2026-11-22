const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

if (!process.argv[2]) throw new Error('Usage: node demo.cjs <output-directory> [ink-studio-repository]');
const repo = path.resolve(process.argv[3] ?? path.join(__dirname, '../..'));
const folder = path.resolve(process.argv[2]), file = name => path.join(folder, name);
const cli = path.join(repo, 'cli/ink-studio.js'), png = require(path.join(repo, 'cli/png.js'));
const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const rows = name => fs.readFileSync(file(name), 'utf8').trim().split('\n').map(JSON.parse);
const proposal = { id: 'release-lantern', request: 'desk-release' }, line = JSON.stringify(proposal) + '\n';
const width = 320, height = 180, lamp = [169, 82], litPixel = [255, 223, 138, 255];

function harbor(lit) {
  const pixels = Buffer.alloc(width * height * 4);
  const stars = [[24, 42], [47, 28], [81, 31], [120, 51], [150, 22], [191, 38], [211, 22], [235, 46],
    [265, 21], [296, 72], [290, 31], [270, 67], [316, 56], [55, 61], [101, 18]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const water = y > 133, fade = Math.min(y / 130, 1), grain = ((x * 17 + y * 23) % 13) / 12;
    const horizon = 119 - 10 * Math.cos(x / 51) - 6 * Math.cos(x / 15);
    let color = water ? [17 + 10 * grain, 48 + 14 * grain, 61 + 15 * grain] :
      [13 + 28 * fade + grain, 22 + 49 * fade, 48 + 47 * fade];
    if (!water && Math.hypot(x - 252, y - 37) < 12) color = [210, 215, 204];
    if (!water && stars.some(([sx, sy]) => x === sx && y === sy)) color = [158, 181, 199];
    if (y > horizon && y <= 134) color = [33, 59, 75];
    if (water && (y + Math.floor(x / 35)) % 9 === 0 && grain > .3) color = [44, 76, 87];
    if (lit && x > 171 && y < 120) {
      const spread = (x - 168) / 13, distance = Math.abs(y - (82 - (x - 169) * .12));
      const glow = Math.max(0, 1 - distance / spread) * (1 - (x - 165) / 200) * .75;
      color = color.map((value, index) => value + ([255, 191, 106][index] - value) * glow);
    }
    if (lit && water && Math.abs(x - 171) < (y - 131) / 4 && (y % 4) < 2 && grain > .42)
      color = [125 + 68 * grain, 84 + 44 * grain, 56];
    if (x < 210 && y > 147 && y < 160 && x * .11 + y > 154) color = [26, 33, 42];
    const half = 8 + (y - 89) / 13;
    if (y >= 89 && y < 153 && Math.abs(x - 169) < half)
      color = x > 172 ? [103, 88, 92] : y > 110 && y < 125 ? [128, 76, 69] : [178, 159, 142];
    if (x > 164 && x < 171 && y >= 139 && y < 153) color = [42, 39, 49];
    if (x >= 156 && x <= 182 && y >= 84 && y < 90) color = [44, 47, 57];
    if (x >= 161 && x <= 177 && y >= 77 && y < 84)
      color = [161, 168, 175].includes(x) ? [45, 52, 64] : lit ? litPixel : [75, 97, 108];
    if (y >= 68 && y < 78 && Math.abs(x - 169) <= (y - 68) * 1.25) color = [96, 60, 65];
    pixels.set([...color.slice(0, 3).map(Math.round), 255], (y * width + x) * 4);
  }
  return png.encode(width, height, pixels, 4);
}

function assets() {
  const original = name => JSON.parse(fs.readFileSync(path.join(repo, 'examples/world-access', name), 'utf8'));
  const world = original('harbor.world.json'), policy = original('harbor.access.json');
  world.history = { enabled: true };
  world.causality = true;
  policy.interventions['release-lantern'].maxLag = 2;
  save('harbor.world.json', world);
  save('harbor.access.json', policy);
  save('candidate.json', proposal);
  save('timed.input.json', {
    format: 'ink-studio/input-recording', version: 1, events: [
      { time: .2, channel: 'world-intervention', kind: 'pulse', value: proposal }
    ]
  });
  fs.writeFileSync(file('dark.asset.png'), harbor(false));
  fs.writeFileSync(file('lit.asset.png'), harbor(true));
  save('patch.graph.json', {
    format: 'ink-studio/graph-project', version: 1, inputs: { packet: { type: 'liveSnapshot' } },
    assets: { dark: { format: 'png', file: 'dark.asset.png' }, lit: { format: 'png', file: 'lit.asset.png' },
      candidate: { format: 'json', file: 'candidate.json' } },
    nodes: {
      world: { op: 'sim.liveWorld', inputs: { packet: { input: 'packet' } } },
      lamps: { op: 'sim.worldScalar', inputs: { source: { node: 'world' }, options: { query: 'lanterns' } } },
      pulse: { op: 'sim.worldPulse', inputs: { source: { node: 'world' }, options: { kind: 'lantern-lit' } } },
      dark: { op: 'pngAsset', inputs: { name: 'dark' } },
      lit: { op: 'pngAsset', inputs: { name: 'lit' } },
      blend: { op: 'data.record', inputs: { opacity: { node: 'lamps' } } },
      picture: { op: 'raster.blend', inputs: {
        background: { node: 'dark' }, foreground: { node: 'lit' }, options: { node: 'blend' }
      } },
      candidate: { op: 'jsonAsset', inputs: { name: 'candidate' } }
    },
    outputs: { picture: { node: 'picture' }, candidate: { node: 'candidate' }, lit: { node: 'pulse' } }
  });
}

const children = new Set();
function launch(...args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'] });
  const done = once(child, 'close');
  children.add(child);
  done.then(() => children.delete(child), () => children.delete(child));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  return { child, done, async next() {
    const row = await lines.next();
    assert(!row.done, stderr || 'Expected another CLI report');
    return JSON.parse(row.value);
  }, async check() { assert.deepEqual(await done, [0, null], stderr || args.join(' ')); } };
}
function verify(...args) {
  execFileSync(process.execPath, [cli, ...args], { cwd: folder, stdio: ['ignore', 'pipe', 'inherit'] });
}

async function projector(url) {
  const session = await fetch(url + 'session').then(response => response.json());
  const headers = { 'x-ink-session': session.key, 'x-ink-client': 'harbor-demo' };
  let sequence = 0;
  return {
    async frame(isLit, output) {
      for (let i = 0; i < 150; i++) {
        const response = await fetch(url + 'frame?after=' + sequence, { headers });
        if (response.status === 200) {
          sequence = Number(response.headers.get('x-ink-serial'));
          const pixels = Buffer.from(await response.arrayBuffer());
          const offset = (lamp[1] * width + lamp[0]) * 4;
          if (pixels.subarray(offset, offset + 4).equals(Buffer.from(litPixel)) === isLit) {
            fs.writeFileSync(file(output), png.encode(width, height, pixels, 4));
            return Number(response.headers.get('x-ink-frame'));
          }
        } else assert.equal(response.status, 204);
        await delay(18);
      }
      throw new Error('Projector did not display the expected lantern state');
    },
    async attempt() {
      const response = await fetch(url + 'intervene', { method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }, body: line });
      return response.status;
    }
  };
}

async function main(scratch) {
  assets();
  function live(name) {
    return launch('sim', 'live', 'harbor.world.json', '--policy', 'harbor.access.json',
      '--ticks', '16', '--step-ms', '230', '--linger-ms', '150', '--record', name + '.run.json');
  }
  function show(name, ready, frames, principal, ...options) {
    const config = path.join(scratch, name + '.json');
    fs.writeFileSync(config, JSON.stringify({
      format: 'ink-studio/patch-show', version: 1, patch: file('patch.graph.json'), output: 'picture',
      fps: 10, frames, slowMs: 1000, projector: { wait: false }, liveWorld: {
        url: ready.url, token: ready.principals[principal].token, input: 'packet'
      }
    }), { mode: 0o600 });
    return launch('patch', 'show', config, '--report', name + '.report.json', ...options);
  }

  const quietWorld = live('read-only'), quiet = await quietWorld.next();
  assert.equal(quiet.event, 'live-ready');
  const observer = show('observer', quiet, 7, 'west-guide');
  observer.child.stdin.end(line);
  const viewer = await projector((await observer.next()).projector);
  await viewer.frame(false, 'before.png');
  const projectorSubmission = await viewer.attempt();
  assert.equal(projectorSubmission, 404);
  await observer.check();
  assert.equal(read('observer.report.json').interventions, undefined);
  const rehearsal = show('rehearsal', quiet, 7, 'west-guide', '--rehearse', '--intervention-input', 'timed.input.json',
    '--record-interventions', 'rehearsal.ndjson');
  await rehearsal.check();
  assert.deepEqual(read('rehearsal.report.json').interventions.outcomes, { preview: 1 });
  await quietWorld.check();
  assert.equal(read('read-only.run.json').commands.length, 0);

  const world = live('interactive'), authority = await world.next();
  const follower = show('spectator', authority, 20, 'projector');
  const interactive = show('interactive', authority, 20, 'west-guide', '--intervention-input', '-',
    '--record-interventions', 'interactive.ndjson');
  const [spectator, paired] = await Promise.all([follower, interactive].map(async showRun =>
    projector((await showRun.next()).projector)));
  await Promise.all([spectator.frame(false, 'spectator-before.png'), paired.frame(false, 'interactive-before.png')]);
  const scope = { Authorization: 'Bearer ' + authority.principals['west-guide'].token };
  for (let i = 0; i < 50; i++) {
    const state = await fetch(authority.url + 'snapshot', { headers: scope }).then(response => response.json());
    if (state.cursor.tick > 0) break;
    await delay(20);
  }
  interactive.child.stdin.write(line);
  const [amberFrame, spectatorFrame] = await Promise.all([
    paired.frame(true, 'after.png'), spectator.frame(true, 'spectator-after.png')
  ]);
  interactive.child.stdin.end(line);
  await Promise.all([interactive.check(), follower.check()]);
  assert.equal(read('spectator.report.json').interventions, undefined);
  const receipts = rows('interactive.ndjson').filter(row => row.status === 'scheduled');
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts[0].receipt, receipts[1].receipt);
  await world.check();
  const [command] = read('interactive.run.json').commands;
  assert.equal(read('interactive.run.json').commands.length, 1);
  assert.equal(command.id, receipts[0].receipt.command);
  verify('sim', 'verify', 'interactive.run.json', '--out', 'verified.json');
  assert.equal(read('verified.json').status, 'verified');
  verify('story', 'events', 'interactive.run.json', '--format', 'envelopes', '--out', 'committed.json');
  const choice = read('committed.json').events.find(row => row.kind === 'story-branch-chosen');
  assert(choice.causes.some(row => row.id === command.id));
  save('demo-report.json', {
    observer: { projectorSubmission, queuedCommands: 0, report: 'observer.report.json' },
    rehearsal: { queuedCommands: 0, journal: 'rehearsal.ndjson' },
    spectator: { frame: spectatorFrame, report: 'spectator.report.json', projectorFrame: 'spectator-after.png' },
    interactive: { request: proposal, command: command.id, tick: command.tick, amberFrame,
      queuedCommands: 1, receiptCount: 2, verified: 'verified.json', journal: 'interactive.ndjson',
      committedChoice: choice.id, projectorFrame: 'after.png' }
  });
  console.log('The read-only projection and the rehearsal queued zero commands.');
  console.log('The interactive desk logged two submissions of one request, the world committed one choice, and native replay verified it.');
}

fs.mkdirSync(folder, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-harbor-show-'));
main(scratch).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill();
  await Promise.all([...children].map(child => once(child, 'close')));
  fs.rmSync(scratch, { recursive: true, force: true });
});
