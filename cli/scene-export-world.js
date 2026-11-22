/* Native world and take sources share the picture clock used by soundtrack export. */
const fs = require('node:fs');
const path = require('node:path');
const { embed } = require('./data-inputs.js');
const { embedModels } = require('./simulation-model-files.js');
const { embedStoryDocuments } = require('./story-document.js');
const { validateTake, readTakeWorld } = require('./take-document.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function readExportWorld(file, kit) {
  if (!/\.json$/i.test(file)) return;
  const location = path.resolve(file), spec = read(location);
  let source = spec, settings = spec?.takeClock, audio;
  const { KIT: K } = kit, T = K.procedural.takeTime;
  if (spec?.format === 'ink-studio/take') {
    validateTake(spec);
    if (spec.world === undefined) throw new TypeError('Scene export needs a take with a native world');
    settings = spec.clock ?? {};
    source = readTakeWorld(location, spec, kit);
    source.takeClock = settings;
    source.dt ??= K.timeDomains.take(settings).dt;
    audio = spec.audio === undefined ? undefined : path.resolve(path.dirname(location), spec.audio);
  } else {
    if (spec?.format !== K.world.format && spec?.format !== K.world.models.format) return;
    source = embedStoryDocuments(embedModels(spec, location), location);
    if (source.dataInputs !== undefined) source.dataInputs = embed(K.dataInputs, source.dataInputs, location);
  }
  const create = () => K.world.runtime.create(source);
  return {
    fps: settings?.fps, audio, runtime: create,
    capture({ width, height, options, render }) {
      const run = create(), original = run.view(), { dt } = original.world;
      const period = settings?.simulationRate === undefined ? T.period(dt) : T.div(T.read(1), T.read(settings.simulationRate));
      const clock = settings && K.timeDomains.take(settings);
      const cuts = (settings?.cuts ?? []).map(row => row.frame).sort((a, b) => a - b);
      let nextCut = 0;
      return { scene: original.world.id, title: original.world.visual?.name ?? original.world.id,
        duration: run.timeline?.duration ?? 0, timeline: run.timeline, runtime: create,
        sample(time, _lastTime, coordinate) {
          const point = coordinate?.point ?? T.read(time);
          const tick = T.index(T.roundDown(T.div(point, period)));
          const view = run.advance(tick);
          const picture = clock && T.locate(clock, point).frame;
          const sample = clock && clock.at(picture);
          const cut = cuts[nextCut] <= picture;
          while (cuts[nextCut] <= picture) nextCut++;
          const take = sample && T.compare(T.requireFrame(sample).start, point) === 0 ? sample : undefined;
          const world = K.world.visual(kit, view, run.query(), { time, take });
          return render(world, { ...options, w: width, h: height, time, take, renderHistoryKey: run, ...(cut && { resetRenderHistory: true }) });
        }
      };
    }
  };
}

module.exports = { readExportWorld };
