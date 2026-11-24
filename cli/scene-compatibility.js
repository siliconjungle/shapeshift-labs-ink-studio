const path = require('node:path');
const { json } = require('./asset-files.js');

const suffix = '.compatibility.json';

function collect() {
  const counts = { sequence: 0, still: 0 };
  const found = new Map();

  function add(report, product, time, index) {
    if (!report) return;
    counts[product]++;
    for (const issue of report.issues) {
      const { detail, ...description } = issue;
      if (!found.has(issue.code)) found.set(issue.code, { ...description, ...(detail && { firstDetail: detail }) });
      const row = found.get(issue.code);
      if (product === 'still') row.still = { time, ...(detail && { detail }) };
      else {
        row.sequence ??= { count: 0, first: { frame: index, time } };
        row.sequence.count++;
        row.sequence.last = { frame: index, time };
      }
    }
  }

  return {
    sequence: (report, time, index) => add(report, 'sequence', time, index),
    still: (report, time) => add(report, 'still', time),
    report() {
      if (!counts.sequence && !counts.still) return undefined;
      const issues = Array.from(found.values()).sort((a, b) => a.code.localeCompare(b.code));
      return { version: 1, status: issues.length ? 'differences' : 'no-known-differences', samples: { ...counts }, issues };
    }
  };
}

function warn(report) {
  for (const issue of report?.issues ?? []) {
    const frames = issue.sequence;
    const occurrence = frames ? ' Seen on ' + frames.count + ' of ' + report.samples.sequence +
      ' frames, first at ' + Number(frames.first.time.toFixed(6)) + 's.' : '';
    console.warn('WebGL compatibility [' + issue.code + '] ' + issue.webgl + ' ' + issue.action + occurrence);
  }
}

function sidecar(output, input, ...otherOutputs) {
  const file = path.resolve(output.replace(/\.(?:a?png)$/i, '') + suffix);
  if ([input, output, ...otherOutputs].some(name => name && path.resolve(name) === file))
    throw new RangeError('Choose a preview output with a separate compatibility report path');
  return file;
}

function preview(report, file) {
  warn(report);
  if (file) json(file, report);
}

module.exports = { collect, warn, sidecar, preview, suffix };
