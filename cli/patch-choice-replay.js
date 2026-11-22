/* Verify a choice journal against a native run and the branch events it reproduces. */
const fs = require('node:fs');
const path = require('node:path');
const { graphOutputs } = require('./graph-outputs.js');
const { readNativeRun } = require('./story-audio.js');
const { channel, isProposal } = require('./patch-interventions.js');

const usage = 'ink-studio patch choices <journal.ndjson> <recording|run-bundle> [--out report.json] [--track input.json]';
const decision = 'world/story-choose';
const statuses = ['scheduled', 'preview', 'frame-failed', 'no-cursor', 'busy', 'rejected', 'unconfirmed', 'invalid-input'];

function readJournal(K, file) {
  if (fs.statSync(file).size > 16 * 1024 * 1024) throw new RangeError('Choice journal exceeds 16 MiB');
  const parts = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  if (parts.length > 8200) throw new RangeError('Choice journal exceeds its row budget');
  const [header, ...rows] = parts.map(line => JSON.parse(line));
  const { world: W } = K, { check, id, record } = W.data;
  check(header?.format === 'ink-studio/patch-intervention-journal' && header.version === 1 &&
    ['submit', 'preview'].includes(header.mode), 'Expected a version 1 patch intervention journal');
  const proposals = new Map(), outcomes = new Map();
  for (const row of rows) {
    check(record(row), 'Invalid choice journal row');
    if (row.kind === 'not-reached' || row.kind === 'input-limit') continue;
    const { index, frame, input, after, receipt } = row;
    check(Number.isSafeInteger(index) && index >= 1 && index <= 4096, 'Invalid choice journal index');
    if (row.kind === 'proposal') {
      check(!proposals.has(index) && !outcomes.has(index) && Number.isSafeInteger(frame) && frame >= 0 &&
        input?.channel === channel && input.kind === 'pulse' && Number.isFinite(input.time) && input.time >= 0 &&
        isProposal(W, input.value) && (after === null || W.liveSnapshots.validCursor(after)), 'Invalid choice proposal');
      proposals.set(index, row);
    } else {
      check(row.kind === 'outcome' && !outcomes.has(index) && statuses.includes(row.status) &&
        (proposals.has(index) === (row.status !== 'invalid-input')), 'Invalid choice outcome');
      if (row.status === 'scheduled') check(header.mode === 'submit' && proposals.get(index).after && row.httpStatus === 202 &&
        id(receipt?.command) && Number.isSafeInteger(receipt.tick) && receipt.tick > 0 &&
        receipt.tick <= W.runtime.maxTick, 'Invalid choice scheduling receipt');
      outcomes.set(index, row);
    }
  }
  return { mode: header.mode, rows: [...proposals].map(([index, row]) => ({ ...row, outcome: outcomes.get(index) })) };
}

async function replay(K, journal, run) {
  const W = K.world, commands = new Map(run.commands.map(command => [command.id, command]));
  const wanted = new Map(), decisions = new Map();
  const choices = journal.rows.map(row => {
    const { index, frame, input, after, device, outcome } = row;
    const entry = { index, frame, input, after, ...(device && { device }),
      status: outcome?.status ?? 'unconfirmed', ...(outcome?.httpStatus && { httpStatus: outcome.httpStatus }) };
    if (outcome?.status !== 'scheduled') return entry;
    entry.receipt = outcome.receipt;
    const { command: id, tick } = outcome.receipt, command = commands.get(id);
    if (command?.tick !== tick) return { ...entry, status: 'command-missing' };
    if (command.action !== decision) return { ...entry, status: 'not-a-choice' };
    if (tick > run.end.tick) return { ...entry, status: 'pending' };
    wanted.set(id, command);
    const { document, story, stage, visit, branch } = command.args;
    return { ...entry, status: 'commit-missing', choice: { story: document + '/' + story, stage, visit, branch } };
  });
  const verification = await W.runtime.verifyAsync(run, { onTick(frame) {
    for (const row of frame.events) {
      if (!['story-branch-chosen', 'story-transition', 'story-progress-rejected'].includes(row.kind)) continue;
      const event = W.committedEvents.read(row, frame.world.id, frame.eventStream);
      const ids = new Set(event.causes.filter(cause => cause.type === 'command' && wanted.has(cause.id)).map(cause => cause.id));
      for (const id of ids) {
        const command = wanted.get(id), { document, story, stage, visit, branch } = command.args;
        if (event.tick !== command.tick || event.story !== document + '/' + story ||
            event.stage !== stage || event.visit !== visit) continue;
        const committed = decisions.get(id) ?? {};
        const beatId = W.inspectionLinks.identify(event);
        if (event.kind === 'story-branch-chosen' && event.payload.branch === branch) {
          committed.beatId = beatId;
          committed.target = event.payload.target;
        }
        if (event.kind === 'story-transition' && event.payload.outcome !== undefined)
          committed.ending = { outcome: event.payload.outcome, status: event.payload.to, beatId };
        if (event.kind === 'story-progress-rejected') committed.rejection = { reason: event.payload.reason, beatId };
        decisions.set(id, committed);
      }
    }
  } });
  if (verification.status === 'verified') for (const row of choices) {
    if (row.status !== 'commit-missing') continue;
    const committed = decisions.get(row.receipt.command);
    if (committed?.beatId) Object.assign(row, committed, { status: 'committed', tick: row.receipt.tick });
    else if (committed?.rejection) Object.assign(row, { ...committed, status: 'choice-rejected', tick: row.receipt.tick });
  }
  const issues = choices.filter(row => ['command-missing', 'not-a-choice', 'pending', 'commit-missing', 'unconfirmed'].includes(row.status));
  return { format: 'ink-studio/installation-choice-replay', version: 1, mode: journal.mode,
    passed: verification.status === 'verified' && !issues.length, verification, choices };
}

async function command(journalFile, runFile, opt, { kit }, print) {
  if ([opt.out, opt.track].some(value => value !== undefined && !value.trim()) ||
      opt.out && opt.track && path.resolve(opt.out) === path.resolve(opt.track)) throw new TypeError(usage);
  const inputs = new Set([journalFile, runFile]);
  const journal = readJournal(kit.KIT, journalFile);
  const recording = readNativeRun(runFile, kit, file => inputs.add(file));
  const report = await replay(kit.KIT, journal, recording);
  const files = [];
  if (opt.out) files.push({ file: opt.out, document: report });
  if (opt.track && report.passed) {
    const used = new Set(), events = [];
    for (const row of report.choices) {
      if (row.status !== 'committed' || used.has(row.receipt.command)) continue;
      used.add(row.receipt.command);
      events.push(row.input);
    }
    files.push({ file: opt.track, document: kit.KIT.procedural.mediaGraph.recording({
      format: 'ink-studio/input-recording', version: 1, events
    }) });
  }
  if (files.length) graphOutputs([...inputs]).write(process.cwd(), files);
  if (!opt.out) await print(report);
  if (!report.passed) process.exitCode = 2;
}

module.exports = { command, usage };
