const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { propose } = require('./live-world.js');

const channel = 'world-intervention';
const maxInputs = 4096, maxPending = 8, maxLine = 4096;
const usage = 'Use --intervention-input <recording.json|-> with liveWorld and --record-interventions <journal.ndjson>';

function settings(opt, liveWorld, reportFile) {
  const source = opt['intervention-input'], output = opt['record-interventions'];
  if (source === undefined && output === undefined) return;
  if (!source?.trim() || !output?.trim() || output === '-' || !liveWorld) throw new TypeError(usage);
  const file = path.resolve(output);
  if (file === reportFile) throw new TypeError('The intervention journal and show report need separate files');
  return { source: source === '-' ? source : path.resolve(source), file };
}

function isProposal(W, value) {
  return W.data.record(value) && Object.keys(value).length === 2 && W.data.id(value.id) && W.data.id(value.request);
}

function readSource(K, file) {
  if (fs.statSync(file).size > 2 * 1024 * 1024) throw new RangeError('Intervention input exceeds 2 MiB');
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document?.format !== 'ink-studio/input-recording' || !Array.isArray(document.events) ||
      document.events.length > maxInputs) throw new TypeError('Expected a version 1 intervention input recording');
  const source = K.procedural.mediaGraph.recording(document);
  if (Object.keys(source.initial).length || source.events.some(event =>
    event.channel !== channel || event.kind !== 'pulse' || !isProposal(K.world, event.value)))
    throw new TypeError('Intervention inputs need world-intervention pulses with only id and request');
  return source.events;
}

function open(K, { source, file }, liveWorld, { fps, rehearse, report, stdin = process.stdin }) {
  const replay = source === '-' ? null : readSource(K, source);
  const recorder = K.procedural.mediaGraph.recorder();
  const mode = rehearse ? 'preview' : 'submit';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const journal = fs.openSync(file, 'wx', 0o600), pending = new Set();
  let frame, after, passed, reader, failure, observed = 0, next = 0, stopped = false;
  const append = row => {
    fs.writeFileSync(journal, JSON.stringify(row) + '\n');
    fs.fsyncSync(journal);
  };
  try { append({ format: 'ink-studio/patch-intervention-journal', version: 1, mode }); }
  catch (error) { fs.closeSync(journal); throw error; }

  function outcome(index, result) {
    append({ kind: 'outcome', index, ...result });
    report.intervention(result.status);
  }

  function submit(input) {
    const index = ++observed, cursor = after;
    append({ kind: 'proposal', index, frame, after: cursor, input });
    if (rehearse) return outcome(index, { status: 'preview' });
    if (!passed) return outcome(index, { status: 'frame-failed' });
    if (!cursor) return outcome(index, { status: 'no-cursor' });
    if (pending.size >= maxPending) return outcome(index, { status: 'busy' });
    const job = propose(K.world, liveWorld, { ...input.value, after: cursor })
      .then(result => outcome(index, result))
      .catch(error => { failure ??= error; })
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  function line(text) {
    if (failure || stopped || !text.trim()) return;
    try {
      if (observed >= maxInputs) {
        append({ kind: 'input-limit', limit: maxInputs });
        report.intervention('input-limit');
        stop();
        return;
      }
      let value;
      if (Buffer.byteLength(text) <= maxLine) {
        try { value = JSON.parse(text); } catch { /* Record the malformed line without its contents. */ }
      }
      if (!isProposal(K.world, value)) return outcome(++observed, { status: 'invalid-input' });
      submit(recorder.append({ time: frame / fps, channel, kind: 'pulse', value }));
    } catch (error) { failure ??= error; }
  }

  function stop() {
    stopped = true;
    reader?.close();
    if (reader) stdin.pause();
  }

  return {
    mode,
    observe(index, cursor, ok) {
      if (failure) throw failure;
      if (stopped) return;
      frame = index;
      after = cursor;
      passed = ok;
      if (replay) {
        const now = frame / fps;
        const boundary = now + 8 * Number.EPSILON * Math.max(1, now);
        while (next < replay.length && replay[next].time <= boundary) submit(replay[next++]);
      } else if (!reader) {
        reader = createInterface({ input: stdin, terminal: false, crlfDelay: Infinity });
        reader.on('line', line);
        reader.on('error', error => { failure ??= error; });
      }
    },
    stop,
    async close() {
      stop();
      try {
        await Promise.all(pending);
        if (failure) throw failure;
        if (replay && next < replay.length) {
          const count = replay.length - next;
          append({ kind: 'not-reached', count });
          report.intervention('not-reached', count);
        }
      } finally { fs.closeSync(journal); }
    }
  };
}

module.exports = { settings, open };
