const fs = require('node:fs');
const path = require('node:path');
const { readProjectBundle } = require('./project-bundle.js');
const { readRecording } = require('./story-exchange.js');
const { resolveCheckpoint } = require('./checkpoint-file.js');
const { graphOutputs } = require('./graph-outputs.js');
const Fixture = require('./simulation-fixture.js');

const usage = 'story effects <recording|checkpoint|fixture|events|run-bundle> <plan.json> --out effects.json';

function read(file, limit) {
  if (fs.statSync(file).size > limit * 1024 * 1024) throw new RangeError('Event visual effects input exceeds its byte budget');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function command(file, planFile, rest, opt, library) {
  if (!file || !planFile || rest.length || Object.keys(opt).some(key => key !== 'out') ||
    typeof opt.out !== 'string' || !opt.out.trim()) throw new TypeError('Use ' + usage);
  const { world: W, authoring: { projectBundles } } = library().KIT, api = W.eventVisualEffects;
  const inputs = new Set([file, planFile]);
  const plan = read(planFile, 8), document = read(file, 128);
  let source = resolveCheckpoint(path.resolve(file), document, { onBlock: entry => inputs.add(entry) });
  if (source?.format === projectBundles.format && source.version === projectBundles.storyVersion) {
    const project = readProjectBundle(file);
    if (!project.storyEvents) throw new TypeError('Use a recorded story run bundle for visual effects');
    source = readRecording(project) ?? project.storyEvents();
  }
  if (source?.format === Fixture.format) source = W.storyEvents.envelopes(Fixture.eventRecording(W, source), {
    stream: source.checkpoint.eventStream, simulationRate: source.checkpoint.world.takeClock?.simulationRate
  });
  const sheet = source?.format === W.runtime.runFormat ? await api.replay(source, plan) : api.project(source, plan);
  const destination = path.resolve(opt.out);
  graphOutputs([...inputs]).write(path.dirname(destination), [{ file: path.basename(destination), document: sheet }]);
}

const readSheet = file => read(file, 32);
module.exports = { command, usage, readSheet };
