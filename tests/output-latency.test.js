const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const cli = path.join(__dirname, '../cli/ink-studio.js');
const available = ['ffmpeg', 'ffprobe'].every(exe => spawnSync(exe, ['-version']).status === 0);
const output = { id: 'screen-a', display: 'Display A', speakers: 'Speaker A', playback: 'Local player' };

function workflow(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-output-latency-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  function execute(exe, ...args) {
    const result = spawnSync(exe, args, { cwd, encoding: 'utf8', timeout: 30000 });
    if (result.error) throw result.error;
    return result;
  }
  function command(...args) {
    return execute(process.execPath, cli, 'output-latency', ...args);
  }
  function signal(file, profile) {
    const result = command('signal', '--out', file, ...(profile ? ['--profile', profile] : []));
    assert.equal(result.status, 0, result.stderr);
  }
  function capture(file, source, pictureDelay, audioDelay) {
    const result = execute('ffmpeg', '-nostdin', '-v', 'error', '-itsoffset', String(pictureDelay), '-i', source,
      '-itsoffset', String(audioDelay), '-i', source, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
      '-c:a', 'pcm_s16le', file);
    assert.equal(result.status, 0, result.stderr);
  }
  function plan(recording, settings = {}) {
    fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify({
      format: 'ink-studio/output-latency-plan', version: 1, recording, output, region: [.25, .25, .5, .5], ...settings
    }));
  }
  const read = file => JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8'));
  return { command, signal, capture, plan, read, execute };
}

test('measures the two tracks on the same clock, saves the faster-path delay and verifies residual offset',
  { skip: !available }, t => {
    const { command, signal, capture, plan, read } = workflow(t);
    signal('signal.mp4');
    capture('late.mov', 'signal.mp4', 0, .084);
    plan('late.mov');
    const result = command('measure', 'plan.json', '--out', 'profile.json', '--report', 'report.json');
    assert.equal(result.status, 0, result.stderr);
    const profile = read('profile.json'), report = read('report.json');
    assert.deepEqual(profile.output, output);
    assert.equal(profile.calibration.trialCount, 4);
    assert(Math.abs(profile.calibration.audioMinusPictureMs - 84) <= profile.calibration.uncertaintyMs + .25);
    assert.equal(profile.correction.pictureDelayMs, profile.calibration.audioMinusPictureMs);
    assert.equal(profile.correction.audioDelayMs, 0);
    assert(report.audioStartSeconds > .08);
    assert(report.trials.every(({ flash, click }) =>
      flash.beforeFrame + 1 === flash.frame && flash.fromSeconds < flash.seconds &&
      flash.seconds < flash.toSeconds && Number.isSafeInteger(click.hit.sample)));

    signal('corrected.mp4', 'profile.json');
    capture('verification.mov', 'corrected.mp4', 0, .084);
    plan('verification.mov', { window: [.4, 5] });
    const check = command('measure', 'plan.json', '--out', 'verification.json');
    assert.equal(check.status, 0, check.stderr);
    const verification = read('verification.json');
    assert(Math.abs(verification.calibration.audioMinusPictureMs) < 10);
    assert.deepEqual(verification.correction, { audioDelayMs: 0, pictureDelayMs: 0 });
  });

test('measures an early click and preserves the saved profile when the camera crop contains no flash',
  { skip: !available }, t => {
    const { command, signal, capture, plan, read } = workflow(t);
    signal('signal.mp4');
    capture('early.mov', 'signal.mp4', .092, 0);
    plan('early.mov', { recorderBiasMs: 2, channel: 0 });
    const measured = command('measure', 'plan.json', '--out', 'profile.json', '--report', 'report.json');
    assert.equal(measured.status, 0, measured.stderr);
    const profile = read('profile.json'), report = read('report.json');
    assert(profile.correction.audioDelayMs > 85 && profile.correction.audioDelayMs < 96);
    assert.equal(profile.correction.pictureDelayMs, 0);
    assert.equal(report.recorderBiasMs, 2);
    assert(Math.abs(report.audioMinusPictureMs - (report.detectedMedianMs - 2)) < .001);
    assert(report.videoStartSeconds > .08);

    plan('early.mov', { region: [.01, .01, .04, .04] });
    const unresolved = command('measure', 'plan.json', '--out', 'profile.json', '--report', 'failed.json');
    assert.equal(unresolved.status, 2, unresolved.stderr);
    const failed = read('failed.json');
    assert.equal(failed.reason, 'flash-contrast-too-low');
    assert.equal(failed.correction, null);
    assert.deepEqual(read('profile.json'), profile);
  });

test('uses recorded timestamps through dropped frames in a variable-frame-rate capture',
  { skip: !available }, t => {
    const { command, signal, plan, read, execute } = workflow(t);
    signal('signal.mp4');
    const vfr = execute('ffmpeg', '-nostdin', '-v', 'error', '-i', 'signal.mp4', '-itsoffset', '0.060',
      '-i', 'signal.mp4', '-map', '0:v:0', '-map', '1:a:0', '-vf', 'select=not(eq(mod(n,11),10))'.replaceAll(',', '\\,'),
      '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', 'vfr.mov');
    assert.equal(vfr.status, 0, vfr.stderr);
    plan('vfr.mov');
    const result = command('measure', 'plan.json', '--out', 'profile.json', '--report', 'report.json');
    assert.equal(result.status, 0, result.stderr);
    const { calibration } = read('profile.json'), report = read('report.json');
    assert(Math.abs(calibration.audioMinusPictureMs - 60) <= calibration.uncertaintyMs + .25);
    assert(report.trials.some(({ flash }) => flash.halfFrameMs > 8));
  });
