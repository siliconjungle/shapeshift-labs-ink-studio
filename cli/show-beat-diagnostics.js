/* Associate show-clock diagnostics with explicit placements or observed beats. */
const fs = require('node:fs');
const path = require('node:path');

const maxAnchors = 16384, maxObservations = 2048, maxFindingsPerKind = 256, maxLinks = 32;
const frame = n => Number.isSafeInteger(n) && n >= 0;
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const point = (at, details) => ({ fromFrame: at, toFrame: at + 1, ...details });

function reportFile(directory, value, name) {
  if (!text(value) || path.isAbsolute(value) || path.win32.isAbsolute(value))
    throw new TypeError('Show ' + name + ' needs a relative report path');
  const file = path.resolve(directory, value);
  if (fs.statSync(file).size > 128 * 1024 * 1024) throw new RangeError('Show ' + name + ' exceeds 128 MiB');
  return { file, report: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function showRate(T, value) {
  const [numerator, denominator] = String(value).split('/');
  return T.read(denominator === undefined ? Number(numerator) : {
    numerator: BigInt(numerator).toString(), denominator: BigInt(denominator).toString()
  });
}

function authored(W, windows, frames) {
  const { check, record } = W.data;
  check(Array.isArray(windows) && windows.length <= 4096, 'Show needs up to 4096 beat windows');
  return windows.map(row => {
    check(record(row) && Object.keys(row).every(key => ['beatId', 'fromFrame', 'toFrame', 'tick', 'label'].includes(key)) &&
      W.inspectionLinks.parse(row.beatId) && frame(row.fromFrame) && frame(row.toFrame) &&
      row.toFrame > row.fromFrame && row.toFrame <= frames && (row.tick === undefined || frame(row.tick)) &&
      (row.label === undefined || text(row.label)), 'Invalid show beat window');
    return { ...row, alignment: 'window' };
  });
}

function edited(K, report, clock, frames) {
  const W = K.world, { check, id, record } = W.data;
  const rows = report.events ?? [];
  check(Array.isArray(rows) && rows.length <= 100000, 'Invalid clock map event placements');
  const anchors = [];
  for (const row of rows) {
    check(record(row) && record(row.edited) && row.edited.timecode !== undefined && frame(row.edited.frame),
      'Invalid edited show event position');
    if (row.edited.frame >= frames) continue;
    const at = clock.address(row.edited.timecode), beatId = W.inspectionLinks.identify(row.event);
    check(at.frame === row.edited.frame && beatId && (row.beatId === undefined || row.beatId === beatId) &&
      frame(row.event.tick) && id(row.clip), 'Edited show event differs from its beat or exact clock');
    anchors.push(point(at.frame, { beatId, tick: row.event.tick, clip: row.clip,
      ...(id(row.event.kind) && { event: row.event.kind }), alignment: 'edited-event' }));
  }
  return anchors;
}

function presentation(K, report, rate, frames) {
  const W = K.world, T = K.procedural.takeTime, { check, id, record } = W.data;
  const { clock, frames: rows } = report ?? {};
  check(report?.format === 'ink-studio/story-presentation-pack' && report.version === 1 &&
    record(clock) && frame(clock.fromFrame) && frame(clock.toFrame) &&
    Array.isArray(rows) && rows.length <= 36000 && rows.length === clock.toFrame - clock.fromFrame &&
    T.compare(T.read(clock.frameRate), showRate(T, rate)) === 0, 'Presentation report needs the show frame rate and a valid frame window');
  const anchors = [];
  for (let index = 0; index < Math.min(rows.length, frames); index++) {
    const row = rows[index];
    check(record(row) && row.offset === index && row.frame === clock.fromFrame + index &&
      frame(row.tick) && Array.isArray(row.beats) && row.beats.length <= 4096, 'Invalid presentation report frame');
    for (const beat of row.beats) {
      check(record(beat) && W.inspectionLinks.parse(beat.beatId) && frame(beat.tick) && beat.tick <= row.tick,
        'Invalid presentation report beat');
      anchors.push(point(index, { beatId: beat.beatId, tick: beat.tick, sourceFrame: row.frame,
        ...(id(beat.kind) && { event: beat.kind }), ...(text(beat.label) && { label: beat.label }), alignment: 'presentation' }));
      check(anchors.length <= 50000, 'Presentation report exceeds its beat budget');
    }
  }
  return anchors;
}

function cueAnchor(cue) {
  return point(cue.scheduledFrame, { beatId: cue.beatId, ...(cue.tick !== undefined && { tick: cue.tick }),
    ...(cue.clip && { clip: cue.clip }), ...(cue.cue && { cue: cue.cue }), alignment: 'cue' });
}

function collect(config, cues) {
  const planned = config.beatAnchors ?? [];
  const observations = [], findingsByKind = new Map();
  let omittedFindings = 0, omittedObservations = 0, missedCues = 0;
  function issue(kind, details, fromFrame, toFrame, direct) {
    if (kind === 'missed-cue') missedCues++;
    if (!findingsByKind.has(kind)) findingsByKind.set(kind, []);
    const rows = findingsByKind.get(kind);
    if (rows.length >= maxFindingsPerKind) { omittedFindings++; return; }
    rows.push({ kind, ...details, fromFrame, toFrame, ...(direct && { direct }) });
  }
  return {
    issue,
    get missedCues() { return missedCues; },
    observe(at, output, link) {
      if (observations.length >= maxObservations) { omittedObservations++; return; }
      observations.push(point(at, { beatId: link.beatId, ...(link.tick !== undefined && { tick: link.tick }),
        ...(link.kind && { event: link.kind }), output, alignment: 'observed' }));
    },
    finish() {
      const recorded = [...findingsByKind.values()].flat().sort((a, b) =>
        (a.fromFrame ?? Infinity) - (b.fromFrame ?? Infinity));
      if (!recorded.length) return;
      const anchors = [...cues.values()].filter(cue => cue.beatId).map(cueAnchor)
        .concat(planned.slice(0, maxAnchors), observations).sort((a, b) => a.fromFrame - b.fromFrame);
      let limit = 0;
      const ends = anchors.map(row => limit = Math.max(limit, row.toFrame));
      const omittedAnchors = Math.max(0, planned.length - maxAnchors);
      let unattributed = 0, omittedLinks = 0;
      const findings = recorded.map(({ direct, ...row }) => {
        const links = [], seen = new Set();
        function link(anchor) {
          const { fromFrame, toFrame, ...details } = anchor;
          const match = { ...details, frame: Math.max(fromFrame, row.fromFrame), toFrame: Math.min(toFrame, row.toFrame) };
          const key = JSON.stringify(match);
          if (seen.has(key)) return;
          if (links.length >= maxLinks) { omittedLinks++; return; }
          seen.add(key);
          links.push(match);
        }
        if (direct) link(direct);
        else if (row.fromFrame !== undefined) {
          let low = 0, high = ends.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            if (ends[middle] <= row.fromFrame) low = middle + 1;
            else high = middle;
          }
          for (let i = low; i < anchors.length && anchors[i].fromFrame < row.toFrame; i++)
            if (anchors[i].toFrame > row.fromFrame) link(anchors[i]);
        }
        if (!links.length) unattributed++;
        return { ...row, beats: links };
      });
      return { findings, unattributed, missedCues, omittedFindings, omittedObservations, omittedAnchors, omittedLinks };
    }
  };
}

module.exports = { reportFile, showRate, authored, edited, presentation, collect, cueAnchor };
