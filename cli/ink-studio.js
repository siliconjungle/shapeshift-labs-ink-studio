#!/usr/bin/env node
// ink-studio: look at, measure and check a diorama without opening a browser.   ink-studio help
// Run inside a project that has an ink-studio.config.js ({ load: () => its built module, out, snaps }), or alone, where it shows the library's own demos.
const fs = require('fs'),
  path = require('path'),
  R = require('./render.js'),
  PNG = require('./png.js'),
  ArtDirection = require('../src/art-direction.js');
const CWD = process.cwd();
let cfg = {};
try {
  if (process.env.INK_STUDIO_PORTABLE_SHOT !== '1') cfg = require(path.join(CWD, 'ink-studio.config.js'));
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND' || !/ink-studio\.config/.test(e.message)) throw e;
}
const OUT = path.resolve(CWD, cfg.out || 'studio/out'),
  SNAPS = path.resolve(CWD, cfg.snaps || 'studio/snaps');
const argv = process.argv.slice(2),
  cmd = argv[0] || 'help',
  pos = [],
  opt = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2),
      v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) opt[k] = true;
    else {
      opt[k] = v;
      i++;
    }
  } else pos.push(a);
}
const Shot = require('./shot-recipes.js');
let shot, shotReplay, shotRender;
const outputFile = name => opt.out ? path.resolve(opt.out) : path.join(OUT,name);
const num = (k, d) => (opt[k] === undefined ? d : +opt[k]),
  list = (k, d) => (opt[k] === undefined ? d : String(opt[k]).split(',').map(Number));
let A = null;
const importedAssets = new Map();
const gaussianFile = file => /\.(ply|spz|gsz)$/i.test(file);
const gaussianScenes = new Map();
const lib = () => A || (A = cfg.load ? cfg.load() : require('../index.js').load());
// a diorama by its id, or a file in lab/ that exports (kit) => ({ id, name, seed, build })
/* a mesh file is a diorama too: fitted to --size, coloured from its own materials, baked and looked at like the rest */
function meshScene(file) {
  const kit = lib(),
    K = kit.KIT,
    raw = require('../index.js').readMesh(path.resolve(file));
  return {
    id: path.basename(file).replace(/\W+/g, '-'),
    name: path.basename(file),
    seed: 1,
    build(seed) {
      const size = num('size', 6);
      const asset = importedAssets.get(path.resolve(file));
      if (asset) {
        const world = K.authoring.assetSurfaces.world(asset, {
          size, res: num('res', size / 70), turn: num('spin', 0), up: opt.up,
          hues: num('hues', 10), shades: num('shades', 5), geometry: opt.geometry,
          cells: num('cells', 64), thick: opt.thick === undefined ? undefined : +opt.thick,
          resolution: opt.resolution === undefined ? undefined : +opt.resolution
        });
        return world;
      }
      const mesh = K.mesh.fit(raw, { size, up: opt.up, turn: num('spin', 0) }),
        look = K.mesh.look(mesh, { hues: num('hues', 6), shades: num('shades', 4) }),
        B = kit.makeBuilder(seed, look.pal),
        S = K.sculpt(kit.makeSculpt(B));
      const sol = S.mesh(mesh, look, {
        res: num('res', size / 70),
        cells: num('cells', 64),
        thick: opt.thick === undefined ? undefined : +opt.thick
      });
      S.bake();
      const b = K.mesh.box(mesh);
      return B.finish({
        cam: { target: [0, (b.lo[1] + b.hi[1]) / 2, 0], dist: size * 2.6, pitch: 0.2, yaw: 0.5, sway: 0.3 },
        detail: 14,
        palName: 'Mesh',
        dither: 0.25,
        radius: size * 1.2,
        mesh: Object.assign(K.mesh.info(raw), { hues: look.ramps.length, sheet: sol.field.open, cell: sol.field.h })
      });
    }
  };
}
/* a diorama written as data (see lab/data-shrine.json). --style puts it in another style; meshes it names are looked for beside the file */
function dataScene(file, override, { installedPacks = false } = {}) {
  const K = lib().KIT,
    source = override ?? JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (source?.format === K.curveSplats.format)
    return { id: source.id, name: source.name ?? source.id, seed: source.seed, build: seed => K.curveSplats.world({
      ...source, seed: seed ?? source.seed
    }) };
  const bundles = K.authoring.projectBundles,
    project = bundles && source?.format === bundles.format ? bundles.open(source) : undefined,
    spec = project ? project.scene() : { ...source },
    dir = path.dirname(path.resolve(file));
  if (!project && spec.dataInputs !== undefined)
    spec.dataInputs = require('./data-inputs.js').embed(K.dataInputs, spec.dataInputs, file, shot?.dependency);
  if (opt.style) spec.style = opt.style;
  const area = areaLightsOption();
  if (Array.isArray(area)) spec.finish = { ...spec.finish, areaLights:area };
  const shotLights = shotLightingOption();
  if (shotLights !== undefined && shotLights !== true) spec.finish = { ...spec.finish, shotLighting:shotLights };
  if (opt['shadow-art'] !== undefined)
    spec.finish = { ...spec.finish, look: { ...K.diorama.sceneLook(spec), shadowArt: shadowArtOption() } };
  if (!installedPacks && opt['asset-pack'] !== undefined)
    spec.assetPacks = require('./asset-pack.js').install(K.authoring.assetPacks, spec.assetPacks, opt['asset-pack']);
  const preset = opt['environment-preset'];
  if (preset !== undefined) {
    if (typeof preset !== 'string') die('--environment-preset expects a pack/preset ID or off');
    spec.environmentPreset = preset === 'off' ? false : preset;
  }
  let assets = {}, prefabs, expanded, problems, resolveSpriteAtlas;
  try {
    if (project) {
      const bindings = project.resolve(spec);
      ({ assets, prefabs, resolveSpriteAtlas } = bindings.env);
      problems = bindings.problems;
    } else if (spec.prefabLibrary !== undefined) {
      if (typeof spec.prefabLibrary !== 'string' || !spec.prefabLibrary.length) throw new TypeError('Expected a prefabLibrary file path');
      const library = path.resolve(dir, spec.prefabLibrary);
      prefabs = JSON.parse(fs.readFileSync(library, 'utf8'));
      for (const definition of Object.values(prefabs ?? {})) {
        for (const solid of K.diorama.solids({ solids: Object.values(definition?.solids ?? {}) })) {
          if (solid.kind === 'mesh' && typeof solid.asset === 'string')
            solid.asset = path.resolve(path.dirname(library), solid.asset);
        }
      }
    }
    if (!project) expanded = K.authoring.scenePrefabs.expand(spec, { prefabs }).spec;
  } catch (error) {
    die(error.message);
  }
  for (const s of K.diorama.solids(expanded))
    if (s.kind === 'mesh' && typeof s.asset === 'string' && !assets[s.asset]) {
      const f = ['', '.obj', '.glb', '.gltf']
        .map(e => path.resolve(dir, s.asset + e))
        .find(q => fs.existsSync(q) && fs.statSync(q).isFile());
      if (f) assets[s.asset] = require('../index.js').readMesh(f);
    }
  problems ??= K.diorama.check(spec, { assets, prefabs });
  if (problems.length) console.error(K.diorama.report(problems));
  if (problems.some(p => p.level === 'error'))
    die('not built: ' + problems.filter(p => p.level === 'error').length + ' mistake(s) in ' + file);
  const cacheDirectory = opt['asset-cache'];
  if (cacheDirectory !== undefined && (typeof cacheDirectory !== 'string' || !cacheDirectory.length))
    die('--asset-cache expects a directory');
  const bakeCache = cacheDirectory && require('./bake-cache.js').open(path.resolve(cacheDirectory), require('../index.js'), K.authoring.bakeCache);
  const descriptor=K.diorama.scene(spec,{assets,prefabs,bakeCache,resolveSpriteAtlas});
  const atlases=new Map();
  return { ...descriptor, project: project?.metadata, lookPreviewPacks:spec.assetPacks, build(seed, options = {}) {
    const parameterTime = opt['parameter-time'] ?? (Number.isFinite(Number(opt.t)) ? opt.t : 0);
    const world=descriptor.build(seed, { ...options, parameterInputs: { time: Number(parameterTime), ...options.parameterInputs } });
    if (Array.isArray(world.spriteAtlases)) world.spriteAtlases=world.spriteAtlases.map(placement=>{
      if (typeof placement?.atlas!=='string') return placement;
      const file=path.resolve(dir,placement.atlas);
      if (!atlases.has(file)) atlases.set(file,require('./sprite-atlas.js').readSpriteAtlas(file));
      return K.sprite.placeAtlas({ ...placement, atlas:atlases.get(file) });
    });
    return world;
  } };
}
function scene(id) {
  if (!id) die('which diorama? try: ink-studio scenes');
  if (opt['environment-preset'] !== undefined && !id.endsWith('.json'))
    die('--environment-preset selects a preset for a JSON diorama');
  if (gaussianFile(id)) {
    const descriptor = gaussianScenes.get(id);
    if (!descriptor) throw new Error('Gaussian input is supported by render, turn, sheet, clip and snap');
    return descriptor;
  }
  if (/\.(obj|gltf|glb)$/i.test(id)) return meshScene(id);
  if (id.endsWith('.json')) return dataScene(id);
  if (id.endsWith('.js')) return require(path.resolve(id))(lib());
  const s = lib().SCENES.find(q => q.id === id);
  if (!s) die('no diorama called "' + id + '"');
  return s;
}
const paintDirectory = id => path.resolve(CWD, opt.dir || path.join(cfg.paint || 'studio/paint', id));
const readPaint = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
function build(id, seedOverride, { paint = true, retainSdf = false, parameterInputs, controls: suppliedControls } = {}) {
  if (opt.focus) {
    const f = list('focus'); // uneven detail: x,y,z then near, far, coarse
    globalThis.INK_FOCUS = { p: [f[0] || 0, f[1] || 0, f[2] || 0], near: f[3], far: f[4], coarse: f[5] };
  }
  if (opt.follow)
    globalThis.INK_FOLLOW =
      opt.follow === true
        ? {}
        : { stretch: +String(opt.follow).split(',')[0], broad: +String(opt.follow).split(',')[1] || undefined };
  if (opt.bounce) globalThis.INK_BOUNCE = true; // bounce light: every dab is also lit by the lit things round it
  if (opt.fine) globalThis.INK_FINE = true; // inked detail: dabs are baked with a tile of the surface under them
  const sampling = opt['adaptive-sampling'];
  if (sampling !== undefined) {
    if (sampling === 'on' || sampling === true) globalThis.INK_ADAPTIVE_SAMPLING = true;
    else if (sampling === 'off') globalThis.INK_ADAPTIVE_SAMPLING = false;
    else globalThis.INK_ADAPTIVE_SAMPLING = JSON.parse(fs.readFileSync(path.resolve(sampling), 'utf8'));
    require('../src/sculpt-sampling.js').prepare(globalThis.INK_ADAPTIVE_SAMPLING);
  }
  if (opt['sdf-assist'] !== undefined) globalThis.INK_RETAIN_RENDER_SDF = Boolean(sdfAssistOption());
  const s = scene(id);
  // Load paint by scene ID so rendering the same file from another path finds its decals.
  const decalFile = path.join(paintDirectory(s.id), 'decals.json');
  shot?.dependency(decalFile);
  const savedPaint = !s.project && paint && (fs.existsSync(decalFile) ? readPaint(decalFile) : globalThis.INK_PAINT?.[s.id]);
  globalThis.INK_DECAL_NEXT = savedPaint?.layers !== undefined || Array.isArray(savedPaint) ?
    savedPaint : savedPaint?.decals ?? null;
  const t0 = Date.now();
  const controls = suppliedControls ?? (opt.params ? JSON.parse(String(opt.params)) : undefined);
  const snapshot = opt.authoring ? JSON.parse(fs.readFileSync(path.resolve(opt.authoring), 'utf8')) : undefined;
  const importedInputs = snapshot?.format === 'ink-studio/scene-simulation-inputs' ||
    snapshot?.format === 'ink-studio/scene-replay' && snapshot.simulationInputs !== undefined;
  if (importedInputs && (snapshot.scene !== s.id || snapshot.version !== 1 || !Number.isSafeInteger(snapshot.seed)))
    die('Simulation inputs need the original scene and a valid seed');
  const inputs = importedInputs ? lib().KIT.simulationInputs.tracks(snapshot.simulationInputs) : undefined;
  const seed = seedOverride ?? (opt.seed === undefined ? snapshot?.seed ?? s.seed : +opt.seed);
  shot?.seed(seed);
  const assemble = () => {
    const built = s.build(seed, { controls, snapshot, ...(inputs && { simulationInputs: inputs }),
      ...(parameterInputs && { parameterInputs }) });
    return (s.animate && s.animate(built, seed)) || built;
  };
  const previousSdf = globalThis.INK_RETAIN_RENDER_SDF;
  let w;
  try {
    if (retainSdf) globalThis.INK_RETAIN_RENDER_SDF = true;
    w = liveSunOption() ? require('./look-preview.js').withAlbedo(assemble) : assemble();
  } finally {
    if (retainSdf) globalThis.INK_RETAIN_RENDER_SDF = previousSdf;
  }
  if (inputs) {
    const actual = w.simulationInputs && lib().KIT.simulationInputs.tracks(w.simulationInputs);
    if (!actual || Object.entries(inputs).some(([id, track]) => JSON.stringify(actual[id]) !== JSON.stringify(track)))
      die('The scene did not restore the supplied simulation input tracks');
  }
  if (w.simulationInputs) w.simulationInputSeed = seed;
  if (w.sandbox && !w.anim) lib().KIT.sandbox.attach(w); // and one whose stuff is a sandbox gets its grid going
  if (w.pix && lib().KIT.pixel)
    ((w.pixTex = lib().KIT.pixel.evaluators(w)),
      (w.pixCell = lib().KIT.pixel.CELL),
      (w.pixView = lib().KIT.pixel.VIEW),
      (w.pixUnfold = lib().KIT.pixel.unfold),
      (w.pixAnchors = lib().KIT.pixel.anchors)); // (colour per pixel: its patterns, to be called for each pixel; where edge sprites stand)
  w.buildMs = Date.now() - t0;
  w.id = s.id;
  if (s.lookPreviewPacks !== undefined) w.lookPreviewPacks = s.lookPreviewPacks;
  w.name = s.name;
  w.clock = 0;
  if (w.anim?.trackAtmosphere && opt['atmosphere-emitters'] !== undefined)
    w.anim.trackAtmosphere(lib().KIT.atmosphere.emitters.settings(w.atmosphereEmitters, atmosphereEmittersOption()));
  if (w.anim?.motionSettings) w.anim.motionDirection = ArtDirection.prepare(w.look?.artDirection,artDirectionOption());
  if (w.anim?.usesSceneWind) w.anim.motionEnvironment = {
    ...skyOptions(), windField: windFieldOption(), sceneExposure: sceneExposureOption(),
    weatherBinding: weatherOption(), weatherFronts: onOffOption('weather-fronts'), weatherTracks: onOffOption('weather-tracks'),
    skyTransitions: skyTransitionsOption()
  };
  if (w.anim && w.anim.stateful) w.anim.update(0, 0);
  for (const note of w.warnings || []) console.error('warning: ' + s.id + ': ' + note);
  return w;
}
/* --poke 2:0.2,1.4,0.9 taps the diorama at 2 seconds, along the line from the camera to that point (several: 2:x,y,z;5:x,y,z) */
const POKES = String(opt.poke || '')
  .split(';')
  .filter(Boolean)
  .map(q => {
    const m = q.split(':');
    return { t: +m[0], p: m[1].split(',').map(Number) };
  });
function tap(w, t0, t1) {
  for (const k of POKES) {
    if (!(k.t > t0 && k.t <= t1) || !w.anim.poke) continue;
    const c = w.cam,
      cp = Math.cos(c.pitch),
      eye = [
        c.target[0] + c.dist * cp * Math.sin(c.yaw),
        c.target[1] + c.dist * Math.sin(c.pitch),
        c.target[2] + c.dist * cp * Math.cos(c.yaw)
      ],
      d = k.p.map((v, i) => v - eye[i]),
      l = Math.hypot(d[0], d[1], d[2]);
    w.anim.poke(
      eye,
      d.map(v => v / l)
    );
  }
}
function pose(w, t) {
  if (!w.anim) return;
  return require('./diarama-pose.js').pose(w, t, { kit: lib(), artDirection: artDirectionOption(), tap });
}
const artPixelSize = cmd === 'compare' || cmd === 'review' ? undefined : num('px', undefined);
if (artPixelSize !== undefined && (!Number.isSafeInteger(artPixelSize) || artPixelSize < 1))
  die('--px needs a positive integer');
let horizonOverride, silhouetteOverride, artDirectionOverride, stableOverride, lutOverride, stackOverride, effectPalettesOverride, constraintsOverride, skyOverride, skyProfiles, skyTransitionsOverride, celestialOverride, cloudOverride, weatherOverride, precipitationOverride, rainImpactOverride, windFieldOverride, lightningOverride, sceneExposureOverride, shapedAtmosphereOverride, volumeCutoutsOverride, splatFieldsOverride, atmosphereEmittersOverride, inputSpriteAtlas;
function skyProfileOverrides(value) {
  if (typeof value !== 'string') die('--sky-profile expects track=profile pairs');
  const pairs = value.split(',').map(entry => entry.split('=').map(part => part.trim()));
  if (pairs.some(pair => pair.length !== 2 || pair.some(name => !name)) ||
      new Set(pairs.map(([id]) => id)).size !== pairs.length) die('--sky-profile expects distinct track=profile pairs');
  return Object.fromEntries(pairs);
}
function skyTransitionsOption() {
  const value = opt['sky-transitions'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--sky-transitions needs a JSON array file or off');
  return skyTransitionsOverride ??= JSON.parse(fs.readFileSync(path.resolve(value),'utf8'));
}
let shutterOverride;
function shutterOption() {
  const value = opt.shutter;
  if (value === undefined) return;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return shutterOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}
let inspectionOverride, shadowArtOverride, compositeOverride, cutawayOverride, renderGraphOverride, afterimagesOverride, reconstructionOverride, passQualityOverride;
function passQualityOption() {
  const value = opt['pass-quality'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--pass-quality needs a JSON file or off');
  return passQualityOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}
function shadowArtOption() {
  const value = opt['shadow-art'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--shadow-art needs a JSON file or off');
  return shadowArtOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let relightOverride;
function relightingOption() {
  const value = opt.relighting;
  if (value === undefined) return;
  if (value === 'off') return false;
  if (value === 'on' || value === true) return true;
  return relightOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function liveSunOption() {
  const value = opt['live-sun'];
  if (value === 'off') return false;
  if (value !== undefined && value !== true && value !== 'on') die('--live-sun expects on or off');
  if (opt['sun-shadows'] !== undefined && !['off', 'on', true].includes(opt['sun-shadows']))
    die('--sun-shadows expects on or off');
  const overrides = {
    ...(opt['sun-direction'] !== undefined && { direction: list('sun-direction') }),
    ...(opt['sun-ambient'] !== undefined && { ambient: num('sun-ambient') }),
    ...(opt['sun-intensity'] !== undefined && { intensity: num('sun-intensity') }),
    ...(opt['shadow-map-size'] !== undefined && { mapSize: num('shadow-map-size') }),
    ...(opt['shadow-bias'] !== undefined && { bias: num('shadow-bias') }),
    ...(opt['sun-shadows'] !== undefined && { shadows: opt['sun-shadows'] !== 'off' })
  };
  for (const [flag, key] of [['sky-bounce', 'skyBounce'], ['ground-bounce', 'groundBounce']]) {
    const choice = opt[flag], strength = opt[flag + '-intensity'];
    if (choice === undefined && strength === undefined) continue;
    if (choice === 'off') overrides[key] = false;
    else {
      if (choice !== undefined && typeof choice !== 'string') die('--' + flag + ' expects a color, preset name or off');
      overrides[key] = { ...(choice !== undefined && { color: choice }),
        ...(strength !== undefined && { intensity: strength === true ? NaN : num(flag + '-intensity') }) };
    }
  }
  if (value || Object.keys(overrides).length) return overrides;
}

function aerialOption() {
  const value = opt['aerial-perspective'];
  if (value === 'off') return false;
  if (value !== undefined && value !== 'on' && value !== true) die('--aerial-perspective expects on or off');
  const pairs = [['aerial-start', 'start'], ['aerial-density', 'density'], ['aerial-contrast', 'contrast']];
  const supplied = pairs.filter(([flag]) => opt[flag] !== undefined);
  if (!value && !supplied.length) return undefined;
  return Object.fromEntries(supplied.map(([flag, setting]) => [setting, opt[flag] === true ? NaN : num(flag)]));
}

function cloudShadowOption() {
  const value = opt['cloud-shadows'];
  if (value === 'off') return false;
  if (value !== undefined && value !== 'on' && value !== true) die('--cloud-shadows expects on or off');
  const pairs = [['cloud-shadow-strength', 'strength'], ['cloud-shadow-softness', 'softness']];
  const supplied = pairs.filter(([flag]) => opt[flag] !== undefined);
  if (!value && !supplied.length) return undefined;
  return Object.fromEntries(supplied.map(([flag, setting]) => [setting, opt[flag] === true ? NaN : num(flag)]));
}

function weatherOption() {
  const value = opt['weather-binding'];
  if (value === undefined) return undefined;
  if (value === false || value === 'off') return false;
  if (value === true || value === 'on') return true;
  return weatherOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function windFieldOption() {
  const value = opt['wind-field'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return windFieldOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function sceneExposureOption() {
  const value = opt['scene-exposure'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return sceneExposureOverride ??= require('../src/scene-exposure.js').compile(
    JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function celestialOption() {
  const value = opt['celestial-tracks'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === 'on' || value === true) return true;
  return celestialOverride ??= require('../src/celestial-tracks.js').compile(JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function effectPalettesOption() {
  const value = opt['effect-palettes'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === 'on' || value === true) return true;
  return effectPalettesOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function atmosphereEmittersOption() {
  const value = opt['atmosphere-emitters'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === 'on' || value === true) return true;
  return atmosphereEmittersOverride ??= require('../index.js').load().KIT.atmosphere.emitters.compile(
    JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function splatFieldsOption() {
  const value = opt['splat-fields'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === 'on' || value === true) return true;
  return splatFieldsOverride ??= lib().KIT.splatFields.compile(JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function spriteAtlasOption() {
  const value=opt['sprite-atlas'];
  if (value===undefined) return undefined;
  if (value==='off') return false;
  if (value==='on' || value===true) return true;
  if (!inputSpriteAtlas) {
    const edits=opt['sprite-cels'];
    if (edits!==undefined&&typeof edits!=='string') die('--sprite-cels needs a JSON path or off');
    const atlas=require('./sprite-atlas.js').readSpriteAtlas(path.resolve(value),
      { cels: edits==='off'?false:edits&&path.resolve(edits) });
    inputSpriteAtlas=[lib().KIT.sprite.placeAtlas({
      atlas,at:opt['sprite-at']?list('sprite-at'):[0,0,0],scale:num('sprite-scale',1),playback:opt['sprite-playback']
    })];
  }
  return inputSpriteAtlas;
}

function volumeCutoutsOption() {
  const value=opt['volume-cutouts'];
  if (value===undefined) return undefined;
  if (value==='off') return false;
  if (value==='on' || value===true) return true;
  return volumeCutoutsOverride ??= require('../src/volume-cutouts.js').compile(
    JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function shapedAtmosphereOption() {
  const value=opt['shaped-atmosphere'];
  if (value===undefined) return undefined;
  if (value==='off') return false;
  if (value==='on' || value===true) return true;
  return shapedAtmosphereOverride ??= require('../src/scene-optics.js').shapedVolumes(
    JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

let depthBandsOverride;
function depthBandsOption() {
  const value=opt['atmosphere-depth-bands'];
  if (value===undefined) return undefined;
  if (value==='off') return false;
  if (value==='on' || value===true) return true;
  return depthBandsOverride ??= JSON.parse(fs.readFileSync(path.resolve(value),'utf8'));
}

function cloudFieldOption() {
  const value = opt['cloud-field'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  const clouds = require('../src/cloud-field.js');
  return cloudOverride ??= clouds.compile(clouds.recipes.includes(value) ? value :
    JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function lightningOption() {
  const value = opt.lightning;
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return lightningOverride ??= require('../src/lightning.js').compile(
    JSON.parse(fs.readFileSync(path.resolve(value), 'utf8')));
}

function precipitationOption() {
  const value = opt['world-precipitation'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return precipitationOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function rainImpactOption() {
  const value = opt['rain-impacts'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return rainImpactOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function onOffOption(flag) {
  const value = opt[flag];
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  die('--' + flag + ' expects on or off');
}

function horizonOption() {
  const value = opt['horizon-bands'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return horizonOverride ??= require('./horizon-bands.js').readHorizonBands(value, shot?.dependency);
}

function silhouetteOption() {
  const value = opt['silhouette-protection'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return silhouetteOverride ??= JSON.parse(fs.readFileSync(path.resolve(value),'utf8'));
}

function artDirectionOption() {
  const value = opt['art-direction'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (value === 'on' || value === true) return true;
  if (/\.json$/i.test(value)) return artDirectionOverride ??= JSON.parse(fs.readFileSync(path.resolve(value),'utf8'));
  return value;
}

function stabilityOption() {
  const value = opt.stable;
  if (value === 'off') return false;
  const snap = onOffOption('snap');
  if (value === undefined && snap === undefined && opt['dither-space'] === undefined &&
      opt['dither-spacing'] === undefined && opt['dither-origin'] === undefined && opt.resolve === undefined) return;
  const fromFile = value !== undefined && value !== true && value !== 'on';
  const base = fromFile ? (stableOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'))) :
    value === 'on' || value === true ? {snap:true} : {};
  if (!base || typeof base !== 'object' || Array.isArray(base)) throw new TypeError('Stable settings file needs an object');
  return {
    ...base,
    ...(snap !== undefined && {snap}),
    ...(opt['dither-space'] !== undefined && {dither:opt['dither-space']}),
    ...(opt['dither-spacing'] !== undefined && {spacing:num('dither-spacing')}),
    ...(opt['dither-origin'] !== undefined && {origin:list('dither-origin')}),
    ...(opt.resolve !== undefined && {resolve:opt.resolve})
  };
}

function clipCamera(world) {
  if (opt['camera-pan'] === undefined && opt['camera-orbit'] === undefined) return null;
  const shift = list('camera-pan',[0,0,0]), start = list('target',world.cam.target);
  const yaw = num('yaw',world.cam.yaw), degrees = num('camera-orbit',0);
  if (opt['camera-orbit'] === true || ![shift,start].every(v=>v.length===3 && v.every(Number.isFinite)) ||
      !Number.isFinite(yaw) || !Number.isFinite(degrees))
    throw new TypeError('Use --camera-pan x,y,z and --camera-orbit degrees');
  return phase => ({
    target: start.map((n,i)=>n+shift[i]*phase),
    yaw: yaw+phase*degrees*Math.PI/180
  });
}

function skyOptions() {
  const options = {
    skyEnvironment: opt['sky-environment'] === 'off' ? false : opt['sky-environment'] === undefined ? undefined :
      (skyOverride ??= require('../src/sky-environment.js').compile(
        JSON.parse(fs.readFileSync(path.resolve(opt['sky-environment']), 'utf8')))),
    skyTime: num('sky-time'),
    skyProfiles: opt['sky-profile'] === undefined ? undefined : (skyProfiles ??= skyProfileOverrides(opt['sky-profile']))
  };
  shot?.profiles(options.skyProfiles);
  return options;
}

let stableDetailOverride;
function stableDetailOption() {
  const value = opt['stable-detail'];
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  return stableDetailOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let stagingOverride;
function cameraOptions() {
  const cameraShot = opt['camera-shot'];
  if (cameraShot !== undefined && !lib().KIT.world.data.id(cameraShot)) die('--camera-shot needs a shot ID');
  const staging = opt['camera-staging'];
  if (staging !== undefined && typeof staging !== 'string') die('--camera-staging needs a JSON file, on or off');
  const cameraStaging = staging === 'off' ? false : staging === 'on' ? true : staging === undefined ? undefined :
    (stagingOverride ??= JSON.parse(fs.readFileSync(path.resolve(staging), 'utf8')));
  if (opt['focal-length'] === true || opt['sensor-height'] === true) die('Lens options need a value in millimeters');
  const composition=opt.composition===undefined?undefined:String(opt.composition).split(',').map(Number);
  if(composition!==undefined) {try{lib().CameraLens.composition(composition);}catch(error){die('--composition needs two normalized numbers, e.g. 0.33,0.5');}}
  return { cameraImpulseTime:num('camera-impulse-time'), fov:num('fov'), focusDistance:num('focus-distance'), composition, cameraShot, ortho: onOffOption('ortho'), cameraStaging, cameraGuides: onOffOption('camera-guides'),
    focalLength: num('focal-length'), sensorHeight: num('sensor-height'), depthOfField: onOffOption('depth-of-field') };
}

let sdfAssistOverride;
function sdfAssistOption() {
  const value = opt['sdf-assist'];
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  return sdfAssistOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let colorClustersOverride;
function colorClustersOption() {
  const value = opt['color-clusters'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--color-clusters needs a JSON file or off');
  return colorClustersOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}
let edgeFilterOverride;
function edgeFilterOption() {
  const value = opt['edge-filter'];
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  return edgeFilterOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let curveWidthOverride;
function curveWidthOption() {
  const value = opt['curve-width'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--curve-width needs a JSON file or off');
  return curveWidthOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let curveQualityOverride;
function curveQualityOption() {
  const value = opt['curve-quality'];
  if (value === undefined) return;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--curve-quality needs a JSON file or off');
  return curveQualityOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let translucentSilhouettesOverride;
function translucentSilhouettesOption() {
  const value = opt['translucent-silhouettes'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--translucent-silhouettes needs a JSON file or off');
  return translucentSilhouettesOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let motionalCoverageOverride;
function motionalCoverageOption() {
  const value = opt['motional-coverage'];
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  if (typeof value !== 'string') die('--motional-coverage needs on, off or a JSON file');
  return motionalCoverageOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let inkOverride;
function inkOption() {
  const value = opt.ink;
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  return inkOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

function cutawayOption() {
  if (opt.cutaway === 'off') return false;
  if (opt.cutaway === undefined) return undefined;
  if (typeof opt.cutaway !== 'string') die('--cutaway needs a JSON file or off');
  return cutawayOverride ??= JSON.parse(fs.readFileSync(path.resolve(opt.cutaway), 'utf8'));
}

function compositeOption() {
  if (opt.composite === 'off') return false;
  if (opt.composite === undefined) return undefined;
  if (typeof opt.composite !== 'string') die('--composite needs a JSON file or off');
  return compositeOverride ??= JSON.parse(fs.readFileSync(path.resolve(opt.composite), 'utf8'));
}

let contactShadowsOverride;
function contactShadowsOption() {
  const value = opt['contact-shadows'];
  if (value === undefined) return undefined;
  if (value === true || value === 'on') return true;
  if (value === 'off') return false;
  return contactShadowsOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

let areaLightsOverride;
function areaLightsOption() {
  const value = opt['area-lights'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  areaLightsOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
  if (!Array.isArray(areaLightsOverride)) die('--area-lights settings file needs an emitter array');
  return areaLightsOverride;
}

let shotLightingOverride;
function shotLightingOption() {
  const value = opt['shot-lighting'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  shotLightingOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
  require('../src/shot-lighting.js').prepare(shotLightingOverride);
  return shotLightingOverride;
}

let bounceProbesOverride;
function bounceProbesOption() {
  const value = opt['bounce-probes'];
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (value === true || value === 'on') return true;
  return bounceProbesOverride ??= JSON.parse(fs.readFileSync(path.resolve(value), 'utf8'));
}

const view = extra =>
  Object.assign(
    {
      yaw: opt.yaw === undefined ? undefined : +opt.yaw,
      pitch: opt.pitch === undefined ? undefined : +opt.pitch,
      zoom: num('zoom', 1),
      target: opt.target ? list('target') : undefined,
      w: num('w', 900),
      h: num('h', 620),
      px: artPixelSize,
      stable: stabilityOption(),
      stableDetail: stableDetailOption(),
      edgeFilter: edgeFilterOption(),
      motionalCoverage: motionalCoverageOption(),
      colorClusters: colorClustersOption(),
      boundaryCels: onOffOption('boundary-cels') === false ? false : undefined,
      artDirection: artDirectionOption(),
      silhouetteProtection: silhouetteOption(),
      horizonBands: horizonOption(),
      effectPalettes: effectPalettesOption(),
      artEffects: opt.effects === 'off' ? false : opt.effects,
      emissiveFinishes: onOffOption('emissive-finishes') === false ? false : undefined,
      shoreFoam: onOffOption('shore-foam') === false ? false : undefined,
      highlightCels: onOffOption('highlight-cels') === false ? false : undefined,
      ink: inkOption(),
      tone: opt.tone === 'off' ? false : opt.tone,
      paletteRemap: opt['palette-remap'] === 'off' ? false : undefined,
      colorCurves: opt['color-curves'] === 'off' ? false : undefined,
      colorLut: opt.lut === undefined ? undefined : (lutOverride ??= require('./lut.js').override(opt.lut)),
      colorStack: opt['color-stack'] === undefined ? undefined :
        (stackOverride ??= require('./color-stack.js').override(opt['color-stack'])),
      paletteConstraints: opt['palette-constraints'] === undefined ? undefined :
        (constraintsOverride ??= require('./palette-constraints.js').override(opt['palette-constraints'])),
      coverageAware: opt['coverage-aware'] === undefined ? undefined : opt['coverage-aware'] !== 'off',
      lookMasks: opt['look-masks'] === 'off' ? false : undefined,
      ignoreLookGrade: opt.look === 'off',
      strictContract: onOffOption('strict-contract'),
      stepAnimation: onOffOption('step-animation'),
      shutter: shutterOption(),
      raw: !!opt.raw,
      paintCorrections: opt['paint-corrections'] !== 'off',
      colored: !!opt.colored,
      splatOrder: opt['splat-order'],
      splatCoverage: opt['splat-coverage'],
      translucentSilhouettes: translucentSilhouettesOption(),
      splatFootprints: onOffOption('splat-footprints'),
      curveSplats: onOffOption('curve-splats'),
      curveMode: opt['curve-mode'],
      curveLod: onOffOption('curve-lod'),
      curveWidth: curveWidthOption(),
      curveQuality: curveQualityOption(),
      paletteSampling: onOffOption('palette-sampling'),
      brushwork: onOffOption('brushwork'),
      shadowBandPaint: onOffOption('shadow-band-paint'),
      renderGrid: opt['render-grid'] === 'off' ? false : opt['render-grid'] === undefined ? undefined :
        { mode: opt['render-grid'], size: num('grid-size', 8), angle: num('grid-angle', 0),
          aspect: num('grid-aspect', 1), gap: num('grid-gap', 0), origin: list('grid-origin', [0, 0]) },
      sdfAssist: sdfAssistOption(),
      stableTransparency: opt['stable-transparency'] === 'blend' ? { mode: 'blend' } : onOffOption('stable-transparency'),
      fragmentBudget: num('fragment-budget'),
      inspection: opt.inspection === 'off' ? false : opt.inspection === undefined ? undefined :
        (inspectionOverride ??= JSON.parse(fs.readFileSync(path.resolve(opt.inspection), 'utf8'))),
      inspectionFocus: opt['inspection-focus'],
      composite: compositeOption(),
      cutaway: cutawayOption(),
      renderGraph: opt['render-graph'] === 'off' ? false : opt['render-graph'] === undefined ? undefined :
        (renderGraphOverride ??= JSON.parse(fs.readFileSync(path.resolve(opt['render-graph']), 'utf8'))),
      reconstruction: opt.reconstruction === 'off' ? false : opt.reconstruction === undefined ? undefined :
        (reconstructionOverride ??= JSON.parse(fs.readFileSync(path.resolve(opt.reconstruction), 'utf8'))),
      afterimages: opt.afterimages === 'off' ? false : opt.afterimages === undefined ? undefined :
        (afterimagesOverride ??= JSON.parse(fs.readFileSync(path.resolve(opt.afterimages), 'utf8'))),
      fine: !!opt.fine,
      clean: !!opt.clean,
      ...cameraOptions(),
      surface: opt.surface === 'off' ? false : undefined,
      facingColors: onOffOption('facing-colors'),
      directionalColors: onOffOption('directional-colors'),
      water: opt.water === 'off' ? false : undefined,
      reflections: opt.reflections === 'off' ? false : undefined,
      reflectionDetail: onOffOption('reflection-detail'),
      passQuality: passQualityOption(),
      reflectionProbes: onOffOption('reflection-probes'),
      transmission: onOffOption('transmission'),
      surfaceDetailKits: onOffOption('surface-detail-kits'),
      skyReflections: opt['sky-reflections'],
      ...skyOptions(),
      celestialTracks: celestialOption(),
      cloudField: cloudFieldOption(),
      cloudRepresentation: opt['cloud-representation'],
      cloudSelfShadows: onOffOption('cloud-self-shadows'),
      cloudShadows: cloudShadowOption(),
      weatherBinding: weatherOption(),
      retainedWeather: onOffOption('retained-weather'),
      weatherFronts: onOffOption('weather-fronts'),
      weatherTracks: onOffOption('weather-tracks'),
      windField: windFieldOption(),
      lightning: lightningOption(),
      sceneExposure: sceneExposureOption(),
      precipitation: precipitationOption(),
      rainImpacts: rainImpactOption(),
      skyTransitions: skyTransitionsOption(),
      liveSun: liveSunOption(),
      areaLights: areaLightsOption(),
      cutoutShadows: onOffOption('cutout-shadows'),
      shadowShells: onOffOption('shadow-shells'),
      shotLighting: shotLightingOption(),
      bounceProbes: bounceProbesOption(),
      relighting: relightingOption(),
      shadowArt: shadowArtOption(),
      contactShadows: contactShadowsOption(),
      atmosphere: opt.atmosphere === 'off' ? false : undefined,
      shapedAtmosphere: shapedAtmosphereOption(),
      atmosphereDepthBands: depthBandsOption(),
      volumeCutouts: volumeCutoutsOption(),
      splatFields: splatFieldsOption(),
      atmosphereEmitters: atmosphereEmittersOption(),
      spriteAtlases: spriteAtlasOption(),
      scalePreviews: onOffOption('scale-previews'),
      spriteAtlasMode: opt['sprite-atlas-mode'],
      spriteReconstruction: opt['sprite-reconstruction'],
      aerialPerspective: aerialOption(),
      volumeLocalLights: onOffOption('volume-local-lights'),
      volumeLocalShadows: onOffOption('volume-local-shadows'),
      volumeQuality: opt['volume-scale'] || opt['volume-steps'] || opt['volume-jitter'] ? {
        ...(opt['volume-scale'] && { scale: num('volume-scale') }),
        ...(opt['volume-steps'] && { steps: num('volume-steps') }),
        ...(opt['volume-jitter'] && { jitter: opt['volume-jitter'] })
      } : undefined,
      edges: opt.edges === 'off' ? false : undefined
    },
    extra,
    shotRender
  );
const save = (name, img, alpha) => {
  const f = outputFile(name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  PNG.write(f, img.w, img.h, img.rgb, alpha);
  console.log('wrote', f, img.w + 'x' + img.h);
  return f;
};
const asciiFrame = (image, world) => lib().KIT.ascii.draw(image, {
  set: opt.text === true ? 'ascii' : opt.text,
  g: num('tg', 2),
  px: opt.px1 ? 1 : image.px,
  colour: opt.tcolour || 'scene',
  pal: image.palette || world.pal
});
const displayFrame = (image, world) => opt.text ? asciiFrame(image, world) : R.upscale(image, opt.px1 ? 1 : image.px);
function buildPreview(id = pos[0], options) {
  const Preview = require('./look-preview.js');
  const assemble = () => build(id, undefined, options);
  const world = opt.look !== undefined && opt.look !== 'off' ? Preview.withAlbedo(assemble) : assemble();
  return Preview.override(world, opt, lib());
}
const previewPasses = () => require('./look-preview.js').preview(opt);
const reviewSidecars = diagnostics => [...(diagnostics?.suffixes ?? []), ...(opt.text ? ['.txt'] : [])];
const textSidecar = file => file.replace(/\.(?:a?png)$/i, '') + '.txt';
function sceneEmbedConfig() {
  if (opt['embed-config'] === undefined) return;
  if (typeof opt['embed-config'] !== 'string') throw new TypeError('--embed-config needs a JSON filename');
  return JSON.parse(fs.readFileSync(path.resolve(opt['embed-config']), 'utf8'));
}
function sequenceHistory() {
  return R.sequenceHistory(lib().KIT);
}
function priorArtReference(world, time, capture) {
  const previous = num('previous');
  if (!Number.isFinite(time) || opt.t === true) die('--t needs a time in seconds');
  if (previous === undefined) return;
  if (opt.previous === true || !Number.isFinite(previous) || previous >= time)
    die('--previous needs a time earlier than --t');
  pose(world, previous);
  return R.render(world, view({ t: previous, ...capture })).motionReference;
}
function feedbackReplay(world, start, frame) {
  const api = lib().KIT.renderGraph;
  const graph = frame.renderGraph ?? world.look?.renderGraph;
  const definition = graph?.snapshot?.() ?? graph;
  const cuts = opt['feedback-cuts'];
  if (opt['feedback-fps'] === undefined && cuts === undefined &&
      !definition?.passes?.some(pass => ['feedback', 'frameAge', 'motionSmear', 'frameBank'].includes(pass.type))) return null;
  if (opt['feedback-fps'] === true) die('--feedback-fps needs a rate in (0, 240]');
  if (cuts !== undefined && (typeof cuts !== 'string' && typeof cuts !== 'number' ||
      String(cuts).split(',').some(cut => !cut.trim())))
    die('--feedback-cuts needs a comma-separated list of scene times');
  return api.replay({ fps: num('feedback-fps', 24), start: Math.min(0, start),
    cuts: cuts === undefined ? [] : String(cuts).split(',').map(Number) });
}

const times = () =>
  opt.t !== undefined
    ? list('t')
    : (n =>
        Array.from(
          { length: n },
          (_, i) => +(num('from', 0) + ((num('to', 6) - num('from', 0)) * i) / Math.max(1, n - 1)).toFixed(3)
        ))(num('n', 12));
function die(m) {
  console.error(m);
  process.exit(1);
}
const worldCLI = () => require('./world.js')({kit:lib(),build,pose,dataScene,opt,renderOptions:view,sequenceHistory,inkOption,atmosphereEmittersOption,depthBandsOption,effectPalettesOption,stabilityOption,artDirectionOption,silhouetteOption,horizonOption,skyTransitionsOption,
  weatherTracksOption:() => onOffOption('weather-tracks'),skyOptions,cameraOptions,compositeOption,colorClustersOption,shot,shotReplay,shotRender});
const worldCommands = new Set(['inspect','probe','trace','field','data-inputs','scene','sim']);
const CMD = {
  async 'show-bridge'() {
    const dmxHost = opt['dmx-host'], protocol = opt['dmx-protocol'] ?? 'artnet', oscHost = opt['osc-host'];
    if (pos.length || !Object.keys(opt).every(name => [
      'port', 'osc-in', 'input-host', 'art-timecode-in', 'dmx-host', 'dmx-protocol', 'dmx-port', 'universe', 'osc-host', 'osc-port'
    ].includes(name)) || Object.values(opt).some(value => value === true))
      die('Usage: ink-studio show-bridge [--port 8181] [--dmx-host IP] [--dmx-protocol artnet|sacn]');
    const bridge = await require('./show-bridge.js').createShowBridge({
      port: num('port', 8181), oscInput: num('osc-in', 9002), inputHost: opt['input-host'],
      artTimecodeInput: num('art-timecode-in'),
      dmx: dmxHost && { host: dmxHost, protocol, universe: num('universe', protocol === 'artnet' ? 0 : 1), port: num('dmx-port') },
      oscOutput: oscHost && { host: oscHost, port: num('osc-port', 9000) }
    });
    console.log('Ink Show Control ' + bridge.url);
    console.log('OSC input UDP ' + bridge.oscPort + (bridge.artTimecodePort ? ' · ArtTimeCode UDP ' + bridge.artTimecodePort : ''));
    if (dmxHost) console.log('Stage output configured and disarmed');
    const stop = () => { void bridge.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  },
  help() {
    console.log(
      [
        'ink-studio <command> <diorama id | lab/file.js> [options]',
        '',
        '  paint mix|ramp|table|swatches <file.json> [--out file.json]   mix pigments or bake colors',
        '  hierarchy <graph.json> [--node id] [--parent id|world] [--out file.json]   inspect or reparent live scene nodes',
        '  curve <family.json> [--distance n] [--text INK] [--out file.json]   sample reusable curve families',
        '  ornament <pattern.json> [--format pigment|relief|tiles] [--out file]   export a wallpaper or frieze pattern',
        '  palette plot <plot.json> [--space rgb|oklab] [--orbit degrees] [--format png|data]   render a palette in 3D',
        '  palette extract <reference.png> [--size 32] [--alpha visible|opaque|all] [--out report.json]',
        '  palette usage <scene> [--select JSON] [--rare-pixels 3] [--rare-share .001] [--out report.json]',
        '  palette pairs <palette.json> [--sort distance|lightness] [--limit 12] [--scale 16] [--out directory]',
        '  palette ramp-review [ramp.json] [--scene scene --role name] [--pixels JSON] [--out report.json]',
        '  palette distributions <reference.png> [--scene scene | --render frame.png] [--out directory]',
        '  palette error <scene> [--threshold .06] [--heatmap-max .20] [--region-limit 20] [--out directory]',
        '  palette inspect <scene> --at x,y [--out report.json]   explain the palette choice at one art pixel',
        '  palette fit <fit.json> [--format png|data] [--tile]   fit two approved swatches and preview at native size',
        '  palette dither-review <fit.json> [--out directory]   compare approved pairs and flag strong texture',
        '  palette shimmer <scene> [--from 0 --to 3 --fps 12] [--camera-pan x,y,z --camera-orbit degrees] [--include-view] [--animate] [--out directory]',
        '  palette readability <scene> [--select JSON | --plan file.json] [--directions N --times t1,t2] [--out directory]',
        '  palette darks <scene> [--plan file.json] [--directions N --times t1,t2] [--out directory]',
        '  palette weather <scene> [--plan file.json | --select JSON --times t1,t2] [--out directory]',
        '  palette stages <scene> [--select JSON] [--allowed JSON] [--out directory]   review paint, lighting, grade and resolve',
        '  palette compare <scene|checkpoint> <palettes.json> [--out directory]   apply alternatives to one captured shot',
        '  palette save-look <approved.json> [--pack pack.json] [--out pack.json]   save approved palette findings as a look',
        '  palette check <scene> <plan.json> [--out directory]   export a PNG board and check palette assertions',
        '  palette chart <chart.json> [--type chart] [--format png|data]   export an indexed swatch, bar or pair chart',
        '  palette lighting <source-or-draft.json> [--approve] [--out file.json]   suggest or save named lighting ramps',
        '  palette field <field.json> [--t seconds] [--w width --h height] [--format png|data]   render a palette field or report grayscale bands',
        '  palette <recipe.json> [--t seconds] [--out palette.json]   sample palette recipes, paths and animation',
        '  inspect <scene|run>         discover fields, actions, ports and entities',
        '  environment inspect <scene|run> --at x,y,z [--t seconds] [--out report.json]   explain sky and local weather',
        '  environment aesthetics <pack-or-bundle.json> [query] [--json]   discover named aesthetics',
        '  probe <scene|run> --field name [--at x,y,z | --entity id] [--explain]  sample world state',
        '  probe <scene|run> --field world/spatial-batch --spec queries.json   proximity, occupancy and sockets',
        '  inspect|validate|probe <scene|run> --select JSON   inspect, check, or sample a look target',
        '  probe <scene|run> --field look/sample [--select JSON | --entity ID] [--at x,y,z]   explain a baked splat',
        '  trace <scene|run> <name>    trace a route, signal or other exposed query',
        '    trace <scene|run> world/cause --args JSON   follow recorded decisions, inputs and events',
        '  field <scene|run> <name> --spec file.json [--explain]  export a line, grid or time series',
        '  authoring inspect <scene> [--authoring snapshot.json] [--part id]   inspect retained parts',
        '  authoring preview <scene> <edits.json> [--authoring snapshot.json] [--image preview.png]   stage and validate edits',
        '  authoring apply <scene> <edits.json> [--authoring snapshot.json] --out snapshot.json   save validated edits',
        '  authoring suggest-breakable <scene> --at x,y,z [--radius 1] [--voxel .1] [--ids]   suggest a connected breakable part',
        '  --params JSON --parameter-time SEC   supply shared controls and choose the material bake time for a diorama',
        '  --asset-cache DIR   reuse diorama bake data across CLI invocations',
        '  scene apply|stamp|remix|capture|upgrade|sync-prefab|history|promote <world> ...  edit or derive a world manifest',
        '    scene upgrade <world|checkpoint> <instance> --to PREFAB [--migration FILE] [--dry-run]',
        '    scene sync-prefab <release.json> <world ...> --out NEW_DIRECTORY | --dry-run',
        '    scene apply <scene> <edits.json> --dry-run   preview edited paths and look targets',
        '  sim run|resume|fork|reset|replay|verify|scrub|take|diff|sweep|render ...  run or compare fixed-tick simulations',
        '    sim run|resume <world|checkpoint|run> [--start-story document/story] [--until-stage document/story/stage]',
        '      [--until-outcome document/story/outcome] [--until-condition condition.json] [--ticks N]   stop at a story breakpoint',
        '    sim run|resume|fork|replay <file> --watch-story document/story[,document/story...]|all   stream story values as NDJSON',
        '      [--watch-values stage,evidence,roles,blockers,choices,changes] [--watch-out file.ndjson]',
        '    sim plan <world|model|checkpoint|recording>  inspect rates, signal crossings, feedback, baked inputs and resource estimates',
        '    sim model validate|inspect|compile <model.json>  check, describe, or lower a versioned simulation model',
        '    sim run <world> --workers N [--profile]   advance eligible systems in deterministic Node worker partitions',
        '    sim run <world> --record file.json [--observations plan.json]   retain reproducible execution evidence',
        '    sim verify <run> [--workers N]   replay and check the recorded evidence',
        '    sim block-play <model> --samples N [--resume checkpoint --checkpoint file]   sample and checkpoint a fast kernel',
        '    sim mass-properties <plan.json> [--asset-pack pack.json --out report.json]   measure physical shape and material properties',
        '    sim remap <plan.json> [--out report.json]   conservatively transfer extensive state across discretizations',
        '    sim discretize <plan.json> [--out compiled.json]   compile solver cells, face geometry, and boundary regions',
        '    sim domain <domain.json> [--world world.json --section tube/index]   assemble or trace sectioned tubes at named sockets',
        '    sim reduce <plan.json> [--out asset.json]   bake reduced geometry, response taps, or resonant modes',
        '    sim integrate <plan.json> [--out trace.json]   integrate creator-authored state and locate substep events',
        '    sim grid-ops <plan.json> [--out report.json]   apply finite-volume operators to a compiled grid, chart, or mesh',
        '    sim diagnose <plan.json> [--out report.json --fail-on warning|error]   locate stability and conservation issues',
        '    sim measure <run.json> [--out report.json]   named simulation measurements and CI assertions',
        '    sim review <recipe.json> --out directory [--require-match]   matched audio, traces, plots, cutaways and first divergence',
        '    sim budget <plan.json> [--out report.json --require-budget]   measure simulation timing, work, memory and queues',
        '    sim reference [experiment] [--suite suite.json --out report.json]   run the shipped physics benchmarks',
        '    sim sensors <run.json> [--out report.json --wav microphones.wav]   record calibrated virtual sensors',
        '    sim physical-audio <run.json> [--out report.json --stems directory]   route simulation signals into aligned WAV stems',
        '    sim sound-controls <run.json|controls.json> [--out controls.json] [--at seconds | --sample index]   map and inspect sound automation',
        '    sim controller <run.json> [--out trace.json]   replay target following, hysteresis, or PID',
        '    sim fit-targets <plan.json> [--out report.json --require-tolerance]   fit bounded controls to measured targets',
        '    sim fit-parameters <run.json> [--out report.json --require-tolerance]   fit native runs to weighted reference data',
        '    sim input-compile <plan.json> [--out score.json]   compile text, IPA, MIDI, recordings, and cues',
        '    sim input-edit <score.json> <edits.json> [--out score.json]   edit events and rebuild curves',
        '    sim input-export <score.json> [bindings.json] --kind recording|events|gesture   use editable input scores',
        '    sim gesture-score <score.json> [--t seconds | --tick N | --from-tick N --to-tick N --every N]   sample authored and limited targets',
        '    sim boundaries <asset.json> [--t seconds --dt seconds]   inspect reusable boundary and source laws',
        '    sim solve <plan.json> [--out report.json --require-convergence]   solve dense, tridiagonal, sparse, or bracketed scalar systems',
        '    sim network <run.json> [--out trace.json]   simulate a lumped effort/flow network and its sources',
        '    sim waves <run.json> [--out trace.json --wav audition.wav]   render distributed or delay-line pressure and flow',
        '    sim excite <run.json> [--out trace.json --wav force.wav]   render contact impulses, slip, and excitation forces',
        '    sim resonator bake <plan.json> | render <run.json> [--out file.json --wav sound.wav]   bake or audition resonant mode assets',
        '    sim sections <plan.json> [--out report.json]   measure mesh, SDF, or contour sections along a path',
        '    sim model-changes <plan> [--samples N --resume file --checkpoint file]   play prepared parameter ramps and topology swaps',
        '    sim block-check <model> <plan> [--candidate trace.json] [--trace-out file.json]   compare sample block partitions',
        '    --trace-steps [N]   retain actual solver inputs and state for debugging',
        '    sim diff <run|world> [<run|world>] --first [--from N] [--ticks N]   locate the first divergence',
        '    sim run <world> --checkpoint file.json --checkpoint-store DIR   reuse snapshot blocks across checkpoints and runs',
        '    sim scrub <world|checkpoint|run> --ticks N,N [--checkpoint FILE]   seek in the given order',
        '    sim take <world|checkpoint|run> --from N --ticks N --entity ID [--part ID] --out take.json',
        '      --tracks FILE selects capture channels and --every N sets the sampling stride',
        '    sim regions <world|run> --stream ID [--regions IDs | --near X,Y,Z --radius N] [--since snapshot.json]',
        '    sim regions-apply <snapshot.json> <update.json>   reconstruct a scoped snapshot',
        '    sim dependencies <scene|run|driver.js> [--ticks N] [--actions file] [--out report.json]   report spatial rebuilds',
        '    sim sweep <world|run> <cases.json>   use look cases to compare one fixed simulation snapshot',
        '    sim sweep <world|checkpoint|run> <observations.json>   sample scheduled observations across seeds and settings',
        '  compare <scene|run> --looks cases.json [--out sheet.png]   compare look variants on the same view',
        '  compare <scene> --curve-modes --w 160 --h 96 [--t 0 | --from 0 --to 3 --fps 12] [--out directory]',
        '    --comparison side-by-side|swipe|difference   compose exactly two look cases into one image',
        '    --divider 0.5 --swipe-axis x|y --difference-channel luminance|red|green|blue --difference-gain 3',
        '  look inspect <scene|run|look-file> [--renderer headless|webgl]   list bindings, dependencies and targets',
        '  look sample <look-file> [--look pack/look] [--colors JSON | --chart] [--out file.json|chart.png]',
        '  look bake <look-file> [--format auto|palette|lut] [--swatches file] [--size N] [--out bundle.json]',
        '  look parity [--chrome path] [--hardware] [--strict] [--out report.json]   check CPU and WebGL look fixtures',
        '  look profile [--renderer headless|webgl|both] [--frames N] [--warmup N] [--splats N] [--w N --h N]',
        '    [--batch N] [--chrome path] [--hardware] [--out report.json]   benchmark look setup and frame time',
        '  look import <file> [--out pack.json] [--id pack/look]   import a LUT or palette as a versioned look',
        '  look export <file> [--out file | --format json|cube|gpl|pal|hex]   convert or sample a look',
        '    --look pack/look --params JSON --size N --swatches palette-file --report report.json --exact',
        '  lut import <file.cube|file.json> [--out file.json]  load a 3D color table as native JSON',
        '    --input-space space --output-space space --input-range min,max --output-range min,max',
        '    --input-out-of-range preserve|clamp|error --output-out-of-range preserve|clamp|error --domain-policy clamp|error|extrapolate',
        '',
        '  scenes                      list every diorama',
        '  show-bridge [--port 8181] [--osc-in 9002]   open live audio, timecode, stage and projection control',
        '    --dmx-host IP --dmx-protocol artnet|sacn --universe N   configure a physical lighting destination',
        '  catalog [words]             what the toolkit can do, searchable',
        '  stats <id>                  splat counts, colours used, size, cost per frame, warnings',
        '  render <id> [--t 1.5]       one PNG rendered on the CPU',
        '  bounce-probes bake <scene> [--bounce-probes settings.json] --out probes.json',
        '  render <id> --palette-constraints <file.json|off>   override target palettes and dither settings',
        '  render <id> --coverage-aware on|off   grade target contributions before compositing',
        '  render <id> --look-masks off   bypass masked look bindings',
        '  render, clip, transition-review, sim render: --recipe <shot.json>   save reproducible review inputs',
        '  shot replay <shot-or-bundle.json> --out <image.png> [--root project | --shot ID]   verify the saved render',
        '  shot approve <scene> [--plan plan.json] --out report.json [--frame N] [--report-only]',
        '  render <scene.json> --asset-pack <pack-or-bundle.json> [--environment-preset pack/preset]   install and select a reusable look',
        '  ramps <id> [--n 12]         the ramps it is shaded on, and which only get darker without turning; a turning one is offered from the same palette',
        '  values <id> [--t 1.5]       the value check: the picture sorted into dark, middle and light, and whether it reads in three tones',
        '  sheet <id> [--from 0 --to 6 --n 12 | --t 0,1,2]   the same view at several moments, on one sheet',
        '  turn <id> [--n 8] [--t 0]   the diorama from all round, on one sheet',
        '  clip <id> [--from 0 --to 6 --fps 12]   animated PNG (also --text, --feedback-fps 24, --feedback-cuts 2.5,4)',
        '    --camera-pan x,y,z --camera-orbit degrees --px 1   review slow camera motion at native art resolution',
        '  reel <manifest.json> [--out reel.html] [--clean]   export selected captures as an offline reel',
        '  ghost <id> [--t 2 --spacing 0.12 --n 2 | --ghosts 1.6,1.8]   one moment with those either side laid faintly over it',
        '  acts                        the ready clips, reactions, easings and cues, by name',
        '  motion <id> [--from 0 --to 12]   numbers about how it moves: speed, jumps, what goes underground',
        '  render <file.ply|.spz> --raw   render a Gaussian splat cloud without palette quantization',
        '  mesh <file.obj|.gltf|.glb>  import and inspect as splats (--uv requires textured GLB stamps, --uv off uses geometry)',
        '  export-glb <scene.js|.json|.obj|.gltf|.glb> --out model.glb   write UV-mapped geometry with materials, skins and clips',
        '  interchange <asset.gltf|.glb|.json> --out <file>    round-trip glTF or PNG-backed raster assets',
        '                              [--res 0.08 --texture-size 1024 --triangles 16000 --duration 4 --fps 30]',
        '  depth <map.png|map.json> [--image aligned.png --out-dir folder]  import a depth map as splats, a mesh and an SDF',
        '                              [--size 6 --cells 64 --res 0.09 --hues 6 --shades 4 --up z --spin 0.5 --thick 0.1]; a mesh file also works wherever an id does',
        '  validate <scene|look-file> [--renderer headless|webgl]   check scene content and look bindings',
        '                              a .json diorama also works wherever an id does; --style slate|moss|ember puts it in another style',
        '  perf <id> [--secs 5 --fps 60 --json]   animation time and planned texture upload size',
        '  selftest                    every lab module checked in numbers, and the lab dioramas run for a while',
        '  snap <id|all> [--t 0,2]     keep reference pictures',
        '  check [id ...]              draw again and compare with the reference pictures',
        '  render <id> [--text ascii|symbols|braille|blocks --tg 2 --tcolour scene|ink|mono]  drawn as text, with the characters as <id>.txt',
        '  compare <id> <ref.png> [--px 2 --colours 32]  a diorama beside a reference at true pixel size, both measured',
        '  paint export <id> [--layer name] [view options]  capture a view and the surface under each pixel',
        '  paint absorb <id> [--layer name] [--png file] [--paint-mask file]  pin the painted pixels to the surface',
        '  paint layers|tune|clear <id> [--layer name]  list, adjust or clear corrections',
        '  paint cause <id> <recipe.json> [--events <run.json>] [--replace]   bake geometry or committed events into paint layers',
        '    layer controls: --angle degrees --feather degrees --opacity fraction --region JSON|file|off',
        '  lint <id ...> [--map]              pixel-art lint: orphans, doubles, jaggies, banding, pillow shading, noise, colours',
        '  review <id> [--ref pic --px 2]     a sheet of fixed shots (four sides, top, low, far, near, close), beside the last one',
        '  sweep <scene> <plan.json> --out directory   render still and clip contact sheets across settings and seeds',
        '  sweep pin <report-or-directory> <run-id-or-tile> --out pin.json   save one exact case',
        '  sweep replay <pin.json> --out directory   render the saved case',
        '  sweep nearby <pin.json> <offsets.json> --out directory   vary numeric settings around the saved case',
        '  variants <id> --seeds 3,7,12 [--group silhouette|openness|wear --motion]  render a ranked seed contact sheet',
        '  atlas <id> [--directions 8 --pitches 0,0.7 --w 96 --h 96 --fps 12 --maps depth,normal,emission,silhouette]  export a transparent sprite atlas',
        '  camera-review <scene> --from 0 --to 2 --frames 5 --w 160 --h 96   export-sized frames and framing checks',
        '  silhouette-review <scene> --directions 8 --w 96 --h 96   paired export-size views and edge contrast',
        '  transition-review <scene> [--plan file.json] --w 160 --h 90 [--out sheet.png]',
        '    compare native frames around midnight, weather beats, or cuts [--scale N --fail-on-flags]',
        '  pose-review <id> [--directions 8 --w 96 --h 96]  review named poses at sprite resolution',
        '  motion-review <id> [--finding kind-or-id] [--out report.json]  inspect motion findings and focused playback ranges',
        '  clip-sequence <id> [--handoff 0] [--out report.json]  inspect clip instances, retimed cues, and handoffs',
        '  animation-graph <graph.json> [--at seconds] [--inputs file.json] [--out report.json]  inspect poses and event responses',
        '  data-inputs <scene or catalog> [dataset] [--sample JSON --t seconds --rows --out report.json]  inspect typed source data',
        '  randomness <recipe.json> [--samples 16 --out report.json]  inspect named authoring streams and distributions',
        '  math-fields <field.json> [--point x,y,z --time n --integrate seconds --out report.json]  inspect procedural math fields',
        '  splat-footprints <shape|profile.json> [--rotation n --stretch x,y --softness n --point x,y --preview file.png --out report.json]  inspect native splat silhouettes',
        '  render-grid <hex|triangle|diamond|settings.json> [--size 8 --point x,y --bounds x,y,w,h --out report.json]  inspect tessellating cells',
        '  render-graph <graph.json> [--w 900 --h 620 --out report.json]  inspect effect resolution and memory/work budgets',
        '  music audition <recipe.json> --out directory   compare audiovisual phrase variations',
        '  music arrange <arrangement.json> [--out plan.json]   compile motifs and roles into a score',
        '  music analyze <arrangement.json> [options.json]   inspect repetition, phrasing and rendered dynamics',
        '  music suggest <arrangement.json> [options.json]   propose editable and auditionable changes',
        '  music phrase <options.json>   generate a two- or four-bar melodic phrase',
        '  music production <mode> <recipe.json> [config.json]   arrange, mix, audition and render adaptive music',
        '  music production cue-map <recipe.json> [map.json]   apply or inspect a cue-wide arrangement map',
        '  music production voice-lead <recipe.json> <settings.json>   search inner lines around locked outer tracks',
        '  music production search-locked <recipe.json> <brief.json> --out DIR [--render]   search scoped arrangement edits',
        '  music production keep-locked <search.json> <selection.json> --out recipe.json   keep an editable locked take',
        '  music production compose-piece [brief.json] --out DIR [--render]   create competing 90–120 second scores',
        '  music production search <recipe.json> <brief.json>   shortlist distinct cue, phrase and note revisions',
        '  music production pocket <recipe.json> <brief.json>   compare written rhythm and microtiming independently',
        '  music production inspect-instrument <patch.json>   validate modular voice routing and modulation',
        '  music production instrument-library   list instruments, ranges and gestures',
        '  music production instrument-pack NAME [settings.json] --out DIR   export a stock instrument and its WAVs',
        '  music production play-kit <instrument.json> <performance.json> --out DIR   play a portable pad kit',
        '  music production instrument-presets   list ready-to-play phrase-aware patches',
        '  music production groove <recipe.json> [mapping.json]   transfer performance timing, accents and gates',
        '  music mix render recipe.json --out directory   render routed audio, inserts, automation and taps',
        '  music mix meter input.wav [--out report.json]   measure loudness, true peak and mono compatibility',
        '  music mix monitor input.wav --mode mono|small-speaker|stereo --out directory   audition the mix',
        '  music rack list|describe [rack]   discover built-in racks or inspect a definition',
        '  music rack state rack [settings.json] --out state.json   save recalled macro automation',
        '  music rack render|audition rack recipe.json --out directory   render a rack or compare with bypass',
        '  music rack plugin-info|plugin-state alias [settings.json] --clap-host manifest.json   inspect or save CLAP state',
        '  music instrument analyze|audition|build recipe.json --out path   turn a take bank into labeled playable zones',
        '  music instrument discover|keep-discovery file.json [selection.json] --out dir',
        '  music instrument workshop|audition-workshop|keep-workshop file.json [settings.json] --out dir',
        '  music instrument fit|audition-fit recipe.json --out dir   fit and audition editable instruments from a recording',
        '  music deliver recipe.json --out directory [--strict]   print BWF stems, M&E, loops, cue sheet and editorial timeline',
        '  music repair input.wav settings.json --out output   render before, repaired and removed dialogue',
        '  music editorial spot-foley recipe.json --out project.json   spot paired Foley takes from committed world contacts',
        '  music editorial inspect|render project.json --out output   spot and print editorial audio',
        '  music editorial edit|reconform project.json changes.json --out output   revise or preview a new cut',
        '  music groove extract <recipe.json> [--out groove.json]   measure a WAV or MIDI performance',
        '  music motif plan recipe.json --out plan.json   plan four musical roles for a single recording',
        '  music motif audition recipe.json [settings.json] --out directory   compare roles over one score window',
        '  music motif keep|render recipe.json selection.json --out directory   replay or keep an editable sample role',
        '  music timbre analyze|project|match <recipe.json> [settings.json]   derive or compare recording gestures',
        '  music timbre evolve recipe.json [settings.json] --out directory   hand off one measured sound across playable instruments',
        '  music timbre audition|arrange <recipe.json> [settings.json] --out directory   play or keep a timbre orchestration',
        '  music timbre palette <coastal|metal-breath|broken-beat> --out directory   export playable patches and PCM',
        '  music critique foreground <recipe.json> <settings.json> --out directory   compare arrangement-aware mix moves',
        '  music critique diagnose cue.json request.json --out clips   compare a masking or groove hypothesis',
        '  music critique listener-pack|listener-run|listener-score file.json [responses.json] --out path',
        '  music critique inspect <recipe.json> <request.json> --out directory   listen to and measure an addressed passage',
        '  music critique compare <recipe.json> <edits.json> --out directory   audition exact repairs against the original',
        '  music critique apply <recipe.json> <comparison.json> <decision.json> --out directory   keep the chosen edit and reason',
        '  music critique plan <recipe.json> <brief.json>   measure a passage and propose editable comparisons',
        '  music critique listen <recipe.json> <plan.json> [settings.json] --out directory   export a blind listening pack',
        '  music critique prioritize <recipe.json> <questions.json> --out directory   pick consequential blind pairs',
        '  music critique archive-ballot <memory-directory> <review-key.json> <ballot.json>   retain a judgment and its audio',
        '  music critique keep <recipe.json> <review-key.json> <decision.json> --out directory   keep a voted edit and reason',
        '  music critique remember <memory-directory> <reference.json>   archive a contextual blind decision',
        '  music critique recall <memory-directory> <query.json>   recall matching blind choices and reasons',
        '  music critique tag <source.wav> <settings.json> --out directory   keep a tagged listening excerpt',
        '  music critique find <index.json> [query.json]   find listening clips and past decisions by intent',
        '  music rehearsal capture <world.run.json> <settings.json>   capture exact world music and cue events',
        '  music rehearsal capture-score <timeline.json> <settings.json>   capture standalone clock updates',
        '  music rehearsal run <timeline.json> <suite.json> --out directory   audit and audition the same recorded traces',
        '  music rehearsal regression <timeline.json> <routes.json> --out directory [--assert version]',
        '  music rehearsal keep <timeline.json> <revision.json> [trace.json] --out recipe.json   save a timeline variant',
        '  music session audition-phrase <session.json> <settings.json> --out directory',
        '  music session arrange-performance <session.json> <brief.json> --out directory',
        '  music session performance-ballot <session.json> <brief.json> --out directory',
        '  music session record-ballot <review-key.json> <ballot.json> --out directory',
        '  music session inspect|edit|render|preview recipe.json [settings.json] --out output   comp and audition score and audio takes',
        '  music session handoff recipe.json --out directory [--clap-host manifest.json]   export a DAW project, MIDI and stems',
        '  music session play recipe.json [settings.json] [--port N] [--out kept.json]   open the shared live audition desk',
        '  music session compare recipe.json comparison.json --out clips',
        '  music session experiment|keep-experiment session.json settings.json --out dir',
        '  music session stream recipe.json   keep a warm session for JSON-line edits and auditions',
        '  music atmosphere plan recipe.json --out plan.json   arrange beds, calls and recurring gestures',
        '  music atmosphere render recipe.json [plan.json] --out directory   mix an editable plan and print atmosphere stems',
        '  music atmosphere audition recipe.json comparison.json --out directory   compare density and level over one score',
        '  music jam branch jam.json branches.json --out branched.json   fork or sweep playback treatments',
        '  music jam inspect jam.json   list branch ancestry, playback speeds and rack states',
        '  music jam render|audition|keep library jam.json settings.json --out directory   play, compare or print a passage',
        '  music jam recover library sample-id --out directory   open a print’s editable source',
        '  music gestures <ingest|generate|search|audition|keep> <library> <recipe or query>   build and audition a searchable gesture bank',
        '  music gestures inspect <library> [session]   inspect sessions, takes and aligned recordings',
        '  music samples <add|search|get> <library> [recipe or ID]   capture and find reusable samples',
        '  music samples <slice|edit|render|audition> <library> <ID or project> [settings.json]   edit sample audio',
        '  music samples warp <library> <ID or project> settings.json --out directory   warp or repitch sample audio',
        '  music samples kit <library> kit.json performance.json --out directory   play a sample kit and export its stems',
        '  music samples print <library> recipe.json --out directory   print dry and/or wet graph taps as reusable samples',
        '  music pads program pattern.json [settings.json] --out performance.json   resolve a pad pattern',
        '  music pads compose score.json --out performance.json [--report trace.json]   compose recorded slices',
        '  music pads capture recording.json routes.json --out performance.json   capture timestamped pad pulses',
        '  music pads edit performance.json edits.json --out revised.json   edit captured hits by ID',
        '  music soundfont <file.sf2> <preset.json> --out directory   sample a SoundFont preset with FluidSynth',
        '  music revise <plan.json> <edits.json> [--out revised.json]   revise unpinned parts and bindings',
        '  music reference <plan.json> --part ID --section ID [--out motif.json]   recover an audition idea',
        '  patch help   edit, wire, inspect and run typed audiovisual patches from the CLI',
        '  story validate|describe|preview <file.json> [story-id]   validate or inspect versioned story definitions',
        '  story describe <file.json> [story-id] --inventory      list role schemas and required interfaces',
        '  story preview <file.json> [story-id] [--format json|text|dot] [--out file] [--strict]   export potential story routes',
        '  story instantiate <template.json> <instance.json>   expand typed story parameters and inspect the result',
        '  sim preflight <world.json> [--strict]   check world bindings and story routes before stepping',
        '  sim scheduler <world|checkpoint|run> [--ticks N] [--incident document/story]   explain incident eligibility and commitments',
        '  sim why|why-not <world|checkpoint|run> document/story [--offer | --role ID | --actor system/agent | --stage [ID] | --outcome ID]',
        '    [--spec casting.json] [--ticks N] [--trace]   explain an offer, actor, stage, or ending',
        '    sim run|preflight <world.json> --storyteller ID   select an authored incident profile',
        '  story catalog <story.json> [story.json ...]   discover authored incidents',
        '  story events <recording> [--format json|markdown|timeline|events]   inspect or present recorded story events',
        '  sim cast <world|checkpoint|run> --spec casting.json   explain who qualifies for a story role',
        '  patch show <cues.json> [--rehearse] [--report file]   run a cue-driven patch on a projector',
        '  graph nodes [--json]   list registered graph operations and their ports',
        '  graph describe <op> [--json | --example]   show schema, units, limits and a runnable example',
        '  graph validate|plan <project.json> [--inputs values.json]   validate and describe a headless graph',
        '    graph plan --memory   estimate peak raster buffers before execution',
        '  graph dependencies <project.json> [--json]   list direct and nested group files and pins',
        '  graph impact <group.json> [--root folder] [--json]   find consumers of a shared group',
        '  graph snapshot <project.json> [--inputs values.json] [--seed N] [--at T]   capture graph bindings and asset hashes',
        '  graph diff <before.json> <after.json> [--json]   explain node, port and named output changes',
        '  graph inspect <project.json> [--output NAME | --node PATH --port NAME] [--out directory]',
        '  graph run <project.json> [--inputs values.json --at seconds --seed N --out directory]',
        '    run, inspect, batch, clip, session: --workers N   schedule eligible branches on 1–8 workers',
        '    run, inspect, batch, clip: --cache DIR [--cache-bytes N --cache-entries N]   reuse graph artifacts on disk',
        '  graph clip <project.json> --output NAME --from FRAME --to FRAME --out directory',
        '    [--fps N|N/D --warmup FRAMES --cuts FRAME,FRAME --format frames|apng|both|sample --clock file.json --render-options file.json]',
        '    --format sample [--capture-options file.json]   retain a reusable visual span with aligned planes',
        '  graph batch <project.json> <cases-or-sweep.json> [--out directory]   run named cases or a Cartesian sweep',
        '    --resume --out directory   keep verified cases and retry failures',
        '    --progress ndjson   stream case and batch records',
        '  graph capture <request.json> [--adapters host.cjs --out file]   capture or send via a registered host adapter',
        '  graph inspect-pxc <project.pxc> [--out info.json]   inspect a Pixel Composer container',
        '  graph import-pxc <project.pxc> --out graph.json [--translate | --adapters host.cjs --using ID]   import saved art or translate editable nodes',
        '  graph session <project.json> [--protocol ndjson --out directory]   serve requests using a warm graph',
        '  material-controls <material.json> [--palette colors.json --out report.json]  inspect shared material controls',
        '  light-emitters <lights.json> [--at seconds --out report.json]  inspect shaped lights and cookies',
        '  typography <type.json> [--font font.ttf --at seconds --out report.json]  inspect glyph layout and animation',
        '  camera-impulses <motion.json> [--at seconds --eye x,y,z --yaw radians --pitch radians --out report.json]  inspect camera motion',
        '  camera-rig <scene or world> [--at seconds --camera-shot ID --out report.json]  sample a shot and its clearance',
        '  take sample <take.json> --frame N [--iteration N --resume checkpoint.json --checkpoint file.json --out report.json]',
        '  take render-av <recipe.json> --out directory   publish synchronized picture controls, PNGs and WAV',
        '  timeline <scene> [--at seconds] [--from seconds --to seconds] [--out report.json]  sample tracks and export cues',
        '  authored-contacts <id> [--at seconds] [--out report.json]  inspect contact ranges and socket transfer timing',
        '  motion-fx <id> [--at seconds] [--out report.json]  inspect keyed FX layers and sampled effect output',
        '  cloth-review <id> [--pose seconds] [--through seconds] [--bake take.json]  preview a cloth pose and optionally bake it',
        '  animation-timeline <id> [--state context.json] [--stage block|spline|polish] [--at seconds] [--part name]',
        '    [--loop start,end|off] [--finding kind-or-id|off] [--direction index] [--fix accept|mute|enable|remove]',
        '    [--preview directory] [--frames count --w width --h height] [--before] [--out report.json]',
        '  retarget <source> <target> [--clip name|--motion clip.json] [--profile name|file.json]',
        '    [--source-map file.json --target-map file.json] [--travel scaled|unscaled|in-place] [--fps rate]',
        '    [--bake clip.json] [--preview directory] [--at seconds|--frames count] [--direction index] [--out report.json]',
        '  retarget --profiles  show built-in role templates',
        '  passes <id> [--channels depth,normal,part-motion,strands] [--previous seconds]   save art-pixel render passes',
        '  strand-pixel <id> --at x,y [--t seconds] [--previous seconds]   inspect visible strand hits on the native art grid',
        '  strand-review <id> --w 160 --h 96 [--curve-quality file.json] [--from 0 --to 3 --camera-orbit 20] [--out directory]',
        '  export-layers <id> [--t 0,1,2 | --from 0 --to 2 --n 3] [--part-motion on] [--compositing file.json] [--out directory]   export RGBA and compositing layers',
        '  export-scene <scene|world|take> --out directory [--formats still,loop,replay,embed]',
        '    --audio soundtrack.json [--mux CODEC --adapters host.cjs]   export aligned WAV stems and optional video',
        '    --loop-join   inspect the actual frame join and excluded endpoint on a clip or scene export',
        '    --w width --h height --still-scale 2 --t seconds --from 0 --to 2 --fps 12 --embed-config file.json',
        '  scene-replay <recording.json> --out output.png [--at seconds]   save a frame from a replay',
        '  scene-replay <recording.json> --embed --out embed.html [--embed-config file.json]   package a replay for the web',
        '  project pack <scene-take-or-experiment.json> --out <bundle.json> [--root directory --revision n --asset-pack file --paint file --attachments file]',
        '  project inspect <bundle.json>   show the bundle version, entry path and retained files',
        '  project unpack <bundle.json> --out new-directory   extract a portable project',
        '  project verify <experiment-bundle.json> [--out report.json --compare-engine]   replay packaged simulation checks',
        '  environment-parity [--fixture observatory --out directory --chrome executable]  compare matched CLI and WebGL environment frames',
        '  passes <id> --channels environment --px1   export sky, fog transmittance, precipitation, reflections and foreground coverage',
        '  render|sheet|clip <id> or sim render <file> --passes environment   write environment passes beside the export',
        '  render|sheet|clip <id> --look pack/look|file.json|off [--passes target,mask,materialId]',
        '    --look-select JSON --look-params JSON --look-strength N   override an asset binding for the preview',
        '  shimmer <id> [--mode orbit|zoom|pan|still --frames 24]  how many pixels flicker over a move, and a GIF of it',
        '  crisp <id ...|all> [--t 2 --map]   how crisp at its own pixel size: stray pixels, specks, flat area, finest frequencies,',
        '                              against the pixel-art references (--map: where the stray pixels and drawn edges are)',
        '',
        'any command that plays a diorama takes --poke 2:x,y,z (tap it at 2 seconds, toward that point; several with ;)',
        'sun options: --live-sun on|off --sun-direction x,y,z --sun-ambient n --sun-intensity n --shadow-map-size n --shadow-bias n --sun-shadows off',
        'shadow art: --shadow-art file.json|off for baked JSON scenes and live sun',
        'color clusters: --color-clusters file.json|off for material-specific cluster size, grain and protection',
        'pass quality: --pass-quality file.json|off for background, particles and secondary reflections',
        'shot lighting: --shot-lighting on|off|file.json   scope key, fill, rim and negative fill',
        'reflection detail: --reflection-detail on|off   compare the authored core, streaks and distance clusters',
        'brushwork: --brushwork on|off   compare surface-aligned paint at export size',
        'shadow bands: --shadow-band-paint on|off   compare painted lighting thresholds',
        'detail-preserving relighting: --relighting on|off|file.json --sky-time seconds',
        'bounce options: --sky-bounce color|preset|off --ground-bounce color|preset|off --sky-bounce-intensity n --ground-bounce-intensity n',
        'cloud options: --cloud-field cirrus|coastal-stratus|cumulus|storm-front|file.json|off --cloud-representation auto|card|impostor|volume|off --cloud-self-shadows on|off --cloud-shadows on|off --cloud-shadow-strength 0..1 --cloud-shadow-softness units',
        'translucent silhouette options: --translucent-silhouettes file.json|off',
        'curve splats: render or clip a curve-splat-scene JSON with --curve-mode splats|curves. --curve-splats off shows the legacy carriers.',
        '    --curve-width file.json|off   art-pixel width rules for curve materials',
        '    --curve-lod on|off   authored curve distance simplification and aggregation',
        'motional pixel coverage: --motional-coverage on|off|file.json',
        'celestial options: --celestial-tracks on|off|file.json',
        'sky options: --sky-environment file.json|off --sky-time seconds --sky-profile track=profile --sky-transitions file.json|off --sky-reflections scene|material',
        'weather options: --weather-binding on|off|file.json --retained-weather on|off --weather-fronts on|off --weather-tracks on|off --world-precipitation on|off|file.json --rain-impacts on|off|file.json',
        'wind options: --wind-field on|off|file.json',
        'lightning options: --lightning on|off|file.json',
        'exposure options: --scene-exposure on|off|file.json',
        'aerial options: --aerial-perspective on|off --aerial-start units --aerial-density per-unit --aerial-contrast 0..1',
        'view options: --surface off (no finish layers) --facing-colors off --directional-colors off --water off --reflections off --reflection-probes off --transmission off --surface-detail-kits off --atmosphere off --edges off (no edge sprites) --yaw --pitch --zoom 2 --target x,y,z --w 900 --h 620 --px 2 (screen pixels per art pixel) --px1 (native art pixels) --tone stipple|off --raw (no palette) --colored (smooth body-colored contours) --fine (inked detail: colours looked up per pixel) --bounce (bounce light baked in) --focus x,y,z[,near,far,coarse] (uneven detail) --follow [stretch,broad] (dabs along the form) --adaptive-sampling on|off|file.json --clean (remove lone pixels) --camera-shot id --ortho [on|off] (override authored projection) --cols 4 --out file.png --seed n',
        'socket emitter options: --atmosphere-emitters on|off|file.json',
        'animated splat options: --splat-fields on|off|file.json',
        'sprite options: --sprite-atlas on|off|atlas.json --sprite-at x,y,z --sprite-scale n --sprite-atlas-mode card|impostor|scenery --sprite-reconstruction auto|geometry|sprite',
        '                --sprite-cels edits.json|off --sprite-playback once|loop',
        'shaped fog options: --shaped-atmosphere on|off|file.json --volume-cutouts on|off|file.json',
        'atmosphere bands: --atmosphere-depth-bands on|off|file.json',
        'shoreline options: --shore-foam on|off',
        'lighting options: --highlight-cels on|off --cutout-shadows on|off --shadow-shells on|off --volume-local-lights on|off --volume-local-shadows on|off',
        'silhouette protection: --silhouette-protection on|off|file.json',
        'layered horizon: --horizon-bands on|off|file.json',
        'staging: --fov radians | --focal-length mm [--sensor-height mm] --focus-distance units --composition u,v --camera-staging on|off|file.json --camera-guides [on|off] --depth-of-field [on|off]',
        'art direction: --art-direction on|off|painted-pixel|storm-silhouette|soft-dawn|file.json',
        'shared rendering: --strict-contract [on|off] --step-animation [on|off]',
        'effect palette options: --effect-palettes on|off|file.json',
        'art options: --palette-remap off --color-curves off --lut <file.cube|file.json|off> --color-stack <file.json|off> --ink on|off|file.json --effects off --emissive-finishes off --stable on|off|file.json --stable-detail on|off|file.json --edge-filter on|off|file.json --contact-shadows on|off|file.json --area-lights on|off|file.json --bounce-probes on|off|file.json --snap on|off --dither-space screen|world|object|view --dither-spacing n --dither-origin x,y,z --resolve native|coverage|clusters --splat-order center|surface --splat-coverage legacy|continuous|soft --splat-footprints on|off --palette-sampling off --render-grid hex|triangle|diamond|off --grid-size 8 --grid-angle 0 --grid-aspect 1 --grid-gap 0 --grid-origin x,y --sdf-assist on|off|file.json --stable-transparency on|off|blend --fragment-budget N --inspection file.json|off --inspection-focus id --composite file.json|off --cutaway file.json|off --render-graph file.json|off --shutter on|off|file.json --afterimages file.json|off --reconstruction file.json|off --volume-scale 2 --volume-steps 8 --volume-jitter off|blue-noise|spatiotemporal'
      ].join('\n')
    );
  },
  hierarchy() {
    return require('./hierarchy.js')(pos,opt,lib());
  },
  curve() {
    return require('./curve.js')(pos, opt, lib());
  },
  ornament() {
    return require('./ornament.js')(pos, opt, lib(), outputFile);
  },
  palette() {
    if (pos[0] === 'plot') return require('./palette-plot.js')(pos.slice(1), opt, lib(), outputFile);
    if (pos[0] === 'fit') return require('./palette-fit.js').fit(pos.slice(1), opt, lib(), outputFile);
    if (pos[0] === 'dither-review') return require('./palette-fit.js').review(pos.slice(1),opt,lib(),outputFile);
    if (pos[0] === 'check') {
      if (pos.length!==3 || ['out','w','h','px','cols','t'].some(key=>opt[key]===true))
        die('Use palette check <scene> <plan.json> [--w N --h N --px N --cols N] [--out directory]');
      const [,scene,source]=pos;
      const plan=JSON.parse(fs.readFileSync(path.resolve(source),'utf8'));
      const directory=outputFile('palette-checks'), files={board:'board.png',report:'report.json'};
      const inputs=[scene,source].map(name=>fs.statSync(path.resolve(name),{throwIfNoEntry:false})).filter(Boolean);
      for (const name of Object.values(files)) {
        const existing=fs.statSync(path.join(directory,name),{throwIfNoEntry:false});
        if (existing && inputs.some(input=>input.dev===existing.dev && input.ino===existing.ino))
          die('Choose palette check outputs separate from the scene and plan');
      }
      const {image,report}=require('./palette-checks.js').checkPaletteShot(buildPreview(scene),{
        plan,pose,view:view({t:num('t',0),transparent:onOffOption('transparent')}),
        width:num('w',160),height:num('h',96),columns:num('cols')
      });
      fs.mkdirSync(directory,{recursive:true});
      PNG.write(path.join(directory,files.board),image.w,image.h,image.rgb);
      fs.writeFileSync(path.join(directory,files.report),JSON.stringify({...report,files},null,2)+'\n');
      console.log(report.summary.passed,'checks passed,',report.summary.failed,'failed. Wrote',directory);
      for (const check of report.checks) if (!check.passed)
        console.error(check.id + ' failed in ' + check.failed + ' of ' + check.evaluations + ' samples');
      if (!report.passed) process.exitCode=2;
      return;
    }
    if (pos[0] === 'save-look') {
      if (pos.length !== 2 || Object.entries(opt).some(([key,value])=>!['pack','out'].includes(key) || typeof value !== 'string'))
        die('Use palette save-look <approved.json> [--pack pack.json] [--out pack.json]');
      const source = path.resolve(pos[1]), inputs = [];
      function read(file) {
        inputs.push(fs.statSync(file));
        return JSON.parse(fs.readFileSync(file,'utf8'));
      }
      const approved = read(source);
      for (const [field,key] of [['palette','reference'],['ramp','review'],['ramp','approved'],['dither','review']])
        if (typeof approved?.[field]?.[key] === 'string')
          approved[field][key] = read(path.resolve(path.dirname(source),approved[field][key]));
      const pack = opt.pack === undefined ? undefined : JSON.parse(fs.readFileSync(path.resolve(opt.pack),'utf8'));
      const result = lib().KIT.authoring.assetPacks.savePaletteLook(approved,pack);
      const output = opt.out && outputFile('palette-look.json');
      const existing = output && fs.statSync(output,{throwIfNoEntry:false});
      if (existing && inputs.some(input=>input.dev===existing.dev && input.ino===existing.ino))
        die('Write the pack separately from the approval and analysis reports');
      return require('./look.js').write([JSON.stringify(result,null,2)+'\n'],output);
    }
    if (pos[0] === 'compare') {
      if (pos.length !== 3 || ['out','t','cols','threshold','heatmap-max','region-limit'].some(key=>opt[key]===true))
        die('Use palette compare <scene|checkpoint> <palettes.json> [--out directory]');
      const [,scene,plan] = pos;
      const palettes = JSON.parse(fs.readFileSync(path.resolve(plan),'utf8'));
      const requested = num('t',0);
      if (!Number.isFinite(requested)) die('Palette comparison time must be finite');
      const snapshot = worldCLI().lookSnapshot(scene);
      const world = snapshot ? require('./look-preview.js').override(snapshot,opt,lib()) : buildPreview(scene);
      const t = snapshot?.lookSnapshot?.time ?? requested;
      if (!snapshot) pose(world,t);
      const {reference,alternatives,report,image} = require('./palette-compare.js').compareShotPalettes(world,view({
        w:num('w',280),h:num('h',160),t,transparent:onOffOption('transparent'),palettes,columns:num('cols',3),
        threshold:num('threshold'),heatmapMax:num('heatmap-max'),regionLimit:num('region-limit')
      }));
      const directory = outputFile('palette-comparison');
      const files = {'comparison.png':image,'reference.png':reference};
      for (const [i,{id,image,heatmap}] of alternatives.entries()) {
        const prefix = String(i+1).padStart(2,'0')+'-'+id;
        const artwork = prefix+'.png', error = prefix+'-error.png';
        files[artwork] = image;
        files[error] = heatmap;
        report.alternatives[i].files = {artwork,error};
      }
      report.files = {comparison:'comparison.png',reference:'reference.png'};
      const inputs = [scene,plan].map(file=>fs.statSync(path.resolve(file),{throwIfNoEntry:false})).filter(Boolean);
      for (const name of [...Object.keys(files),'comparison.json']) {
        const existing = fs.statSync(path.join(directory,name),{throwIfNoEntry:false});
        if (existing && inputs.some(input=>input.dev===existing.dev && input.ino===existing.ino))
          die('Choose palette comparison outputs separate from the inputs');
      }
      fs.mkdirSync(directory,{recursive:true});
      for (const [name,{w,h,rgb,alpha}] of Object.entries(files)) PNG.write(path.join(directory,name),w,h,rgb,alpha);
      fs.writeFileSync(path.join(directory,'comparison.json'),JSON.stringify(report,null,2)+'\n');
      console.log('wrote matched palette comparison to',directory);
      return;
    }
    if (pos[0] === 'stages') {
      if (pos.length!==2 || ['select','allowed','hue-threshold','min-chroma','limit','t','out'].some(key=>opt[key]===true))
        die('Use palette stages <scene> [--select JSON] [--allowed JSON] [--out directory]');
      const t=num('t',0);
      if (!Number.isFinite(t)) die('Palette stage time must be finite');
      const world=buildPreview(pos[1]);
      pose(world,t);
      const {rasters,report,image}=require('./palette-stages.js').reviewPaletteStages(world,view({
        w:num('w',240),h:num('h',150),t,transparent:onOffOption('transparent'),
        select:opt.select===undefined ? undefined : JSON.parse(opt.select),
        allowed:opt.allowed===undefined ? undefined : JSON.parse(opt.allowed),
        hueThreshold:num('hue-threshold',22),minChroma:num('min-chroma',.025),limit:num('limit',12)
      }));
      const directory=outputFile('palette-stages'), files={comparison:'comparison.png',report:'stages.json'};
      for (const [name,frame] of Object.entries(rasters)) if (frame) files[name]=name+'.png';
      const input=fs.statSync(path.resolve(pos[1]),{throwIfNoEntry:false});
      for (const name of Object.values(files)) {
        const existing=fs.statSync(path.join(directory,name),{throwIfNoEntry:false});
        if (existing && input && existing.dev===input.dev && existing.ino===input.ino)
          die('Choose stage output files separate from the scene');
      }
      fs.mkdirSync(directory,{recursive:true});
      for (const [key,frame] of Object.entries({...rasters,comparison:image})) {
        if (frame) PNG.write(path.join(directory,files[key]),frame.w,frame.h,frame.rgb,frame.alpha);
      }
      fs.writeFileSync(path.join(directory,files.report),JSON.stringify({...report,files},null,2)+'\n');
      console.log('wrote render-stage palette review to',directory);
      return;
    }
    if (['readability','weather','darks'].includes(pos[0])) {
      const weather=pos[0]==='weather', darks=pos[0]==='darks';
      if (pos.length!==2 || ['plan','select','directions','pitches','t','times','w','h','cols','out']
        .some(key=>opt[key]===true) || darks && opt.select!==undefined)
        die('Use palette '+pos[0]+' <scene> '+(darks ? '[--plan file.json]' : '[--select JSON | --plan file.json]')+
          ' [--directions N --times t1,t2] [--out directory]');
      const world=buildPreview(pos[1]), settings=view({t:num('t',0),transparent:onOffOption('transparent')});
      const authored=weather ? world.paletteWeatherReview : darks ? world.shadowReadability : world.readabilityReview;
      const source=opt.plan===undefined ? authored??{} : JSON.parse(fs.readFileSync(path.resolve(opt.plan),'utf8'));
      if (!source || Object.getPrototypeOf(source)!==Object.prototype) die('Review plan needs a JSON object');
      const plan={...source};
      if (opt.select!==undefined) plan.subjects=[{id:'Subject',select:JSON.parse(opt.select)}];
      if (opt.times!==undefined) {
        plan.states=list('times').map(time=>({id:time+' s',time}));
        if (weather && !plan.states.some(state=>state.id===plan.baseline)) delete plan.baseline;
      }
      if (opt.directions!==undefined || opt.pitches!==undefined) {
        const angles=require('./sprite-atlas.js').exportViews(world,{directions:num('directions',8),yaw:settings.yaw,
          pitch:settings.pitch,pitches:opt.pitches===undefined ? undefined : list('pitches')});
        plan.views=angles.map(({yaw,pitch},i)=>({id:'View '+(i+1),yaw,pitch}));
      }
      const run=weather ? require('./palette-weather.js').reviewPaletteWeather :
        darks ? require('./shadow-readability.js').reviewShadowReadability : require('./readability-review.js').reviewSubjectReadability;
      const {image,report}=run(world,{
        plan,view:settings,pose,width:num('w',160),height:num('h',96),columns:num('cols')
      });
      const directory=outputFile(weather ? 'palette-weather' : darks ? 'shadow-readability' : 'readability-review');
      const files={comparison:'comparison.png',report:'review.json'};
      const sources=[pos[1],opt.plan].filter(Boolean).map(name=>fs.statSync(path.resolve(name),{throwIfNoEntry:false}));
      for (const name of Object.values(files)) {
        const file=fs.statSync(path.join(directory,name),{throwIfNoEntry:false});
        if (file && sources.some(source=>source && source.dev===file.dev && source.ino===file.ino))
          die('Choose review output files separate from the scene and plan');
      }
      fs.mkdirSync(directory,{recursive:true});
      PNG.write(path.join(directory,files.comparison),image.w,image.h,image.rgb);
      fs.writeFileSync(path.join(directory,files.report),JSON.stringify({...report,files},null,2)+'\n');
      console.log('wrote',weather ? 'palette weather review to' : darks ? 'shadow readability review to' : 'subject readability review to',directory);
      return;
    }
    if (pos[0] === 'shimmer') {
      if (pos.length!==2 || ['from','to','fps','out','window','min-delta','min-coverage','w','h']
        .some(key=>opt[key]===true) || ['animate','include-view'].some(key=>opt[key]!==undefined&&opt[key]!==true))
        die('Use palette shimmer <scene> [--from 0 --to 3 --fps 12] [--include-view] [--animate] [--out directory]');
      const world=buildPreview(pos[1]), fps=num('fps',12), directory=outputFile('palette-shimmer');
      const playback=opt.animate && [];
      const {image,report}=require('./palette-shimmer.js').reviewPaletteShimmer(world,{
        from:num('from',0),to:num('to',3),fps,window:num('window',3),minDelta:num('min-delta',.025),
        minCoverage:num('min-coverage',.8),width:num('w',160),height:num('h',96),
        includeView:opt['include-view']===true,
        view:view({transparent:onOffOption('transparent')}),pose,camera:clipCamera(world)??undefined,
        onFrame:playback ? frame=>playback.push(PNG.packFrame(frame)) : undefined
      });
      const files={comparison:'comparison.png',...(playback && {playback:'playback.png'})};
      fs.mkdirSync(directory,{recursive:true});
      PNG.write(path.join(directory,files.comparison),image.w,image.h,image.rgb);
      if (playback) fs.writeFileSync(path.join(directory,files.playback),PNG.encodeAnimation(playback,fps));
      fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify({...report,files},null,2)+'\n');
      console.log('wrote palette shimmer review to',directory);
      return;
    }
    if (pos[0] === 'chart') return require('./palette-chart.js')(pos.slice(1), opt, lib(), outputFile);
    if (pos[0] === 'pairs') return require('./palette-pairs.js')(pos.slice(1),opt,lib(),outputFile);
    if (pos[0] === 'inspect') {
      if (pos.length !== 2 || typeof opt.at !== 'string' || !/^\d+\s*,\s*\d+$/.test(opt.at) ||
          ['t','out'].some(key=>opt[key] === true))
        die('Use palette inspect <scene> --at x,y [--out report.json]');
      const t = num('t',0);
      if (!Number.isFinite(t)) die('Palette pixel inspection time must be finite');
      const world = buildPreview(pos[1]);
      pose(world,t);
      const report = require('./palette-pixel.js').inspectPalettePixel(world,
        view({t,at:list('at'),transparent:onOffOption('transparent')}));
      const json = JSON.stringify(report,null,2)+'\n';
      if (!opt.out) return process.stdout.write(json);
      const file = outputFile('palette-pixel.json');
      if (file === path.resolve(pos[1])) die('Choose a report path separate from the scene');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,json);
      return;
    }
    if (pos[0] === 'error') {
      if (pos.length !== 2 || ['threshold','heatmap-max','region-limit','t','out'].some(key=>opt[key] === true))
        die('Use palette error <scene> [--threshold .06] [--heatmap-max .20] [--region-limit 20] [--out directory]');
      const t = num('t',0);
      if (!Number.isFinite(t)) die('Palette error review time must be finite');
      const world = buildPreview(pos[1]);
      pose(world,t);
      const result = require('./palette-error.js').reviewQuantizationError(world,view({ t,
        transparent:onOffOption('transparent'), threshold:num('threshold',.06),
        heatmapMax:num('heatmap-max',.20),regionLimit:num('region-limit',20) }));
      const directory = outputFile('palette-error');
      const files = Object.fromEntries(['graded','resolved','heatmap'].map(key=>[key,key+'.png']));
      fs.mkdirSync(directory,{recursive:true});
      for (const [key,name] of Object.entries(files)) {
        const {w,h,rgb,alpha} = result[key];
        PNG.write(path.join(directory,name),w,h,rgb,alpha);
      }
      fs.writeFileSync(path.join(directory,'error.json'),JSON.stringify({...result.report,files},null,2)+'\n');
      console.log('wrote palette error review to',directory);
      return;
    }
    if (pos[0] === 'distributions') {
      const scene=opt.scene, render=opt.render;
      if (pos.length!==2 || Boolean(scene)===Boolean(render) ||
          ['scene','render','settings','bins','alpha','out','t'].some(key=>opt[key]===true))
        die('Use palette distributions <reference.png> [--scene scene | --render frame.png] [--out directory]');
      const source=path.resolve(pos[1]), directory=outputFile('palette-distributions');
      const files={report:path.join(directory,'distributions.json'),preview:path.join(directory,'comparison.png')};
      const inputs=[source,render ?? scene].map(name=>fs.statSync(path.resolve(name),{bigint:true,throwIfNoEntry:false}));
      for (const file of Object.values(files)) {
        const prior=fs.statSync(file,{bigint:true,throwIfNoEntry:false});
        if (prior && inputs.some(input=>input && input.dev===prior.dev && input.ino===prior.ino))
          die('Choose output files separate from the reference and render inputs');
      }
      const settings=opt.settings===undefined ? {} : JSON.parse(fs.readFileSync(path.resolve(opt.settings),'utf8'));
      if (!settings || typeof settings!=='object' || Array.isArray(settings)) die('Palette distribution settings need a JSON object');
      const analysis={...settings,...(opt.bins!==undefined && {bins:num('bins')}),...(opt.alpha!==undefined && {alpha:opt.alpha})};
      let frame=render, shot;
      if (scene) {
        const t=num('t',0);
        if (!Number.isFinite(t)) die('Palette distribution time must be finite');
        const world=buildPreview(scene);
        pose(world,t);
        frame=R.render(world,view({t,transparent:onOffOption('transparent')}));
        shot={scene:world.id ?? scene,time:t,pixelSize:frame.px};
      }
      const {report,image}=require('./palette-distributions.js').comparePaletteDistributions(source,frame,analysis);
      if (shot) report.studio.shot=shot;
      report.preview={file:'comparison.png',width:image.w,height:image.h};
      fs.mkdirSync(directory,{recursive:true});
      PNG.write(files.preview,image.w,image.h,image.rgb);
      fs.writeFileSync(files.report,JSON.stringify(report,null,2)+'\n');
      console.log('wrote',files.preview,'and',files.report);
      return;
    }
    if (pos[0] === 'ramp-review') {
      const scene = opt.scene, role = opt.role;
      if (pos.length>2 || (!pos[1] && (!scene || !role)) || (role && (!scene || pos[1])) ||
          (opt.pixels !== undefined && !scene) ||
          ['scene','role','pixels','positions','direction','max-deviation','max-gap','reversal-tolerance','out','t']
            .some(key=>opt[key]===true))
        die('Use palette ramp-review [ramp.json] [--scene scene --role name] [--pixels JSON] [--out report.json]');
      const source = pos[1] && path.resolve(pos[1]);
      const input = source ? JSON.parse(fs.readFileSync(source,'utf8')) : {};
      const definition = Array.isArray(input) ? {stops:input} : input;
      const settings = { ...definition, ...(opt.positions !== undefined && {positions:JSON.parse(opt.positions)}),
        ...(opt.direction !== undefined && {direction:opt.direction}),
        ...(opt['max-deviation'] !== undefined && {maxDeviation:num('max-deviation')}),
        ...(opt['max-gap'] !== undefined && {maxGap:num('max-gap')}),
        ...(opt['reversal-tolerance'] !== undefined && {reversalTolerance:num('reversal-tolerance')}) };
      let report;
      if (scene) {
        const t = num('t',0);
        if (!Number.isFinite(t)) die('Ramp review time must be finite');
        const world = buildPreview(scene);
        pose(world,t);
        const pixels = opt.pixels === undefined ? undefined : JSON.parse(opt.pixels);
        report = require('./ramp-review.js').reviewRampShot(world,view({ ...settings,role,pixels,t,
          transparent:onOffOption('transparent') }));
      } else report = lib().KIT.palette.reviewRamp(settings);
      const json = JSON.stringify(report,null,2)+'\n';
      if (!opt.out) return process.stdout.write(json);
      const file = outputFile('ramp-review.json');
      if (file === source || scene && file === path.resolve(scene)) die('Choose an output separate from the ramp and scene inputs');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,json);
      return;
    }
    if (pos[0] === 'usage') {
      if (pos.length !== 2 || ['select','rare-pixels','rare-share','t','out'].some(key=>opt[key] === true))
        die('Use palette usage <scene> [--select JSON] [--rare-pixels 3] [--rare-share .001] [--out report.json]');
      const t = num('t',0);
      if (!Number.isFinite(t)) die('Palette usage time must be finite');
      const select = opt.select === undefined ? undefined : JSON.parse(opt.select);
      const world = buildPreview(pos[1]);
      pose(world,t);
      const report = require('./palette-usage.js').paletteUsage(world,view({t,select,transparent:onOffOption('transparent'),
        rarePixels:num('rare-pixels',3),rareShare:num('rare-share',.001)}));
      const json = JSON.stringify(report,null,2)+'\n';
      if (!opt.out) return process.stdout.write(json);
      const file = outputFile('palette-usage.json');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,json);
      return;
    }
    if (pos[0] === 'extract') {
      if (pos.length !== 2 || Object.entries(opt).some(([key,value])=>!['size','alpha','out'].includes(key) || value === true))
        die('Use palette extract <reference.png> [--size 32] [--alpha visible|opaque|all] [--out report.json]');
      const source = path.resolve(pos[1]);
      const report = require('../index.js').readReferencePalette(source,{size:num('size',32),alpha:opt.alpha});
      const json = JSON.stringify(report,null,2)+'\n';
      if (!opt.out) return process.stdout.write(json);
      const file = outputFile('reference-palette.json');
      const input = fs.statSync(source), output = fs.statSync(file,{throwIfNoEntry:false});
      if (output && input.dev === output.dev && input.ino === output.ino)
        die('Write the palette report to a separate file from the reference image');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,json);
      return;
    }
    if (pos[0] === 'lighting') {
      if (pos.length !== 2 || (opt.approve !== undefined && opt.approve !== true) || opt.out === true)
        die('Use palette lighting <source-or-draft.json> [--approve] [--out file.json]');
      const input = JSON.parse(fs.readFileSync(path.resolve(pos[1]), 'utf8'));
      const api = lib().KIT.palette.lightingRamps;
      const data = opt.approve ? api.approve(input) : api.suggest(input);
      const json = JSON.stringify(data,null,2)+'\n';
      if (!opt.out) return process.stdout.write(json);
      const file = outputFile(opt.approve ? 'lighting-roles.json' : 'lighting-draft.json');
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,json);
      return;
    }
    if (pos[0] === 'field') {
      if (pos.length !== 2 || ['t', 'w', 'h', 'saturation', 'view', 'out', 'format'].some(key => opt[key] === true))
        die('Use palette field <field.json> [--t seconds] [--saturation 0–1] [--view nearest|error|boundary] [--format png|data] [--w width --h height --out file]');
      const input = JSON.parse(fs.readFileSync(path.resolve(pos[1]), 'utf8'));
      if (!input || Array.isArray(input) || typeof input !== 'object') die('A palette field needs a JSON object');
      const { type = 'hue-brightness', ...definition } = input;
      const ramp = ['spectrum','primary','grayscale'].includes(type);
      const chroma = ['complementary','desaturation'].includes(type);
      if (!ramp && !chroma && !['hue-brightness','polar','coverage'].includes(type))
        die('Palette field type must be hue-brightness, polar, coverage, complementary, desaturation, spectrum, primary or grayscale');
      if (opt.view !== undefined) {
        if (type !== 'coverage') die('--view applies to coverage fields');
        definition.view = opt.view;
      }
      if (opt.saturation !== undefined) definition.saturation = num('saturation');
      const polar = type === 'polar', api = lib().KIT.palette;
      const compile = type === 'hue-brightness' ? api.hueBrightness : api[type];
      const field = ramp ? api.ramp({type,...definition}) : chroma ? api.chromaField({type,...definition}) : compile(definition);
      const time = num('t',0);
      if (!Number.isFinite(time)) die('Palette field time must be finite');
      const current = field.frame?.(time) ?? field;
      const format = opt.format ?? 'png', width = num('w', polar ? 128 : 192);
      if (format === 'data' && type === 'grayscale') {
        const json = JSON.stringify(current.report(width),null,2)+'\n';
        if (!opt.out) { process.stdout.write(json); return; }
        const file = outputFile('grayscale-ramp.json');
        fs.mkdirSync(path.dirname(file),{recursive:true});
        fs.writeFileSync(file,json);
        return;
      }
      if (format !== 'png') die('Palette fields use PNG, or data for a grayscale report');
      const image = current.raster(width, num('h', polar ? 128 : ramp ? 32 : 96));
      const name = ramp ? type+'-ramp' : chroma ? type+'-field' : polar ? 'polar-colour' : type === 'coverage' ? 'palette-coverage' : 'hue-brightness';
      save(name+'.png',image,image.alpha);
      return;
    }
    if (!pos[0]) die('palette needs a recipe, path or animation JSON file');
    const definition = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
    const api = lib().KIT.palette, time = num('t', 0);
    if (!Number.isFinite(time)) die('palette time must be finite');
    const result = definition.keys ? api.animate(definition).sample(time) :
      definition.anchors ? api.recipe(definition) : api.path(definition);
    const report = { palette: result.palette ?? result.hex, rgb: result.rgb,
      ...(result.roles && { roles: result.roles, ramps: result.ramps }),
      ...(result.time !== undefined && { time: result.time, phase: result.phase }) };
    const json = JSON.stringify(report, null, 2) + '\n';
    if (opt.out) { const file = path.resolve(opt.out); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, json); }
    else process.stdout.write(json);
  },
  authoring() {
    if (pos[0] === 'suggest-breakable') {
      if (pos.length !== 2 || typeof opt.at !== 'string' || opt.at.split(',').some(value => !value.trim()))
        throw new Error('Usage: ink-studio authoring suggest-breakable <scene> --at x,y,z [--radius 1] [--voxel .1] [--ids]');
      const { ids, ...suggestion } = lib().KIT.authoring.breakables.suggest(build(pos[1]), {
        at: list('at'), radius: num('radius'), voxel: num('voxel')
      });
      process.stdout.write(JSON.stringify({ ...suggestion, samples: ids.length, ...(opt.ids && { ids }) }, null, 2) + '\n');
      return;
    }
    return require('./authoring.js')(pos, opt, {
      scene,
      render(world) {
        const shot = R.render(world, view({ t: 0 }));
        const image = R.upscale(shot, opt.px1 ? 1 : shot.px);
        return PNG.encode(image.w, image.h, image.rgb);
      }
    });
  },
  'bounce-probes'() {
    const [action,id] = pos;
    if (action !== 'bake' || !id) die('bounce-probes bake <scene> [--bounce-probes settings.json] --out probes.json');
    const world=build(id), override=bounceProbesOption();
    const data=lib().KIT.bounceProbes.bake(world,override===true ? world.bounceProbes : override ?? world.bounceProbes);
    if (!data?.probes.length) die('Bounce probe baking needs at least one authored probe');
    const file=outputFile(world.id+'-bounce-probes.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
    console.log('baked',data.probes.length,'bounce probes to',file);
  },
  environment() {
    if (pos[0] === 'aesthetics') {
      if (pos.length < 2 || pos.length > 3)
        die('Usage: ink-studio environment aesthetics <pack-or-bundle.json> [query] [--json]');
      const {assetPacks,environments} = lib().KIT.authoring;
      const packs = require('./asset-pack.js').install(assetPacks,[],pos[1]);
      const found = environments.findAesthetics(assetPacks.create({packs}),pos[2]);
      if (opt.json) process.stdout.write(JSON.stringify(found,null,2)+'\n');
      else if (!found.length) console.log('No matching aesthetics');
      else for (const {id,label,description,tags} of found)
        console.log(id+'  '+label+'  ['+tags.join(', ')+']\n  '+description);
      return;
    }
    if (pos[0] !== 'inspect' || pos.length !== 2)
      die('Usage: ink-studio environment inspect <scene|run> --at x,y,z [--t seconds]');
    if (typeof opt.at !== 'string' || opt.at.split(',').length !== 3 || opt.at.split(',').some(value=>!value.trim()) ||
        !list('at').every(Number.isFinite)) die('--at needs three finite comma-separated coordinates');
    const requested = num('t',0);
    if (opt.t === true || !Number.isFinite(requested) || requested < 0) die('--t needs nonnegative scene seconds');
    const snapshot = worldCLI().environmentSnapshot(pos[1]);
    const world = snapshot ?? buildPreview(pos[1]);
    const t = snapshot?.lookSnapshot?.time ?? requested;
    if (!snapshot) pose(world,t);
    const { inspectEnvironment } = require('./environment-inspector.js');
    const report = inspectEnvironment(world,view({t,at:list('at')}));
    if (snapshot && opt.t !== undefined) report.time.requested = requested;
    const json = JSON.stringify(report,null,opt.json ? 0 : 2)+'\n';
    if (opt.out === undefined) process.stdout.write(json);
    else {
      if (typeof opt.out !== 'string') die('--out needs a report filename');
      const file = path.resolve(opt.out);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,json);
    }
  },
  look() {
    const io = require('./look.js');
    if (pos[0] === 'parity' || pos[0] === 'profile') {
      if (pos.length !== 1) die('Usage: ink-studio look ' + pos[0] + ' [options]');
      return require('./look-renderers.js').run(pos[0], opt);
    }
    if (pos[0] === 'bake') {
      if (pos.length !== 2) die('Usage: ink-studio look bake <look-file> [--format auto|palette|lut]');
      return io.bake(pos[1], opt, lib());
    }
    if (pos[0] === 'sample') {
      if (pos.length !== 2) die('Usage: ink-studio look sample <look-file> [--colors JSON | --chart]');
      return io.sample(pos[1], opt, lib());
    }
    if (pos[0] !== 'inspect') return io.run(pos, opt, lib().KIT.authoring);
    if (pos.length !== 2) die('Usage: ink-studio look inspect <scene|run|look-file>');
    const file = pos[1];
    return io.report(io.isSource(file) ? io.inspectSource(file, opt, lib()) : worldCLI().inspectLook(file), opt, file);
  },
  lut() {
    const [mode, file] = pos;
    if (mode !== 'import' || !file || (opt.out !== undefined && typeof opt.out !== 'string'))
      die('Usage: ink-studio lut import <file.cube|file.json> [--out file.json]');
    const lut = require('./lut.js'), definition = lut.read(file, lut.importOptions(opt));
    if (opt.out) lut.write(opt.out, definition);
    else process.stdout.write(JSON.stringify(definition) + '\n');
  },
  interchange() {
    const [input] = pos, { out } = opt;
    if (pos.length !== 1 || typeof out !== 'string')
      die('Usage: ink-studio interchange <asset.gltf|.glb|.json> --out <file>');
    try {
      if (path.resolve(input) === path.resolve(out)) throw new Error('Choose an output different from the input asset');
      const studio = require('../index.js');
      let result;
      if (/\.(gltf|glb)$/i.test(input)) result = studio.writeGltfAsset(studio.readGltfAsset(input), { out });
      else if (/\.json$/i.test(input)) {
        const manifest = JSON.parse(fs.readFileSync(input, 'utf8'));
        if (manifest?.layers) result = studio.writeRasterAsset(studio.readRasterAsset(input), { out });
        else if (manifest?.files?.color) result = studio.writeSpriteAtlas(studio.readSpriteAtlas(input), { out });
        else throw new Error('Expected a layered raster or sprite atlas manifest');
      } else throw new Error('Expected glTF, GLB or a raster manifest');
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      die(error.message);
    }
  },
  'export-glb'() {
    const id = pos[0];
    if (!id || typeof opt.out !== 'string') die('Usage: ink-studio export-glb <scene.js|.json|mesh> --out model.glb');
    try {
      let source = id;
      if (!/\.(obj|gltf|glb)$/i.test(id)) {
        const authored = scene(id);
        if (typeof authored.model !== 'function') die('This scene needs a model(seed, options) hook that exposes its rest geometry');
        const box = list('bounds');
        if (box && (box.length !== 6 || !box.every(Number.isFinite))) die('--bounds expects xmin,ymin,zmin,xmax,ymax,zmax');
        const options = {
          resolution: num('res', undefined), method: opt.method, targetTriangles: num('triangles', undefined),
          duration: num('duration', undefined), fps: num('fps', undefined)
        };
        if (opt.authoring !== undefined) {
          if (typeof opt.authoring !== 'string') throw Error('--authoring needs a file path');
          options.snapshot = JSON.parse(fs.readFileSync(path.resolve(opt.authoring), 'utf8'));
        }
        if (box) options.bounds = { min: box.slice(0, 3), max: box.slice(3) };
        source = authored.model(num('seed', options.snapshot?.seed ?? authored.seed), options);
      }
      const result = require('../index.js').exportGlb(source, {
        out: opt.out, textureSize: num('texture-size', 1024), uvMargin: num('uv-margin', 0.008)
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      die(error.message);
    }
  },
  scenes() {
    for (const s of lib().SCENES) console.log(s.id.padEnd(12), s.name.padEnd(20), s.blurb);
  },
  catalog() {
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog.json'), 'utf8')),
      words = pos.map(s => s.toLowerCase());
    const hit = e =>
        words.every(w =>
          (e.id + ' ' + e.title + ' ' + e.what + ' ' + (e.tags || []).join(' ') + ' ' + e.kind)
            .toLowerCase()
            .includes(w)
        ),
      found = cat.entries.filter(hit);
    if (found.length === 1 || opt.full)
      for (const e of found)
        console.log(
          '\n' +
            e.id +
            '  [' +
            e.kind +
            ', ' +
            e.status +
            ']\n  ' +
            e.title +
            '\n  ' +
            e.what +
            (e.use ? '\n  use:  ' + e.use : '') +
            (e.example ? '\n  e.g.  ' + e.example : '') +
            (e.where ? '\n  in:   ' + e.where : '') +
            (e.from ? '\n  after: ' + e.from : '')
        );
    else
      for (const e of found)
        console.log((e.status === 'ready' ? '  ' : '~ ') + e.id.padEnd(18), ('[' + e.kind + ']').padEnd(10), e.title);
    if (!found.length) console.log('nothing matches');
    else if (found.length > 1 && !opt.full)
      console.log('\n~ = planned, not built yet.   ink-studio catalog <id> for the details');
  },
  stats() {
    const w = build(pos[0]),
      d = w.data,
      N = w.count,
      lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9],
      byCol = new Map();
    let soft = 0,
      glow = 0,
      moving = 0,
      big = 0;
    for (let i = 0, q = 0; i < N; i++, q += 16) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], d[q + k]);
        hi[k] = Math.max(hi[k], d[q + k]);
      }
      byCol.set(d[q + 7], (byCol.get(d[q + 7]) || 0) + 1);
      if (d[q + 3] < 1) soft++;
      const kr = Math.round(d[q + 11]);
      if (kr & 32) glow++;
      if (kr % 16) moving++;
      if (Math.sqrt((d[q + 4] + d[q + 8] + d[q + 10]) / 3) > 0.4) big++;
    }
    if(w.spriteSurfaces){
      const surface=w.spriteSurfaces;
      for(let i=0;i<surface.vertices.length;i+=5)for(let k=0;k<3;k++){
        lo[k]=Math.min(lo[k],surface.vertices[i+k]);hi[k]=Math.max(hi[k],surface.vertices[i+k]);
      }
      console.log('surfaces    '+surface.vertices.length/15+' triangles, '+surface.width+'×'+surface.height+' atlas');
    }
    console.log(w.id + '  "' + w.name + '"   built in ' + w.buildMs + ' ms');
    console.log(
      'splats      ' +
        N +
        '   (soft ' +
        soft +
        ', glowing ' +
        glow +
        ', shader-animated ' +
        moving +
        ', large ' +
        big +
        ')'
    );
    console.log(
      'extent      x ' +
        lo[0].toFixed(1) +
        '..' +
        hi[0].toFixed(1) +
        '   y ' +
        lo[1].toFixed(1) +
        '..' +
        hi[1].toFixed(1) +
        '   z ' +
        lo[2].toFixed(1) +
        '..' +
        hi[2].toFixed(1) +
        '   (radius ' +
        w.radius +
        ', camera ' +
        w.cam.dist +
        ' away)'
    );
    const warn = [];
    if (N > 150000) warn.push('more than 150,000 splats: heavy on a phone');
    if (w.pal.length > 48) warn.push('palette has ' + w.pal.length + ' colours; the page can only use 48');
    if (w.anim) {
      const a = w.anim,
        FR = 60;
      let rowsum = 0;
      if (a.rows) {
        for (let k = 0; k < 90; k++) a.update(1 / 30, k / 30);
        a.rows.fill(0);
      }
      const t0 = Date.now();
      for (let k = 0; k < FR; k++) {
        a.update(1 / 30, a.rows ? 3 + k / 30 : k * 0.37);
        if (a.rows) {
          for (let r = 0; r < a.rows.length; r++) rowsum += a.rows[r];
          a.rows.fill(0);
        }
      }
      const ms = (Date.now() - t0) / FR,
        rows = a.rows ? rowsum / FR : Math.ceil((a.start + a.count) / 512) - Math.floor(a.start / 512),
        mb = (rows * 8192 * 4) / 1e6;
      console.log(
        'animation   ' +
          a.count +
          ' splats in the moving span, ' +
          ms.toFixed(1) +
          ' ms of work and ' +
          mb.toFixed(1) +
          ' MB sent to the graphics card each frame' +
          (a.parts ? '   parts: ' + a.parts.length : '')
      );
      if (mb > 8) warn.push('sends ' + mb.toFixed(1) + ' MB per frame: likely to stutter on a phone');
      if (ms > 8) warn.push('animation takes ' + ms.toFixed(1) + ' ms a frame');
      pose(w, 0);
    }
    const im = R.render(w, view({})),
      hexs = (im.palette || w.pal).map(h => '#' + h.toString(16).padStart(6, '0')),
      tot = im.w * im.h;
    console.log('picture     ' + im.w + ' x ' + im.h + ' art pixels, each ' + im.px + ' screen pixels');
    console.log('colours on screen (share of the picture):');
    im.use.forEach((u, i) =>
      console.log(
        '  ' +
          String(i).padStart(2) +
          ' ' +
          hexs[i] +
          ' ' +
          ((100 * u) / tot).toFixed(1).padStart(5) +
          '%  ' +
          '#'.repeat(Math.round((40 * u) / tot)) +
          (u === 0 ? '  (never shows from here)' : '')
      )
    );
    const unused = [];
    im.use.forEach((u, i) => {
      if (!u) unused.push(i);
    });
    if (unused.length > hexs.length / 3)
      warn.push(unused.length + ' of ' + hexs.length + ' colours never show from the default view');
    console.log(warn.length ? 'warnings:\n  ' + warn.join('\n  ') : 'no warnings');
  },
  shot() {
    if (pos[0] === 'approve') {
      if (pos.length !== 2 || opt.plan === true || typeof opt.out !== 'string' || !/\.json$/i.test(opt.out) ||
          opt.frame === true || opt['report-only'] !== undefined && opt['report-only'] !== true)
        die('Use shot approve <scene> [--plan plan.json] --out report.json [--frame N] [--report-only]');
      const approval = require('./shot-approval.js');
      const document = opt.plan === undefined ? undefined : JSON.parse(fs.readFileSync(path.resolve(opt.plan), 'utf8'));
      if (document?.format === approval.format && document.version !== 1) die('Unsupported shot approval report version');
      const world = buildPreview(pos[1]);
      const settings = view({ w: num('w', undefined), h: num('h', undefined), transparent: onOffOption('transparent') });
      const result = approval.approveShot(world, { plan:document?.format === approval.format ? document.plan : document,
        view:settings, pose, camera:clipCamera(world), kit:lib(), frame:num('frame', undefined) });
      const findings = require('./shot-approval-output.js').write(result, {
        file:path.resolve(opt.out), source:pos[1], options:opt, cwd:CWD, entry:__filename
      });
      console.log('wrote', path.resolve(opt.out));
      if (findings) {
        console.log('First failure at frame', findings.frame, '(' + findings.time.toFixed(6) + 's)',
          findings.category + '/' + findings.check, 'on', findings.subject);
        console.log(findings.reproduce.command);
        if (!opt['report-only']) process.exitCode = 2;
      }
      return;
    }
    if (pos[0] !== 'replay') die('Use shot replay <recipe.json> --out <image.png>');
    if (opt.shot !== undefined) {
      if (opt.root !== undefined) die('A bundled shot uses its packaged project root');
      return require('./project-bundle.js').replayProjectShot(pos[1], opt.shot, { out:opt.out, entry:__filename });
    }
    Shot.replay(pos[1],{out:opt.out,root:opt.root,entry:__filename});
  },
  render() {
    const w = buildPreview(), diagnostics = previewPasses(),
      t = num('t', 0);
    const suffixes = reviewSidecars(diagnostics);
    shot?.destination(outputFile(w.id+'.png'),suffixes);
    pose(w, t);
    const t0 = Date.now(),
      im = R.render(w, view({ t, ...diagnostics?.settings }));
    diagnostics?.capture(im, opt.px1 ? 1 : im.px);
    console.log('drawn in', Date.now() - t0, 'ms');
    /* --text [ascii|symbols|braille|blocks]: drawn as text (K.ascii.draw), --tg screen pixels a font pixel (2), --tcolour scene|ink|mono;
       the characters themselves are written beside it, as <id>.txt */
    if (opt.text) {
      const T = asciiFrame(im, w);
      const f = save(w.id + '.png', T), ft = textSidecar(f); fs.writeFileSync(ft, T.text + '\n'); console.log('wrote', ft); console.log('as text:', T.cols, 'x', T.rows, 'characters');
      diagnostics?.write(f, { times: [t] });
      shot?.finish(f,{suffixes});
      return;
    }
    const output = save(w.id + '.png', R.upscale(im, opt.px1 ? 1 : im.px));
    diagnostics?.write(output, { times: [t] });
    shot?.finish(output,{suffixes});
  },
  sweep() {
    const sweeps = require('./visual-sweep.js');
    const directory = sweeps.outputPath(opt);
    if (pos[0] === 'pin') {
      if (pos.length !== 3) die('Use sweep pin <report-or-directory> <run-id-or-tile> --out pin.json');
      const input = path.resolve(pos[1]);
      const report = fs.statSync(input).isDirectory() ? path.join(input, 'report.json') : input;
      if (report === directory) die('Choose a separate filename for the pin');
      require('./asset-files.js').json(directory, sweeps.pin(sweeps.read(report),pos[2]));
      console.log('wrote', directory);
      return;
    }
    let source, plan, anchor;
    if (pos[0] === 'replay' || pos[0] === 'nearby') {
      if (pos.length !== (pos[0] === 'replay' ? 2 : 3))
        die('Use sweep replay <pin.json> or sweep nearby <pin.json> <offsets.json> with --out');
      const pin = sweeps.loadPin(pos[1], pos[2]);
      ({ source, plan } = pin.recipe);
      anchor = pin.anchor;
      if (pin.recipe.mode === 'sim') {
        const result = worldCLI().visualSweep(source, plan, directory, pin.recipe.runtime, anchor);
        console.log('wrote', result.report, '(' + result.cases + ' cases)');
        return;
      }
    } else {
      if (pos.length !== 2) die('Use sweep <scene> <plan.json> --out directory');
      source = sweeps.sourcePath(pos[0]);
      plan = sweeps.read(pos[1]);
    }
    const result = sweeps.runScene({ kit: lib().KIT, source, plan, directory, anchor, loadScene: scene,
      renderCase(id, { seed, controls }, settings) {
        const { width: w, height: h, pixelSize: px, at, times } = settings;
        const assemble = () => build(id, seed, { controls });
        const frames = new Map();
        if (times.length) {
          const world = assemble(), options = view({ w, h, px, ...sequenceHistory(), transparent: false });
          const replay = feedbackReplay(world, times[0], options);
          function draw(t, resetRenderHistory) {
            pose(world, t);
            return R.render(world, { ...options, t, resetRenderHistory });
          }
          for (const t of times)
            frames.set(t, R.upscale(replay ? replay.sample(t, draw) : draw(t), px));
        }
        if (!frames.has(at)) {
          const world = assemble();
          pose(world, at);
          frames.set(at, R.upscale(R.render(world, view({ w, h, px, t: at, transparent: false })), px));
        }
        return frames;
      }
    });
    console.log('wrote', result.report, '(' + result.cases + ' cases)');
  },
  variants() {
    const seeds = list('seeds', [3, 7, 12, 19, 22, 27]), group = opt.group || 'silhouette';
    if (!seeds.length || seeds.length > 48 || !seeds.every(Number.isSafeInteger) ||
        !['silhouette', 'openness', 'wear'].includes(group))
      die('variants requires up to 48 integer seeds and a valid grouping dimension');
    const C = require('./crisp.js'), critic = require('./critic.js');
    const t = num('t', 0), w = num('w', 104), h = num('h', 82);
    const results = seeds.map(seed => {
      const world = build(pos[0], seed);
      if (!world.variant || !Number.isFinite(world.variant[group])) die('this scene does not publish variant metrics');
      pose(world, t);
      const config = view({ t, w, h, px: 1, ortho: true });
      const shot = R.render(world, config);
      const { mark, bg, ...lint } = critic.lint(shot, { bg: world.pal[0] });
      const shimmer = opt.motion ? critic.flicker(Array.from({ length: 8 }, (_, index) =>
        R.render(world, { ...config, yaw: (config.yaw ?? world.cam.yaw) + index * .006 })), { bg: world.pal[0] }) : undefined;
      return { seed, shot, data: { ...world.variant, crisp: C.measure(shot, { bg: world.pal[0] }), lint, shimmer } };
    }).sort((a, b) => a.data[group] - b.data[group] || a.seed - b.seed);
    const file = save('variants.png', R.grid(results.map(row => R.upscale(row.shot, num('scale', 3))),
      num('cols', Math.min(3, results.length)), results.map(row => String(row.seed))));
    const report = file.replace(/\.[^.]+$/, '') + '.json';
    fs.writeFileSync(report, JSON.stringify({ group, variants: results.map(row => ({ seed: row.seed, ...row.data })) }, null, 2) + '\n');
    console.log('wrote', report);
  },
  atlas() {
    const w = build(pos[0]);
    const fps = num('fps', 12), from = num('from', num('t', 0)), to = num('to', from);
    if (!Number.isFinite(fps) || fps <= 0 || fps > 240 || !Number.isFinite(from) || !Number.isFinite(to) || to < from)
      die('atlas needs a positive frame rate and an ordered time range');
    const frames = Math.max(1, Math.ceil((to - from) * fps - 1e-8));
    if (frames > 512) die('atlas supports up to 512 frames');
    const times = Array.from({ length: frames }, (_, index) => from + index / fps);
    const directory = opt.out ? path.resolve(opt.out) : path.join(OUT, w.id + '-atlas');
    const { spriteAtlas, writeAtlas } = require('./sprite-atlas.js');
    const atlas = spriteAtlas(w, { width: num('w', 96), height: num('h', 96), directions: num('directions', 8),
      columns: num('cols', num('directions', 8)), maps: opt.maps ? String(opt.maps).split(',') : [],
      pivot: opt.pivot ? list('pivot') : w.cam.target, view: view(), yaw: num('yaw', w.cam.yaw),
      pitches:opt.pitches===undefined?undefined:list('pitches'),times,fps,pose });
    writeAtlas(directory, atlas);
    console.log('wrote', directory, atlas.metadata.frames.length, 'frames');
  },
  'transition-review'() {
    const world = buildPreview();
    if (opt.plan !== undefined && typeof opt.plan !== 'string') die('--plan needs a transition review JSON file');
    if (opt.out !== undefined && (typeof opt.out !== 'string' || !/\.png$/i.test(opt.out)))
      die('Transition review output needs a PNG filename');
    const plan = opt.plan === undefined ? world.transitionReview : JSON.parse(fs.readFileSync(path.resolve(opt.plan), 'utf8'));
    shot?.destination(outputFile(world.id+'-transition-review.png'),['.json']);
    const { transitionReview } = require('./transition-review.js');
    const { image, report } = transitionReview(world,{ plan, width:num('w',160), height:num('h',90), scale:num('scale',1), view:view(), pose });
    const file = save(world.id+'-transition-review.png',image);
    const reportFile = file.replace(/\.png$/i,'')+'.json';
    fs.writeFileSync(reportFile, JSON.stringify(report,null,2)+'\n');
    console.log('wrote',reportFile, '('+report.flagCount+' flags)');
    shot?.finish(file,{fps:report.fps,suffixes:['.json']});
    if (opt['fail-on-flags'] && report.flagCount) process.exitCode = 2;
  },
  'camera-review'() {
    const world = buildPreview(), from = num('from', num('t', 0)), to = num('to', from);
    const { cameraReview } = require('./camera-review.js');
    const { image, report } = cameraReview(world, {
      from, to, frames: num('frames', to === from ? 1 : 5), width: num('w',160), height: num('h',96),
      columns: num('cols',4), scale: num('scale',1), view: view(), pose
    });
    const file = save(world.id + '-camera-review.png', image);
    const reportFile = file.replace(/\.[^.]+$/, '') + '.json';
    fs.writeFileSync(reportFile, JSON.stringify(report,null,2) + '\n');
    console.log('wrote', reportFile, '(' + report.flagCount + ' flagged subjects across ' + report.frames.length + ' frames)');
    if (opt['fail-on-flags'] && report.flagCount) process.exitCode = 2;
  },
  'silhouette-review'() {
    const world=buildPreview(), time=num('t',0);
    pose(world,time);
    const {silhouetteReview}=require('./silhouette-review.js');
    const {image,report}=silhouetteReview(world,{time,width:num('w',96),height:num('h',96),
      directions:num('directions',8),pitches:opt.pitches===undefined?undefined:list('pitches'),
      yaw:num('yaw',world.cam.yaw),pivot:opt.pivot ? list('pivot') : world.cam.target,
      columns:num('cols',4),scale:num('scale',1),view:view()});
    const file=save(world.id+'-silhouette-review.png',image);
    const reportFile=file.replace(/\.[^.]+$/,'')+'.json';
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
    console.log('wrote',reportFile);
  },
  'pose-review'() {
    const w = build(pos[0]);
    const blocking = w.poseBlocking;
    if (!blocking?.markers?.length) die('pose-review needs a scene with poseBlocking landmarks');
    const { spriteAtlas, writeAtlas } = require('./sprite-atlas.js');
    const directory = opt.out ? path.resolve(opt.out) : path.join(OUT, w.id + '-poses');
    const directions = num('directions', 8);
    const atlas = spriteAtlas(w, { width: num('w', 96), height: num('h', 96), directions,
      columns: directions, maps: ['silhouette'], yaw: num('yaw', w.cam.yaw),
      pivot: opt.pivot ? list('pivot') : w.cam.target, view: view(),
      fps: blocking.clip.fps, times: blocking.markers.map(marker => marker.time), pose });
    atlas.metadata.poses = blocking.markers;
    writeAtlas(directory, atlas);
    const empty = atlas.metadata.frames.filter(frame => !frame.silhouette.pixels).length;
    const atEdge = atlas.metadata.frames.filter(frame => frame.silhouette.touchesBorder).length;
    console.log('wrote', directory, blocking.markers.length + ' poses × ' + directions + ' directions');
    if (empty || atEdge) console.log('review:', empty + ' empty, ' + atEdge + ' touching the sprite bounds');
  },
  'motion-review'() {
    const world = build(pos[0]);
    const review = world.motionReview;
    if (!review?.findings || !review.focus) die('motion-review needs a scene with a motion review');
    const findings = review.findings.filter(issue => !opt.finding || opt.finding === issue.kind || opt.finding === issue.id);
    if (opt.finding && !findings.length) die('no motion finding matches ' + opt.finding);
    const report = JSON.stringify({ scene: world.id, duration: review.duration,
      findings: findings.map(issue => ({ ...issue, focus: review.focus(issue.id) })) }, null, 2) + '\n';
    if (!opt.out) process.stdout.write(report);
    else {
      const file = path.resolve(opt.out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, report);
      console.log('wrote', file);
    }
  },
  'clip-sequence'() {
    const world = build(pos[0]), sequence = world.clipSequence;
    if (!sequence?.steps || !sequence.suggestCut) die('clip-sequence needs a scene with a clip sequence');
    const cut = opt.handoff === undefined ? undefined : sequence.suggestCut(num('handoff'));
    const { duration, alignment, travel, steps, handoffs, keys, cues, change } = sequence;
    const report = JSON.stringify({ scene: world.id, duration, alignment, travel, steps, handoffs, keys, cues, change, cut }, null, 2) + '\n';
    if (!opt.out) process.stdout.write(report);
    else {
      const file = path.resolve(opt.out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, report);
      console.log('wrote', file);
    }
  },
  'authored-contacts'() {
    const world = build(pos[0]), timeline = world.contactTimeline;
    if (!timeline?.contacts || !timeline.inspect) die('authored-contacts needs a scene with an authored contact timeline');
    const { duration, contacts, handoffs } = timeline;
    const sample = opt.at === undefined ? undefined : timeline.inspect(num('at'));
    const report = JSON.stringify({ scene: world.id, duration, contacts,
      handoffs: handoffs.map(key => ({ ...key, focus: timeline.focus(key.id) })), sample }, null, 2) + '\n';
    if (!opt.out) process.stdout.write(report);
    else {
      const file = path.resolve(opt.out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, report);
      console.log('wrote', file);
    }
  },
  'motion-fx'() {
    const world = build(pos[0]), fx = world.motionFx;
    if (!fx?.effects || !fx.at) die('motion-fx needs a scene with an authored Motion FX stack');
    const time = opt.at === undefined ? undefined : num('at');
    const sample = time === undefined ? undefined : world.motionFxDemo?.update?.(time) ?? { time, layers: fx.at(time) };
    const report = JSON.stringify({ scene: world.id, duration: fx.duration,
      capacity: fx.capacity, effects: fx.effects(), sample }, null, 2) + '\n';
    if (!opt.out) process.stdout.write(report);
    else {
      const file = path.resolve(opt.out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, report);
      console.log('wrote', file);
    }
  },
  'cloth-review'() {
    const world = build(pos[0]), review = world.clothReview, demo = world.clothDemo;
    if (!review?.bake || !demo?.start) die('cloth-review needs a scene with an authored cloth panel');
    if (opt.bake !== undefined && typeof opt.bake !== 'string') die('--bake needs a JSON output filename');
    const sourceTime = num('pose', demo.selected());
    demo.start(sourceTime);
    review.advance(num('through', 30));
    let bake;
    if (opt.bake) {
      const take = review.bake();
      bake = path.resolve(opt.bake);
      fs.mkdirSync(path.dirname(bake), { recursive: true });
      fs.writeFileSync(bake, JSON.stringify(take) + '\n');
    }
    const regions = Object.fromEntries(['pin', 'free', 'protected'].map(role => [role, review.regions().filter(value => value === role).length]));
    process.stdout.write(JSON.stringify({ scene: world.id, sourceTime: demo.selected(),
      nu: review.nu, nv: review.nv, regions, ...review.state(), ...(bake && { bake }) }, null, 2) + '\n');
  },
  'animation-graph'() {
    if (!pos[0] || opt.inputs === true || opt.at === true || opt.out === true)
      throw Error('Use animation-graph <graph.json> [--at seconds] [--inputs file.json] [--out report.json]');
    const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const machine = lib().KIT.anim.animationGraph.create(read(pos[0]));
    const actions = opt.inputs === undefined ? [] : read(opt.inputs);
    if (!Array.isArray(actions) || actions.length > 10000) throw Error('Expected an ordered list of animation graph inputs');
    const end = num('at', actions.at(-1)?.time ?? 0);
    if (!Number.isFinite(end) || end < 0) throw Error('Animation graph needs a finite nonnegative time');
    const events = [];
    let time = 0, frame;
    function advance(at) {
      frame = machine.advance(at - time);
      events.push(...frame.events);
      if (events.length > 10000) throw Error('Animation graph report exceeds its event budget');
      time = at;
    }
    for (const row of actions) {
      if (!row || !Number.isFinite(row.time) || row.time < time || row.time > end ||
          (row.set !== undefined && (!row.set || typeof row.set !== 'object' || Array.isArray(row.set))) ||
          (row.fire !== undefined && !Array.isArray(row.fire)))
        throw Error('Animation graph inputs need ordered times, set values, and trigger lists');
      if (row.time > time) advance(row.time);
      for (const [key, value] of Object.entries(row.set ?? {})) machine.set(key, value);
      for (const trigger of row.fire ?? []) machine.fire(trigger);
      advance(time);
    }
    advance(end);
    const layers = frame.layers.map(layer => ({ ...layer, samples: layer.samples.map(sample => ({
      ...sample, clip: sample.clip.id ?? null
    })) }));
    const report = JSON.stringify({ ...frame, layers, events, pose: machine.pose() }, null, 2) + '\n';
    if (opt.out) {
      const out = path.resolve(opt.out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, report);
    } else process.stdout.write(report);
  },
  take() {
    return require('./take.js').command(pos,opt,{kit:lib(),operations:cfg.graphOperations,adapters:cfg.graphAdapters});
  },
  timeline() {
    return worldCLI().inspectTimeline(pos[0]);
  },
  'randomness'() {
    return require('./randomness.js')(pos,opt,lib());
  },
  'math-fields'() {
    return require('./math-fields.js')(pos,opt,lib());
  },
  'splat-footprints'() {
    return require('./splat-footprints.js')(pos,opt,lib());
  },
  'render-grid'() {
    return require('./render-grid.js')(pos,opt,lib());
  },
  'render-graph'() {
    return require('./render-graph-plan.js')(pos,opt,lib());
  },
  patch() {
    return require('./patch-cli.js')(pos,opt,{kit:lib(),operations:cfg.graphOperations,adapters:cfg.graphAdapters});
  },
  story() {
    return require('./story-document.js').storyCommand(pos,opt,lib);
  },
  graph() {
    return require('./graph-cli.js')(pos,opt,{kit:lib(),operations:cfg.graphOperations,adapters:cfg.graphAdapters});
  },
  music() {
    return require('./music-composer.js')(pos,opt,lib());
  },
  'material-controls'() {
    return require('./material-controls.js')(pos,opt,lib());
  },
  'light-emitters'() {
    return require('./light-emitters.js')(pos,opt,lib());
  },
  typography() {
    return require('./typography.js')(pos,opt,lib());
  },
  'camera-impulses'() {
    return require('./camera-impulses.js')(pos,opt,lib());
  },
  'camera-rig'() {
    return worldCLI().inspectCameraRig(pos[0]);
  },
  'animation-timeline'() {
    const world = build(pos[0]), timeline = world.animationTimeline;
    if (typeof timeline?.report !== 'function') die('animation-timeline needs a scene with world.animationTimeline');
    for (const key of ['state', 'preview', 'out', 'stage', 'at', 'part', 'direction', 'loop', 'finding', 'fix', 'frames', 'w', 'h'])
      if (opt[key] === true) die('--' + key + ' needs a value');
    const state = opt.state && path.resolve(opt.state);
    const reportFile = opt.out && path.resolve(opt.out);
    if (state && state === reportFile) die('--state and --out need different paths');
    let saved;
    if (state && fs.existsSync(state)) {
      saved = JSON.parse(fs.readFileSync(state, 'utf8'));
      if (saved.scene !== world.id) die('Timeline state belongs to another scene');
      timeline.restore(saved.context);
    }
    const patch = {};
    if (opt.stage !== undefined) patch.stage = opt.stage;
    if (opt.at !== undefined) patch.time = num('at');
    if (opt.part !== undefined) patch.part = opt.part === 'off' ? null : opt.part;
    if (opt.direction !== undefined) patch.direction = num('direction');
    if (opt.loop === 'off') patch.loop = null;
    else if (opt.loop !== undefined) {
      const ends = String(opt.loop).split(',');
      if (ends.length !== 2 || ends.some(value => !value.trim())) die('--loop needs start,end or off');
      const [start, end] = ends.map(Number);
      patch.loop = { start, end, wraps: start > end };
    }
    if (opt.finding === 'off') timeline.clearFocus();
    timeline.set(patch);
    if (opt.finding && opt.finding !== 'off') timeline.focus(opt.finding);
    const motion = timeline.motionReview();
    for (const layer of saved?.corrections ?? []) {
      if (!motion?.accept(layer.id)) die('Saved correction is no longer available: ' + layer.id);
      motion.setEnabled(layer.id, layer.enabled);
    }
    if (opt.fix !== undefined) {
      const id = timeline.snapshot().focus?.id;
      if (!id) die('--fix needs a focused motion finding');
      if (opt.fix === 'accept') {
        if (!motion.accept(id)) die('No correction is available for ' + id);
        motion.setEnabled(id, true);
      } else if (opt.fix === 'remove') motion.remove(id);
      else if (opt.fix === 'mute' || opt.fix === 'enable') {
        if (!motion.setEnabled(id, opt.fix === 'enable')) die('Accept this correction before changing its state');
      } else die('--fix needs accept, mute, enable, or remove');
    }
    const before = !!opt.before, report = { scene: world.id, ...timeline.report({ before }) };
    if (opt.at !== undefined || report.state.focus) report.frame = timeline.frame(report.state.time, { before });
    if (opt.preview) {
      const { previewTimeline } = require('./animation-timeline.js');
      const { writeAtlas } = require('./sprite-atlas.js');
      const directory = path.resolve(opt.preview);
      if ([state, reportFile].some(file => file && ['atlas.json', 'color.png', 'silhouette.png']
        .some(name => file === path.join(directory, name)))) die('Use a different path for the timeline state or report');
      const atlas = previewTimeline(world, { width: num('w'), height: num('h'), frames: num('frames'), before,
        view: view(), yaw: num('yaw'), pivot: opt.pivot ? list('pivot') : undefined });
      writeAtlas(directory, atlas);
      report.preview = { directory, ...atlas.metadata };
    }
    const json = JSON.stringify(report, null, 2) + '\n';
    if (reportFile) {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, json);
    }
    if (state) {
      fs.mkdirSync(path.dirname(state), { recursive: true });
      const pending = state + '.' + require('node:crypto').randomUUID() + '.tmp';
      try {
        fs.writeFileSync(pending, JSON.stringify({ scene: world.id, context: report.state,
          corrections: report.lanes.corrections.map(({ id, enabled }) => ({ id, enabled })) }, null, 2) + '\n');
        fs.renameSync(pending, state);
      } finally {
        if (fs.existsSync(pending)) fs.unlinkSync(pending);
      }
    }
    if (!reportFile) process.stdout.write(json);
  },
  retarget() {
    require('./retarget.js').run({ K: lib().KIT, build, pos, options: opt, view: view() });
  },
  'environment-parity'() {
    const parity = require('./environment-parity.js');
    const result = parity.compare({chrome:opt.chrome,hardware:opt.hardware,fixture:opt.fixture});
    const directory = opt.out ? path.resolve(opt.out) : path.join(OUT,'environment-parity');
    parity.write(directory,result);
    for (const {id,mean,p95} of result.frames) console.log(id,mean.toFixed(3),'mean RGB byte error, p95',p95);
    console.log('wrote',directory);
  },
  passes() {
    const w = buildPreview(), t = num('t', 0);
    const art = require('../src/art-passes.js');
    const passes = art.select(opt.channels ? String(opt.channels).split(',') : true);
    const motionFrom = priorArtReference(w, t, { captureMotion:true, capturePartMotion:true,
      captureStrandMotion:art.needsStrandMotion(passes) });
    pose(w, t);
    const im = R.render(w, view({ t, passes, motionFrom }));
    const directory = opt.out ? path.resolve(opt.out) : path.join(OUT, w.id + '-passes');
    require('./pass-preview.js').writePasses(directory, im, opt.px1 ? 1 : im.px);
    console.log('wrote', directory);
  },
  'strand-pixel'() {
    if (pos.length !== 1 || typeof opt.at !== 'string' || !/^\d+,\d+$/.test(opt.at) || opt.out === true)
      die('Use strand-pixel <scene> --at x,y [--t seconds] [--previous seconds] [--out inspection.json]');
    const world = buildPreview(), t = num('t', 0);
    const motionFrom = priorArtReference(world, t, { captureStrandMotion: true });
    pose(world, t);
    const frame = R.render(world, view({ t, strandPixel: list('at'), motionFrom,
      captureStrandMotion: !!motionFrom }));
    const report = { scene: world.id, ...frame.strandPixel };
    if (opt.out) require('./asset-files.js').json(path.resolve(opt.out), report);
    else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  },
  'strand-review'() {
    if (pos.length !== 1 || opt.out === true || opt.w === undefined || opt.h === undefined ||
        ['w', 'h', 't', 'from', 'to', 'fps'].some(flag => opt[flag] === true))
      die('Use strand-review <scene> --w WIDTH --h HEIGHT [--t TIME | --from START --to END --fps RATE] [--out directory]');
    const world = buildPreview(), frame = view(), directory = outputFile('strand-review');
    const time = num('t'), from = num('from'), to = num('to');
    const replay = feedbackReplay(world, from ?? time ?? 0, frame);
    const report = require('./curve-quality-review.js').writeCurveQualityReview(world, {
      kit: lib(), frame, time, from, to, fps: num('fps',12), camera:clipCamera(world), replay, samplePose:pose
    }, directory);
    console.log('wrote', directory, report.frames.length, 'matched samples at', report.width + 'x' + report.height, 'art pixels');
  },
  'export-layers'() {
    if (pos.length !== 1 || opt.out === true)
      die('Use export-layers <scene> [--t seconds,... | --from seconds --to seconds --n count] [--out directory]');
    if (opt.t !== undefined && (typeof opt.t !== 'string' || opt.t.split(',').some(time => !time.trim())))
      die('--t needs one or more comma-separated times');
    if (['from', 'to', 'n'].some(key => opt[key] === true) || !Number.isSafeInteger(num('n', 1)) || num('n', 1) < 1)
      die('Layered exports need numeric range endpoints and a positive frame count');
    const world = buildPreview(), ts = ['t', 'from', 'to', 'n'].some(key => opt[key] !== undefined) ? times() : [0];
    if (opt.compositing !== undefined && typeof opt.compositing !== 'string') die('--compositing needs a JSON file');
    const compositing = opt.compositing && JSON.parse(fs.readFileSync(path.resolve(opt.compositing),'utf8'));
    const frame = view(ts.length > 1 ? sequenceHistory() : {});
    const out = opt.out ?? path.join(OUT, world.id + '-layers');
    const { file, manifest } = require('./export-layers.js').exportLayers(world, {
      out, view: frame, times: ts, native: !!opt.px1, pose, replay: feedbackReplay(world, ts[0], frame),
      partMotion: onOffOption('part-motion') === true, strandPasses: onOffOption('strand-passes') === true, compositing
    });
    console.log('wrote', file, manifest.frames.length, 'frame(s)');
  },
  async 'export-scene'() {
    if (pos.length !== 1 || typeof opt.out !== 'string')
      die('Use export-scene <scene> --out directory [--formats still,loop,replay,embed]');
    if (['w', 'h', 'still-scale', 't', 'from', 'to', 'fps'].some(key => opt[key] === true) || opt.formats === true)
      die('Scene export flags need values');
    const settings = sceneEmbedConfig(), kit = lib();
    const transparent = onOffOption('transparent');
    if ([opt.audio, opt.mux, opt.adapters].includes(true))
      die('Use --audio soundtrack.json with an optional --mux codec ID and --adapters module');
    const host = await require('./graph-host-command.js').adapters(opt.adapters, {
      kit, operations: cfg.graphOperations, adapters: cfg.graphAdapters
    });
    return require('./project-bundle.js').withTakeSource(pos[0], source => {
      const native = require('./scene-export-world.js').readExportWorld(source, kit);
      const soundtrack = opt.audio ?? native?.audio;
      if (opt.mux !== undefined && soundtrack === undefined) die('A review mux needs a take soundtrack or --audio');
      const audio = soundtrack === undefined ? undefined : require('./scene-audio.js').readSceneAudio(soundtrack, host);
      const video = opt.mux === undefined ? undefined : require('./graph-host.js').createGraphHost(host.adapters, { kit });
      video?.requireCodec(opt.mux, 'mux');
      const fpsText = opt.fps, fraction = typeof fpsText === 'string' && /^(\d+)\/(\d+)$/.exec(fpsText);
      const fps = fraction ? { numerator: Number(fraction[1]), denominator: Number(fraction[2]) } :
        fpsText === undefined ? native?.fps ?? 12 : Number(fpsText);
      const { file } = require('./scene-export.js').exportScene(({ width, height, moving, from }) => {
        if (native) return native.capture({ width, height, from, render: R.render,
          options: view({ ...(moving && sequenceHistory()), transparent, ...(opt.px1 && { px: 1 }) }) });
        const world = buildPreview(source, { parameterInputs: { time: num('parameter-time', from) } });
        const frame = view({ ...(moving && sequenceHistory()), w: width, h: height, transparent,
          ...(opt.px1 && { px: 1 }) });
        const camera = moving ? clipCamera(world) : null, replay = moving ? feedbackReplay(world, from, frame) : null;
        return {
          scene: world.id, title: world.name, timeline: world.timeline,
          ...(world.simulationInputs && { seed: world.simulationInputSeed,
            simulationInputs: lib().KIT.simulationInputs.tracks(world.simulationInputs) }),
          duration: Math.max(world.timeline?.duration ?? 0, world.cameraRig?.duration ?? 0),
          sample(time, lastTime) {
            function draw(t, resetRenderHistory) {
              const phase = lastTime > from ? Math.max(0, Math.min(1, (t - from) / (lastTime - from))) : 0;
              pose(world, t);
              return R.render(world, { ...frame, ...camera?.(phase), time: t, t, resetRenderHistory });
            }
            return replay ? replay.sample(time, draw) : draw(time);
          }
        };
      }, { out: opt.out, formats: opt.formats?.split(',').map(format => format.trim()), embed: settings,
        width: num('w', 640), height: num('h', 360), fps, from: num('from', 0), to: num('to'),
        stillScale: num('still-scale', 2), stillTime: num('t'), loopJoin: onOffOption('loop-join'), kit, audio,
        ...(video && { mux: payload => video.mux(opt.mux, payload) }) });
      console.log('wrote', file);
    });
  },
  'scene-replay'() {
    if (pos.length !== 1 || typeof opt.out !== 'string' || opt.at === true ||
        opt.embed !== undefined && opt.embed !== true)
      die('Use scene-replay <recording.json> [--at seconds | --embed] --out <file>');
    const api = require('./scene-replay.js'), document = api.readSceneReplay(pos[0]);
    const file = path.resolve(opt.out);
    if (path.resolve(pos[0]) === file) die('Choose an output different from the scene replay');
    if (opt.embed) api.writeSceneEmbed(document, { out: file, settings: sceneEmbedConfig() });
    else {
      if (!/\.png$/i.test(file)) die('Choose a .png replay frame filename');
      const frame = api.sampleSceneReplay(document, num('at', 0));
      require('./asset-files.js').write(file, frame.png);
    }
    console.log('wrote', file);
  },
  project() {
    const [mode, input] = pos, api = require('./project-bundle.js');
    if (pos.length !== 2 || !['pack', 'inspect', 'unpack', 'verify'].includes(mode))
      die('Use project pack, inspect, unpack or verify with a JSON document');
    if (mode === 'unpack') {
      const { entry } = api.unpackProject(input, { out: opt.out });
      console.log('unpacked', entry);
      return;
    }
    if (mode === 'inspect') {
      const project = api.readProjectBundle(input), { format, version, attachments } = project.snapshot();
      process.stdout.write(JSON.stringify({ format, version, ...project.metadata, files: project.files(), attachments,
        take: project.takeDocument?.(), experiment: project.experimentDocument?.() }, null, 2) + '\n');
      return;
    }
    if (mode === 'verify') {
      if (Object.keys(opt).some(key => key !== 'out' && key !== 'compare-engine') ||
          opt.out !== undefined && (typeof opt.out !== 'string' || !opt.out.trim()) ||
          opt['compare-engine'] !== undefined && opt['compare-engine'] !== true)
        die('Use project verify <experiment-bundle.json> [--out report.json --compare-engine]');
      if (opt.out && fs.existsSync(opt.out)) {
        const source = fs.statSync(input), destination = fs.statSync(opt.out);
        if (source.dev === destination.dev && source.ino === destination.ino) die('Choose a report separate from its experiment bundle');
      }
      const report = require('./project-experiment.js').verify(input, { compareEngine: opt['compare-engine'] ?? false });
      if (opt.out) require('./asset-files.js').json(path.resolve(opt.out), report);
      else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (!report.passed) process.exitCode = 2;
      return;
    }
    if ([opt.root, opt.revision].includes(true)) die('--root and --revision need values');
    const { file, project } = api.packProject(input, { out: opt.out, root: opt.root,
      revision: opt.revision === undefined ? undefined : num('revision', 1),
      assetPack: opt['asset-pack'], paint: opt.paint, attachments: opt.attachments });
    console.log('wrote', file, project.files().length, 'file(s)');
  },
  /* the ramps a diorama is shaded on, most used first, and what kind each is: one hue darker and lighter, or turning as it darkens.
     For a one-hue ramp a turning one made from the same palette is offered (the diorama is not changed). */
  ramps() {
    globalThis.INK_RAMPS = new Map();
    const w = build(pos[0]),
      K = lib().KIT,
      hx = i => '#' + w.pal[i].toString(16).padStart(6, '0'),
      all = [...globalThis.INK_RAMPS.entries()].sort((a, b) => b[1] - a[1]),
      total = all.reduce((s, e) => s + e[1], 0);
    let dull = 0;
    console.log(w.id + ': ' + all.length + ' ramps, ' + total.toLocaleString() + ' dabs shaded on them');
    for (const [ramp, cnt] of all.slice(0, num('n', 12))) {
      const c = K.ramp.check(w.pal, ramp);
      console.log(
        (((100 * cnt) / total).toFixed(1) + '%').padStart(6) +
          '  [' +
          ramp.join(', ') +
          ']  ' +
          ramp.map(hx).join(' ') +
          '   ' +
          c.says
      );
      if (c.says.startsWith('one hue')) {
        dull += cnt;
        const mid = w.pal[ramp[ramp.length >> 1]],
          uniq = [...new Set(ramp)],
          m = K.ramp.make(w.pal, {
            base: mid,
            n: uniq.length,
            dark: K.ramp.hsl(w.pal[ramp[0]])[2],
            light: K.ramp.hsl(w.pal[ramp[ramp.length - 1]])[2]
          });
        if (m.ramp.length === uniq.length && m.ramp.join() !== uniq.join() && Math.abs(m.travel) >= 12)
          console.log(
            '          try [' +
              m.ramp.join(', ') +
              ']  ' +
              m.ramp.map(hx).join(' ') +
              '   ' +
              m.says +
              ' (furthest reach ' +
              Math.max(...m.miss).toFixed(2) +
              ')'
          );
      }
    }
    console.log(
      Math.round((100 * dull) / Math.max(1, total)) + '% of the dabs in the ramps listed are on one-hue ramps'
    );
  },
  /* the value check: does the picture read in three tones? The picture is drawn small, the background taken out, and what is left
     sorted into dark, middle and light by how bright it is. A picture that is nearly all one of them is flat however good its colours. */
  values() {
    const w = build(pos[0]),
      t = num('t', 0);
    pose(w, t);
    const im = R.render(w, view({ t })),
      bg = (im.palette || w.pal)[0],
      bgc = [(bg >> 16) & 255, (bg >> 8) & 255, bg & 255],
      n = im.w * im.h,
      lum = new Float32Array(n),
      on = new Uint8Array(n);
    let lo = 255,
      hi = 0,
      cnt = 0;
    for (let i = 0; i < n; i++) {
      const r = im.rgb[i * 3],
        g = im.rgb[i * 3 + 1],
        b = im.rgb[i * 3 + 2];
      if (r === bgc[0] && g === bgc[1] && b === bgc[2]) continue;
      on[i] = 1;
      cnt++;
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum[i] < lo) lo = lum[i];
      if (lum[i] > hi) hi = lum[i];
    }
    const a = lo + (hi - lo) / 3,
      b = lo + ((hi - lo) * 2) / 3,
      share = [0, 0, 0],
      out = { w: im.w, h: im.h, px: im.px, rgb: new Uint8Array(n * 3) },
      tone = [40, 128, 230];
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      const k = lum[i] < a ? 0 : lum[i] < b ? 1 : 2;
      share[k]++;
      out.rgb[i * 3] = out.rgb[i * 3 + 1] = out.rgb[i * 3 + 2] = tone[k];
    }
    const pc = share.map(v => Math.round((100 * v) / Math.max(1, cnt))),
      least = Math.min(...pc),
      most = Math.max(...pc),
      says =
        hi - lo < 90
          ? 'FLAT: the darkest and lightest things are close together (' +
            Math.round(lo) +
            ' to ' +
            Math.round(hi) +
            ' of 255)'
          : most > 72
            ? 'ONE TONE: ' + most + '% of it is ' + ['dark', 'middle', 'light'][pc.indexOf(most)]
            : least < 8
              ? 'TWO TONES: almost no ' + ['dark', 'middle', 'light'][pc.indexOf(least)] + ' (' + least + '%)'
              : 'reads in three tones';
    console.log(
      w.id +
        '  dark ' +
        pc[0] +
        '%  middle ' +
        pc[1] +
        '%  light ' +
        pc[2] +
        '%   brightness ' +
        Math.round(lo) +
        ' to ' +
        Math.round(hi) +
        '   ' +
        says
    );
    if (!opt.quiet) save(w.id + '-values.png', R.grid([R.upscale(im, im.px), R.upscale(out, im.px)], 2));
  },
  sheet() {
    const w = buildPreview(), diagnostics = previewPasses(),
      ts = times(),
      cols = num('cols', Math.min(4, ts.length)),
      imgs = [];
    const frame = { ...sequenceHistory(),
      w: num('w', 600), h: num('h', 420), ...diagnostics?.settings };
    const replay = feedbackReplay(w, Math.min(...ts), view(frame));
    function draw(t, resetRenderHistory) {
      pose(w, t);
      return R.render(w, view({ ...frame, t, resetRenderHistory }));
    }
    for (const t of ts) {
      const im = replay ? R.sequenceOutput(frame, ()=>replay.sample(t, draw)) : draw(t);
      diagnostics?.capture(im, opt.px1 ? 1 : im.px);
      imgs.push(displayFrame(im, w));
    }
    const output = save(
      w.id + '-sheet.png',
      R.grid(
        imgs,
        cols,
        ts.map(t => t + 's')
      )
    );
    diagnostics?.write(output, { times: ts, cols });
    console.log('times', ts.join(' '));
  },
  /* one picture with the moments either side laid faintly over it: what moved, and how far, at a glance */
  ghost() {
    const w = build(pos[0]),
      t = num('t', 1),
      sp = num('spacing', 0.12),
      n = num('n', 2),
      ts = opt.ghosts
        ? list('ghosts')
            .concat([t])
            .sort((a, b) => a - b)
        : Array.from({ length: 2 * n + 1 }, (_, i) => +(t + (i - n) * sp).toFixed(4)).filter(x => x >= 0),
      imgs = [];
    for (const q of ts) {
      pose(w, q);
      const im = R.render(w, view({ t: q, w: num('w', 600), h: num('h', 420) }));
      imgs.push({ t: q, im: R.upscale(im, im.px) });
    }
    const main = imgs.find(q => q.t === t) || imgs[imgs.length - 1],
      others = imgs.filter(q => q !== main),
      out = main.im.rgb.slice(),
      a = num('fade', 0.5) / Math.max(1, others.length);
    for (let i = 0; i < out.length; i++) {
      let v = main.im.rgb[i] * (1 - a * others.length);
      for (const g of others) v += g.im.rgb[i] * a;
      out[i] = Math.round(v);
    }
    save(w.id + '-ghost.png', { w: main.im.w, h: main.im.h, rgb: out });
    console.log('at', main.t + 's, with ghosts at', others.map(q => q.t + 's').join(' '));
  },
  /* the ready clips and reactions, by name */
  acts() {
    const K = lib().KIT;
    console.log(
      'squash and stretch clips (K.acts.clip):',
      K.acts.KINDS.map(k => k + ' ' + K.acts.DUR[k] + 's').join(', ')
    );
    console.log('reaction fields (K.deform.emote):', K.deform.EMOTES.join(', '));
    console.log('reactions (K.acts.emotes):');
    for (const r of K.acts.REACTIONS)
      console.log('  ' + r.id.padEnd(18) + r.motion.padEnd(11) + r.expression.padEnd(12) + r.label);
    console.log('easings (K.anim.ease):', K.anim.EASES.join(', '));
    console.log('presentation cues (K.anim.cue):', Object.keys(K.anim.CUES).join(', '));
    console.log('presets (K.anim.preset): heavy-impact, contact-impact, lightning, discovery, slow');
    console.log('actions (K.acts.clock):', Object.keys(K.acts.ACTION.duration).join(', '));
  },
  perf() {
    const secs = num('secs', 5), fps = num('fps', 60), uploadGap = num('upload-gap', 0);
    if (!(secs > 0 && Number.isFinite(secs) && fps > 0 && Number.isFinite(fps)) ||
      !Number.isSafeInteger(uploadGap) || uploadGap < 0) die('perf needs positive --secs and --fps, and nonnegative integer --upload-gap');
    const frames = Math.ceil(secs * fps);
    if (!Number.isSafeInteger(frames) || frames > 36000) die('perf can sample at most 36000 frames');
    const w = build(pos[0]), a = w.anim;
    const report = { scene: w.id, splats: w.count, buildMs: w.buildMs, frames: a ? frames : 0,
      pixelBudget: w.look?.pixelBudget ?? null, meanMs: 0, p95Ms: 0, worstMs: 0, meanBytes: 0, peakBytes: 0, meanUploads: 0 };
    if (a) {
      const { uploadRows } = require('../src/frame-budget.js');
      if (opt['gpu-signal'] && w.signal) a.gpuSignal = true;
      const timings = [];
      let bytes = 0, uploads = 0, total = 0;
      for (let frame = 0; frame < frames; frame++) {
        const start = process.hrtime.bigint();
        const changed = a.update(1 / fps, frame / fps);
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        timings.push(ms);
        total += ms;
        let frameBytes = 0;
        if (changed && a.rows) {
          uploadRows(a.rows, (first, end) => {
            frameBytes += (end - first) * 32768;
            uploads++;
          }, uploadGap);
        } else if (changed && a.count) {
          frameBytes += (Math.ceil((a.start + a.count) / 512) - Math.floor(a.start / 512)) * 32768;
          uploads++;
        }
        if (a.bones) frameBytes += Math.ceil(a.bones.length / (768 * 4)) * 768 * 16;
        bytes += frameBytes;
        report.peakBytes = Math.max(report.peakBytes, frameBytes);
      }
      timings.sort((left, right) => left - right);
      report.meanMs = total / frames;
      report.p95Ms = timings[Math.ceil(frames * .95) - 1];
      report.worstMs = timings[frames - 1];
      report.meanBytes = bytes / frames;
      report.meanUploads = uploads / frames;
    }
    if (opt.json) {
      console.log(JSON.stringify(report));
      return;
    }
    console.log(w.id + ': ' + w.count.toLocaleString() + ' splats, built in ' + w.buildMs + ' ms');
    console.log('Animation: ' + report.meanMs.toFixed(2) + ' ms/frame (' + report.p95Ms.toFixed(2) + ' ms at p95)');
    console.log('Planned uploads: ' + Math.round(report.meanBytes / 1024) + ' KiB/frame, peak ' +
      Math.round(report.peakBytes / 1024) + ' KiB, ' + report.meanUploads.toFixed(1) + ' splat uploads/frame');
    console.log('The browser measures drawing and GPU time separately.');
  },
  validate() {
    if (!pos[0]) die('validate which file?');
    const io = require('./look.js');
    if (!opt.world && (opt.kind === 'look' || io.isSource(pos[0])))
      return io.report(io.assertValid(io.inspectSource(pos[0], opt, lib())), opt, pos[0]);
    if (lib().KIT.world && worldCLI().validate(pos[0])) return;
    const report = io.assertValid(worldCLI().inspectLook(pos[0]));
    if (opt.json || opt.out) return io.report(report, opt, pos[0]);
    const label = report.scene ? ' (' + report.scene.id + ', "' + report.scene.name + '")' : '';
    console.log(pos[0] + ': sound' + label);
  },
  depth() {
    require('./depth.js')(pos[0], opt, lib(), path.join(OUT, 'depth-import'));
  },
  mesh() {
    const w = build(pos[0]),
      m = w.mesh;
    console.log(
      m.tris +
        ' faces, ' +
        m.verts +
        ' points; ' +
        (m.mode === 'uv' ? (m.geometry === 'sdf' ? 'SDF reconstruction with UV transfer and alpha' : 'UV surface stamps with alpha') : m.sheet
          ? 'open (' + (m.open * 100).toFixed(0) + '% of its edges are loose): treated as a sheet with thickness'
          : 'closed: treated as a solid') +
        '; materials: ' +
        m.mats.join(', ')
    );
    console.log(
      w.count +
        ' splats in ' +
        m.hues +
        ' colours of ' +
        (w.pal.length - 1) / m.hues +
        ' shades' +
        (m.mode === 'uv' ? ', UV-atlas detail' : ', field cell ' + m.cell.toFixed(3)) +
        ', built in ' +
        w.buildMs +
        ' ms'
    );
    opt.n = opt.n || 4;
    CMD.turn(w);
  },
  turn(w0) {
    const transparencyHistory = lib().KIT.stableTransparency.history();
    const w = w0 || build(pos[0]),
      n = num('n', 8),
      t = num('t', 0),
      imgs = [],
      labs = [];
    pose(w, t);
    for (let k = 0; k < n; k++) {
      const yaw = w.cam.yaw + (k / n) * Math.PI * 2,
        im = R.render(w, view({ t, yaw, transparencyHistory, w: num('w', 600), h: num('h', 420) }));
      imgs.push(R.upscale(im, im.px));
      labs.push('y' + yaw.toFixed(1));
    }
    save(w.id + '-turn.png', R.grid(imgs, num('cols', 4), labs));
  },
  clip() {
    const join = onOffOption('loop-join') && require('./loop-join.js');
    const w = buildPreview(), diagnostics = previewPasses(),
      fps = num('fps', 12),
      from = num('from', 0),
      duration = Math.max(w.timeline?.duration ?? 0, w.cameraRig?.duration ?? 0),
      to = num('to', duration > from ? duration : 6),
      n = Math.max(2, Math.round((to - from) * fps)),
      frames = [], ts = [], camera = clipCamera(w),
      f = outputFile(w.id+'-clip.png');
    const suffixes = [...reviewSidecars(diagnostics), ...(join ? join.suffixes : [])];
    shot?.destination(f,suffixes);
    const frame = { ...sequenceHistory(),
      w: num('w', 600), h: num('h', 420) };
    const replay = feedbackReplay(w, from, view(frame));
    function draw(t, resetRenderHistory, fraction = Math.max(0, Math.min(1, (t - from) * fps / (n - 1)))) {
      pose(w, t);
      return R.render(w, view({ ...frame, t, resetRenderHistory, ...camera?.(fraction), ...diagnostics?.settings }));
    }
    for (let k = 0; k < n; k++) {
      const t = from + k / fps;
      const im = replay ? R.sequenceOutput(frame, ()=>replay.sample(t, draw)) : draw(t, undefined, k / (n - 1));
      diagnostics?.capture(im, opt.px1 ? 1 : im.px);
      ts.push(t);
      frames.push(displayFrame(im, w));
    }
    const end = from + n / fps;
    const audit = join && join.inspect({ first: frames[0], penultimate: frames[n - 2], last: frames[n - 1],
      endpoint: displayFrame(replay ? replay.sample(end, draw) : draw(end, undefined, 1), w), from, fps, count: n });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    PNG.animate(f, frames, fps);
    if (audit) {
      const base = f.replace(/\.(?:a?png)$/i, '');
      PNG.write(base + '-join.png', audit.image.w, audit.image.h, audit.image.rgb);
      require('./asset-files.js').json(base + '-join.json', audit.report);
    }
    diagnostics?.write(f, { times: ts, fps });
    if (opt.text) {
      const textFile = textSidecar(f);
      fs.writeFileSync(textFile, frames.map(frame => frame.text).join('\n\f\n') + '\n');
      console.log('wrote', textFile);
    }
    shot?.finish(f,{fps,suffixes});
    console.log('wrote', f, frames.length, 'frames at', fps, 'a second (an animated PNG: a browser will play it)');
  },
  reel() {
    if (pos.length !== 1 || Object.keys(opt).some(key => !['out', 'clean'].includes(key)) ||
        opt.out === true || (opt.clean !== undefined && opt.clean !== true))
      die('Use reel <manifest.json> [--out reel.html] [--clean]');
    const file = outputFile('reel.html');
    if (!/\.html$/i.test(file) || file === path.resolve(pos[0])) die('A reel needs a separate .html output');
    const result = require('./reel.js').write(file, pos[0], { clean: opt.clean });
    console.log('wrote', file, result.shots, 'shots and', result.frames, 'captured frames');
  },
  motion() {
    const w = build(pos[0]);
    if (!w.anim) die(w.id + ' has no animation of its own');
    const a = w.anim,
      d = w.data,
      n0 = a.start,
      n1 = a.start + a.count,
      M = n1 - n0,
      from = num('from', 0),
      to = num('to', 12),
      dt = 1 / 30,
      prev = new Float32Array(M * 3),
      rest = new Float32Array(M * 3),
      peak = new Float32Array(M);
    pose(w, from);
    for (let i = 0; i < M; i++) for (let k = 0; k < 3; k++) rest[i * 3 + k] = prev[i * 3 + k] = d[(n0 + i) * 16 + k];
    let worst = 0,
      worstT = 0,
      worstI = 0,
      low = 1e9,
      lowT = 0,
      bad = 0;
    const jumps = [],
      JUMP = num('jump', 0.6);
    for (let t = from + dt; t <= to + 1e-9; t += dt) {
      pose(w, t);
      let stepMax = 0,
        cnt = 0,
        jx = 0,
        jy = 0,
        jz = 0;
      for (let i = 0; i < M; i++) {
        const q = (n0 + i) * 16,
          x = d[q],
          y = d[q + 1],
          z = d[q + 2];
        if (!(x === x && y === y && z === z)) {
          bad++;
          continue;
        }
        const m = Math.hypot(x - prev[i * 3], y - prev[i * 3 + 1], z - prev[i * 3 + 2]);
        if (m > peak[i]) peak[i] = m;
        if (m > stepMax) stepMax = m;
        if (m > JUMP) {
          cnt++;
          jx += rest[i * 3];
          jy += rest[i * 3 + 1];
          jz += rest[i * 3 + 2];
        }
        if (m > worst) {
          worst = m;
          worstT = t;
          worstI = i;
        }
        if (y < low) {
          low = y;
          lowT = t;
        }
        prev[i * 3] = x;
        prev[i * 3 + 1] = y;
        prev[i * 3 + 2] = z;
      }
      if (cnt)
        jumps.push(
          t.toFixed(2) +
            's  ' +
            String(cnt).padStart(6) +
            ' splats, up to ' +
            (stepMax / dt).toFixed(0) +
            ' units a second, around (' +
            (jx / cnt).toFixed(1) +
            ', ' +
            (jy / cnt).toFixed(1) +
            ', ' +
            (jz / cnt).toFixed(1) +
            ') at rest'
        );
    }
    const sorted = Float32Array.from(peak).sort(),
      pc = f => (sorted[Math.min(M - 1, Math.floor(f * M))] / dt).toFixed(1);
    let still = 0;
    for (let i = 0; i < M; i++) if (peak[i] < 1e-4) still++;
    console.log(w.id + ': ' + M + ' splats watched from ' + from + 's to ' + to + 's, thirty times a second');
    console.log(
      'fastest any splat moves   ' +
        (worst / dt).toFixed(1) +
        ' units a second, at ' +
        worstT.toFixed(2) +
        's, a splat that rests at (' +
        [0, 1, 2].map(k => rest[worstI * 3 + k].toFixed(1)).join(', ') +
        ')'
    );
    console.log(
      'peak speed by share       half are under ' +
        pc(0.5) +
        ', 90% under ' +
        pc(0.9) +
        ', 99% under ' +
        pc(0.99) +
        ' units a second'
    );
    console.log(
      'never move at all         ' +
        still +
        ' (' +
        ((100 * still) / M).toFixed(0) +
        '% of the span: these are sent to the graphics card for nothing)'
    );
    console.log('lowest point reached      y = ' + low.toFixed(2) + ' at ' + lowT.toFixed(2) + 's');
    console.log(
      jumps.length
        ? 'FAST: more than ' +
            (JUMP / dt).toFixed(0) +
            ' units a second (a strike, or something teleporting):\n  ' +
            jumps.slice(0, 12).join('\n  ') +
            (jumps.length > 12 ? '\n  and ' + (jumps.length - 12) + ' more' : '')
        : 'nothing moves faster than ' + (JUMP / dt).toFixed(0) + ' units a second'
    );
    if (bad) console.log('NOT A NUMBER: ' + bad + ' positions');
    if (a.parts) {
      const pk = new Float32Array(a.parts.length);
      for (let i = 0; i < M; i++) {
        const b = a.partOf ? a.partOf(n0 + i) : 0;
        if (peak[i] > pk[b]) pk[b] = peak[i];
      }
      console.log(
        'fastest part: ' +
          Array.from(pk)
            .map((v, i) => [v, a.parts[i]])
            .sort((p, q) => q[0] - p[0])
            .slice(0, 8)
            .map(e => e[1] + ' ' + (e[0] / dt).toFixed(1))
            .join(',  ')
      );
    }
    if (a.period) {
      pose(w, from);
      const p0 = Float32Array.from({ length: M * 3 }, (_, k) => d[(n0 + ((k / 3) | 0)) * 16 + (k % 3)]);
      if (!a.stateful) {
        pose(w, from + a.period);
        let mx = 0;
        for (let i = 0; i < M; i++)
          mx = Math.max(
            mx,
            Math.hypot(
              d[(n0 + i) * 16] - p0[i * 3],
              d[(n0 + i) * 16 + 1] - p0[i * 3 + 1],
              d[(n0 + i) * 16 + 2] - p0[i * 3 + 2]
            )
          );
        console.log('loop: after one period of ' + a.period + 's the pose is off by at most ' + mx.toFixed(3));
      }
    }
  },
  selftest() {
    process.exit(require('./selftest.js')(lib()) ? 1 : 0);
  },
  snap() {
    fs.mkdirSync(SNAPS, { recursive: true });
    const ids = pos[0] === 'all' ? lib().SCENES.map(s => s.id) : pos;
    if (!ids.length) die('snap which diorama? (or: all)');
    for (const id of ids) {
      const w = build(id),
        ts = opt.t !== undefined ? list('t') : w.anim ? [0, 1.7] : [0];
      for (const t of ts) {
        pose(w, t);
        const im = R.render(w, { t });
        PNG.write(path.join(SNAPS, w.id + '@' + t + '.png'), im.w, im.h, im.rgb);
      }
      console.log('kept', w.id, 'at', ts.join(', '));
    }
  },
  /* a diorama beside a reference picture, both at true pixel size: the reference brought down to its art pixels (--px: how many of
     its pixels make one, as 2 for a picture shown at twice its size), the diorama drawn at the same size in art pixels, the two side
     by side scaled up alike (--up, 3), and the crisp measures of each, so a look can be held to a picture it is after */
  /* pixel-art lint: the mistakes pixel artists name, at a diorama's own pixel size, beside what the references come to (the medians
     of the pixel-art references at their own size): orphan pixels, doubles (lines two pixels thick at a step), jaggies (uneven steps
     along an edge), banding (tones that only echo an edge), pillow shading (darker all round the rim, whichever way it faces), noise
     (clusters of three pixels or fewer) and colours. --map writes where each is: orphans red, doubles magenta, jaggies yellow,
     banding cyan */
  lint() {
    const Cr = require('./critic.js'),
      ids = pos.length ? pos : die('lint <id ...> [--map --ortho]'),
      keys = ['orphans', 'doubles', 'jaggies', 'banding', 'pillow', 'noise', 'colours'],
      fmt = (k, v) => (k === 'colours' ? String(v) : (v * 100).toFixed(1) + '%');
    console.log(''.padEnd(16) + keys.map(k => k.padStart(10)).join(''));
    console.log('references'.padEnd(16) + keys.map(k => fmt(k, Cr.REFERENCE[k]).padStart(10)).join(''));
    for (const id of ids) {
      const t = num('t', 2),
        w = build(id);
      pose(w, t);
      const im = R.render(w, view({ t })),
        img = { w: im.w, h: im.h, rgb: im.rgb || im.color },
        r = Cr.lint(img, { bg: (im.palette || w.pal)[0] });
      console.log(w.id.padEnd(16) + keys.map(k => fmt(k, r[k]).padStart(10)).join(''));
      if (opt.map) save(w.id + '-lint.png', R.upscale(Cr.lintMap(img, r), im.px));
    }
  },
  /* a review sheet: the diorama from a fixed set of shots (its own view, its four sides, from above, from low down, far, near and
     close), one sheet, with the lint of each under its label in the log; beside the last sheet of it (kept as -review-before.png),
     so a change can be seen. --ref picture.png --px 2 puts a reference first */
  review() {
    const Cr = require('./critic.js'),
      [id] = pos.length ? pos : die('review <id> [--ref picture.png --px 2 --ortho]'),
      t = num('t', 2),
      w = build(id),
      c = w.cam || {},
      shots = [];
    pose(w, t);
    for (const [label, dy, pitch, zoom] of Cr.SHOTS) {
      const im = R.render(
        w,
        view({
          t,
          w: num('w', 480),
          h: num('h', 340),
          yaw: (opt.yaw === undefined ? c.yaw || 0 : +opt.yaw) + dy,
          pitch: pitch === null ? (opt.pitch === undefined ? c.pitch : +opt.pitch) : pitch,
          zoom
        })
      );
      const img = { w: im.w, h: im.h, rgb: im.rgb || im.color },
        r = Cr.lint(img, { bg: (im.palette || w.pal)[0] });
      console.log(
        label.padEnd(8),
        ['orphans', 'doubles', 'jaggies', 'banding', 'pillow']
          .map(k => k + ' ' + (r[k] * 100).toFixed(1) + '%')
          .join('  ')
      );
      shots.push(R.upscale(img, im.px));
    }
    if (opt.ref) {
      const k = num('px', 1),
        src = PNG.read(path.resolve(opt.ref)),
        W = Math.floor(src.w / k),
        H = Math.floor(src.h / k),
        ref = { w: W, h: H, rgb: new Uint8Array(W * H * 3) };
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const s0 =
            (Math.min(src.h - 1, Math.floor(y * k + k / 2)) * src.w + Math.min(src.w - 1, Math.floor(x * k + k / 2))) *
            3;
          ref.rgb.set(src.rgb.subarray(s0, s0 + 3), (y * W + x) * 3);
        }
      const up = Math.max(1, Math.round(shots[0].h / H));
      shots.unshift(R.upscale(ref, up));
    }
    // (the shots padded to one size, for the sheet)
    const SW = Math.max(...shots.map(q => q.w)),
      SH = Math.max(...shots.map(q => q.h)),
      pad = q => {
        const o = { w: SW, h: SH, rgb: new Uint8Array(SW * SH * 3) };
        for (let y = 0; y < q.h; y++) o.rgb.set(q.rgb.subarray(y * q.w * 3, (y + 1) * q.w * 3), y * SW * 3);
        return o;
      },
      sheet = R.grid(shots.map(pad), num('cols', 3)),
      file = path.join(OUT, w.id + '-review.png'),
      before = path.join(OUT, w.id + '-review-before.png');
    fs.mkdirSync(OUT, { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, before);
    save(w.id + '-review.png', sheet);
    if (fs.existsSync(before)) {
      const b = PNG.read(before);
      if (b.w === sheet.w && b.h === sheet.h) save(w.id + '-review-vs-before.png', R.grid([b, sheet], 2));
    }
  },
  /* shimmer: the diorama over a short move of the camera (--mode orbit, zoom, pan, or still: the camera at rest while time runs),
     frame by frame at one pixel size; the share of pixels that change and change back (A, B, A over three frames), which a smooth
     move should not cause, and an animated GIF of it (--frames 24, --step: how far each frame moves) */
  shimmer() {
    const Cr = require('./critic.js'),
      [id] = pos.length ? pos : die('shimmer <id> [--mode orbit|zoom|pan|still --frames 24 --step s --ortho]'),
      t0 = num('t', 2),
      n = num('frames', 24),
      mode = opt.mode || 'orbit',
      w = build(id),
      c = w.cam || {},
      frames = [];
    const motionalCoverageHistory = require('../index.js').createMotionalCoverageHistory();
    const st = num('step', mode === 'orbit' ? 0.004 : mode === 'zoom' ? 0.012 : mode === 'pan' ? 0.02 : 1 / 12);
    let px = 0, bg = w.pal[0];
    for (let k = 0; k < n; k++) {
      const t = mode === 'still' ? t0 + k * st : t0;
      pose(w, t);
      const v = view({ t, w: num('w', 480), h: num('h', 340), motionalCoverageHistory }),
        T = (v.target || c.target || [0, 0, 0]).slice();
      if (mode === 'orbit') v.yaw = (v.yaw === undefined ? c.yaw || 0 : v.yaw) + k * st;
      if (mode === 'zoom') v.zoom = (v.zoom || 1) * (1 + k * st);
      if (mode === 'pan') v.target = [T[0] + k * st, T[1], T[2] + k * st * 0.5];
      if (px) v.px = px;
      const im = R.render(w, v);
      px = px || im.px;
      bg = (im.palette || w.pal)[0];
      frames.push({ w: im.w, h: im.h, rgb: im.rgb || im.color });
    }
    const fl = Cr.flicker(frames, { bg });
    console.log(w.id + ' ' + mode + ': ' + (fl * 100).toFixed(2) + '% of pixels flicker (change and change back)');
    fs.mkdirSync(OUT, { recursive: true });
    const f = opt.out ? path.resolve(opt.out) : path.join(OUT, w.id + '-shimmer-' + mode + '.gif');
    fs.writeFileSync(
      f,
      Cr.gif(
        frames.map(q => R.upscale(q, Math.max(1, Math.min(4, px)))),
        Math.round(num('delay', 8))
      )
    );
    console.log('wrote', f);
  },
  /* paint-over: a view of the diorama at its own pixel size, to be painted over by hand or by a script, and the painted pixels taken
     back as decals: each pinned to the place on the surface it fell on (a pixel painted just past an edge is put on the surface beside
     it, carried on), so it stays put from every view. The decals are kept in studio/paint/<id>/decals.json; the game's build puts
     them in the page, and the CLI draws them at once */
  paint() {
    if (['mix', 'ramp', 'table', 'swatches'].includes(pos[0])) return require('./paint.js')(pos, opt, lib());
    const [sub, id] = pos;
    if (!['export', 'absorb', 'clear', 'layers', 'tune', 'cause'].includes(sub) || !id)
      die(
        'paint export|absorb|layers|tune|clear <id> [--layer name] [--dir studio/paint/<id>], or paint cause <id> <recipe.json> [--replace]'
      );
    const Paint = require('../src/paint-corrections.js'), name = opt.layer;
    if (name !== undefined && !Paint.idOK(name)) die('Paint layer needs a lowercase ID');
    if (sub === 'cause' && (pos.length !== 3 || name !== undefined || opt.replace !== undefined && opt.replace !== true ||
        opt.events !== undefined && typeof opt.events !== 'string'))
      die('paint cause <scene> <recipe.json> [--events <run-or-checkpoint.json>] [--dir path] [--replace]');
    if (sub === 'tune' && name === undefined) die('Paint tune needs --layer name');
    if (sub === 'absorb' && !name && ['angle', 'feather', 'opacity', 'region'].some(key => opt[key] !== undefined))
      die('Paint controls need a named layer');
    const world = sub === 'cause' ? build(id, undefined, { paint:false,retainSdf:true }) :
      sub === 'export' ? build(id, undefined, { paint: name === undefined }) : null,
      dir = paintDirectory(opt.dir ? id : world ? world.id : scene(id).id),
      dfile = path.join(dir, 'decals.json'),
      capture = name ? path.join(dir, 'layers', name) : dir;
    function save(doc) {
      const tmp = dfile + '.' + require('node:crypto').randomUUID() + '.tmp';
      try {
        fs.writeFileSync(tmp, JSON.stringify(doc), { flag: 'wx' });
        fs.renameSync(tmp, dfile);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    function controls(prior) {
      const value = option => {
        if (opt[option] === true) throw Error('--' + option + ' needs a number');
        return num(option);
      };
      if (prior?.type === 'surface' && (opt.angle !== undefined || opt.feather !== undefined))
        die('Surface paint uses opacity and region. Angle and feather belong to camera captures.');
      const angle = value('angle') ?? prior?.angle;
      const feather = value('feather') ?? (prior?.feather === undefined ? undefined : Math.min(prior.feather, angle));
      const opacity = value('opacity') ?? prior?.opacity;
      let region = prior?.region;
      if (opt.region !== undefined) {
        if (typeof opt.region !== 'string') throw Error('--region needs JSON, a file, or off');
        region = opt.region === 'off' ? undefined :
          JSON.parse(fs.existsSync(opt.region) ? fs.readFileSync(opt.region, 'utf8') : opt.region);
      }
      return { angle, feather, opacity, region };
    }
    if (sub === 'cause') {
      const recipe = JSON.parse(fs.readFileSync(path.resolve(pos[2]),'utf8'));
      const { surfaceMarks, world: { runtime } } = lib().KIT;
      const source = opt.events && JSON.parse(fs.readFileSync(path.resolve(opt.events),'utf8'));
      function* committedEvents() {
        if (source?.version === 1 && source.format === runtime.checkpointFormat &&
            Array.isArray(source.history) && Array.isArray(source.events)) {
          yield* source.history;
          yield* source.events;
          return;
        }
        if (source?.format !== runtime.runFormat) die('--events needs a world run recording or checkpoint');
        const run = runtime.openRecording(source);
        yield* run.events;
        while (run.view().tick < source.end.tick) {
          run.step();
          yield* run.events;
        }
        if (!runtime.checkpointsEqual(run.checkpoint(),source.end)) die('Event recording diverged from its saved end checkpoint');
      }
      const generated = opt.events ? surfaceMarks.bakeEvents(world,committedEvents(),recipe) : surfaceMarks.bake(world,recipe);
      const existing = readPaint(dfile);
      const doc = Array.isArray(existing) ? {decals:existing} : existing;
      const layers = Paint.layers(doc);
      const added = [], kept = [], report = ({ id, decals, sourceEvent }) => ({
        id, samples:decals.length, ...(sourceEvent && { sourceEvent })
      });
      for (const layer of generated.layers) {
        const slot=layers.findIndex(entry=>entry.id===layer.id);
        if (slot<0) layers.push(layer);
        else if (layer.sourceEvent && JSON.stringify(layers[slot].sourceEvent) === JSON.stringify(layer.sourceEvent)) {
          if (opt.replace) layers[slot]=layer;
          else {
            kept.push(report(layers[slot]));
            continue;
          }
        } else if (opt.replace && !layer.sourceEvent) layers[slot]=layer;
        else die('Paint layer '+layer.id+' already exists.' + (layer.sourceEvent ? ' Give this run or rule a distinct ID.' :
          ' Use --replace to rebake it.'));
        added.push(report(layer));
      }
      if (added.length) {
        fs.mkdirSync(dir,{recursive:true});
        save({ ...doc,id:world.id,detail:world.detail,layers });
      }
      console.log(JSON.stringify({file:dfile,layers:added,...(kept.length && {kept})},null,2));
      return;
    }
    if (sub === 'layers') {
      const { decals = [], ...doc } = readPaint(dfile);
      console.log(JSON.stringify({ permanent: decals.length, layers: Paint.layers(doc).map(({ decals, ...layer }) =>
        ({ ...layer, samples: decals.length })) }, null, 2));
      return;
    }
    if (sub === 'clear') {
      if (name) {
        const doc = readPaint(dfile), layers = Paint.layers(doc);
        if (!layers.some(layer => layer.id === name)) die('Unknown paint layer ' + name);
        save({ ...doc, layers: layers.filter(layer => layer.id !== name) });
      } else if (fs.existsSync(dfile)) fs.unlinkSync(dfile);
      console.log('cleared', dfile);
      return;
    }
    if (sub === 'tune') {
      const doc = readPaint(dfile), layers = Paint.layers(doc), slot = layers.findIndex(layer => layer.id === name);
      if (slot < 0) die('Unknown paint layer ' + name);
      layers[slot] = Paint.layer({ ...layers[slot], ...controls(layers[slot]) });
      save({ ...doc, layers });
      console.log('updated paint layer', name);
      return;
    }
    if (sub === 'export') {
      const t = num('t', 2),
        w = world;
      pose(w, t);
      const pick = {},
        vw = view({ t, pick, ...(name && { paintCorrections: false }) }),
        im = R.render(w, vw);
      if (!pick.W)
        die('paint: ' + id + ' is not drawn per pixel (its look.pixel), so there is nothing to pin paint to');
      fs.mkdirSync(capture, { recursive: true });
      const { W, H } = pick,
        buf = new Float32Array(W * H * 6).fill(NaN);
      for (let r = 0; r < H; r++)
        for (let x = 0; x < W; x++) {
          const q = (H - 1 - r) * W + x,
            i = pick.win[q];
          if (i < 0 || !pick.PIX[i * 8]) continue;
          buf.set(
            [pick.X[q], pick.Y[q], pick.Z[q], pick.PIX[i * 8 + 3], pick.PIX[i * 8 + 4], pick.PIX[i * 8 + 5]],
            (r * W + x) * 6
          );
        }
      PNG.write(path.join(capture, 'view.png'), im.w, im.h, im.rgb);
      PNG.write(path.join(capture, 'paint.png'), im.w, im.h, im.rgb);
      fs.writeFileSync(path.join(capture, 'view.bin'), Buffer.from(buf.buffer));
      fs.writeFileSync(
        path.join(capture, 'view.json'),
        JSON.stringify(
          {
            id,
            w: W,
            h: H,
            t,
            camera: pick.camera,
            view: { yaw: vw.yaw, pitch: vw.pitch, zoom: vw.zoom, target: vw.target, ortho: vw.ortho },
            detail: w.detail,
            pal: w.pal.map(c => '#' + c.toString(16).padStart(6, '0')),
            how:
              'paint over paint.png in the palette colours (#ff00ff takes paint off), then: ink-studio paint absorb ' +
              id + (name ? ' --layer ' + name : '')
          },
          null,
          1
        )
      );
      console.log(
        'wrote',
        path.join(capture, 'paint.png'),
        W + 'x' + H,
        '(paint over it, then: ink-studio paint absorb ' + id + (name ? ' --layer ' + name : '') + ')'
      );
      return;
    }
    // absorb
    const meta = JSON.parse(fs.readFileSync(path.join(capture, 'view.json'), 'utf8')),
      raw = fs.readFileSync(path.join(capture, 'view.bin')),
      buf = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4),
      a = PNG.read(path.join(capture, 'view.png')),
      b = PNG.read(path.resolve(opt.png || path.join(capture, 'paint.png'))),
      W = meta.w,
      H = meta.h;
    if (b.w !== a.w || b.h !== a.h)
      die('paint: the painted picture is ' + b.w + 'x' + b.h + ', the view ' + a.w + 'x' + a.h);
    if (W !== a.w || H !== a.h || buf.length !== W * H * 6)
      die('Paint capture metadata and surface coordinates do not match the view');
    if (opt['paint-mask'] !== undefined && (!name || typeof opt['paint-mask'] !== 'string'))
      die('--paint-mask needs a PNG path and a named paint layer');
    const mask = opt['paint-mask'] && PNG.raster(path.resolve(opt['paint-mask']));
    if (mask && (mask.w !== W || mask.h !== H)) die('The paint mask must have the same dimensions as paint.png');
    const pal = meta.pal.map(h => parseInt(h.slice(1), 16)),
      nearest = (r, g, bl) => {
        let best = 0,
          bd = 1e9;
        pal.forEach((c, i) => {
          const d = (((c >> 16) & 255) - r) ** 2 + (((c >> 8) & 255) - g) ** 2 + ((c & 255) - bl) ** 2;
          if (d < bd) ((bd = d), (best = i));
        });
        return [best, bd];
      },
      ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && buf[(y * W + x) * 6] === buf[(y * W + x) * 6],
      P3 = (x, y) => Array.from(buf.subarray((y * W + x) * 6, (y * W + x) * 6 + 6)),
      px = 1 / (meta.detail || 12);
    let off = 0,
      lost = 0;
    const fresh = [],
      erase = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 3;
        if (a.rgb[k] === b.rgb[k] && a.rgb[k + 1] === b.rgb[k + 1] && a.rgb[k + 2] === b.rgb[k + 2]) continue;
        const del = b.rgb[k] === 255 && b.rgb[k + 1] === 0 && b.rgb[k + 2] === 255;
        let at = null;
        if (ok(x, y)) at = P3(x, y);
        else {
          // (past the edge of a thing: the nearest pixel that has a surface, carried on across the picture by how it changes there)
          for (let r = 1; r <= 4 && !at; r++)
            for (let dy = -r; dy <= r && !at; dy++)
              for (let dx = -r; dx <= r && !at; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !ok(x + dx, y + dy)) continue;
                const nx = x + dx,
                  ny = y + dy,
                  q = P3(nx, ny),
                  gx = ok(nx + 1, ny)
                    ? P3(nx + 1, ny)
                    : ok(nx - 1, ny)
                      ? P3(nx - 1, ny).map((v, i) => 2 * q[i] - v)
                      : q,
                  gy = ok(nx, ny + 1)
                    ? P3(nx, ny + 1)
                    : ok(nx, ny - 1)
                      ? P3(nx, ny - 1).map((v, i) => 2 * q[i] - v)
                      : q;
                at = q.slice();
                for (let i = 0; i < 3; i++) at[i] = q[i] + (gx[i] - q[i]) * -dx + (gy[i] - q[i]) * -dy;
              }
        }
        if (!at) {
          lost++;
          continue;
        }
        if (del) {
          erase.push(at);
          continue;
        }
        const [ci, d] = nearest(b.rgb[k], b.rgb[k + 1], b.rgb[k + 2]);
        if (d > 12) off++;
        const row = [...at.map(v => Math.round(v * 1e4) / 1e4), ci];
        if (mask) {
          const i = (y * W + x) * 4, d = mask.data;
          row.push(Math.min(1, (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) * d[i + 3] / mask.max ** 2));
        }
        fresh.push(row);
      }
    const doc = readPaint(dfile), layers = name && Paint.layers(doc),
      slot = name ? layers.findIndex(layer => layer.id === name) : -1,
      prior = name && layers[slot], surface = prior?.type === 'surface',
      source = name && !surface && Paint.view(meta.camera),
      captureMatches = prior && (surface || prior.time === meta.t && Paint.sameView(prior.view, source)),
      old = name ? (captureMatches ? prior.decals : []) : doc.decals ?? [],
      near = (d, e) => Math.hypot(d[0] - e[0], d[1] - e[1], d[2] - e[2]) < px * 0.45,
      kept = old.filter(d => !fresh.some(e => near(d, e)) && !erase.some(e => near(d, e))),
      decals = kept.concat(fresh);
    if (name) {
      const placement = surface ? {type:'surface',sourceEvent:prior.sourceEvent} : {view:source,time:meta.t};
      const correction = Paint.layer({ id: name, ...placement, ...controls(prior), decals });
      if (slot < 0) layers.push(correction);
      else layers[slot] = correction;
      save({ ...doc, id, detail: meta.detail, layers });
    } else save({ ...doc, id, detail: meta.detail, decals });
    console.log(
      `${fresh.length} pixels painted, ${erase.length} taken off; ${decals.length} decals in ${dfile}` +
        (off ? `; ${off} were not palette colours (the nearest was taken)` : '') +
        (lost ? `; ${lost} had no surface within 4 pixels and were left out` : '')
    );
  },
  compare() {
    const [id, ref] = pos;
    if (opt['curve-modes'] !== undefined) {
      if (opt['curve-modes'] !== true || pos.length !== 1 || opt.out === true || opt.w === undefined ||
          opt.w === true || opt.h === undefined || opt.h === true ||
          ['looks', 'curve-mode', 'curve-splats', 'px', 'up'].some(flag => opt[flag] !== undefined) ||
          ['t', 'from', 'to', 'fps'].some(flag => opt[flag] === true))
        die('Use compare <scene> --curve-modes --w WIDTH --h HEIGHT [--t TIME | --from START --to END --fps RATE] [--out directory]');
      const world = buildPreview(), frame = view(), directory = outputFile('curve-modes');
      const time = num('t'), from = num('from'), to = num('to');
      const replay = feedbackReplay(world, from ?? time ?? 0, frame);
      const result = require('./curve-compare.js').writeCurveComparison(world, {
        kit: lib(), frame, time, from, to, fps: num('fps', 12), camera: clipCamera(world), replay, samplePose: pose
      }, directory);
      console.log('wrote', directory, result.frames.length, 'matched frames at', result.width + 'x' + result.height, 'art pixels per mode');
      return;
    }
    if (opt.looks !== undefined || /\.json$/i.test(ref ?? '')) {
      const file = opt.looks ?? ref;
      if (!id || typeof file !== 'string') die('compare needs a scene and --looks cases.json');
      if (opt.out !== undefined && (typeof opt.out !== 'string' || !/\.png$/i.test(opt.out)))
        die('A look comparison image needs --out sheet.png');
      if (typeof opt.report === 'string' && (path.resolve(id) === path.resolve(opt.report) ||
        opt.out && path.resolve(opt.out) === path.resolve(opt.report))) die('--report needs a separate path');
      const cases = JSON.parse(fs.readFileSync(file, 'utf8'));
      const comparison = opt.comparison === undefined ? null : lib().KIT.comparison.settings({
        mode: opt.comparison,divider:num('divider',.5),axis:opt['swipe-axis']??'x',
        difference:{channel:opt['difference-channel']??'luminance',gain:num('difference-gain',3)}
      });
      if (comparison && (!opt.out || !Array.isArray(cases) || cases.length!==2))
        die('--comparison needs two look cases and --out');
      const Preview = require('./look-preview.js');
      let world = worldCLI().lookSnapshot(id);
      if (!world) {
        world = Preview.withAlbedo(() => build(id));
        pose(world, num('t', 0));
      }
      const time = world.lookSnapshot?.time ?? num('t', 0);
      const { report, frames } = require('./look-compare.js').compare(world, cases, lib(),
        view({ t: time, px: num('px', 1) }), { opt, file, images: Boolean(opt.out) });
      if (opt.out) {
        const up = num('up', 1), cols = num('cols', Math.min(4, frames.length));
        if (![up, cols].every(n => Number.isSafeInteger(n) && n > 0)) die('--up and --cols need positive integers');
        const sheet = comparison ? R.upscale(lib().KIT.comparison.compose(...frames,comparison),up) :
          R.grid(frames.map(frame => R.upscale(frame, up)), cols, report.results.map(row => String(row.id)));
        fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
        PNG.write(opt.out, sheet.w, sheet.h, sheet.rgb);
      }
      return require('./look.js').report(report, { out: opt.report }, file);
    }
    if (!id || !ref) die('compare <id> <reference.png> [--px 2 --up 3]');
    const C = require('./crisp.js');
    const k = num('px', 1),
      src = PNG.read(path.resolve(ref)),
      W = Math.floor(src.w / k),
      H = Math.floor(src.h / k),
      rimg = { w: W, h: H, rgb: new Uint8Array(W * H * 3) };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s0 =
          (Math.min(src.h - 1, Math.floor(y * k + k / 2)) * src.w + Math.min(src.w - 1, Math.floor(x * k + k / 2))) * 3;
        rimg.rgb.set(src.rgb.subarray(s0, s0 + 3), (y * W + x) * 3);
      }
    // (a reference with more colours than a pixel artist's palette, as a JPEG has, is brought to --colours of them, 32 by default)
    const seen = new Set();
    for (let i = 0; i < W * H && seen.size <= 256; i++)
      seen.add((rimg.rgb[i * 3] << 16) | (rimg.rgb[i * 3 + 1] << 8) | rimg.rgb[i * 3 + 2]);
    if (seen.size > 256 || opt.colours) Object.assign(rimg, C.quantize(rimg, num('colours', 32)));
    const t = num('t', 2),
      w = buildPreview();
    pose(w, t);
    // Use one art pixel per reference pixel, regardless of the scene's detail setting.
    const im = R.render(w, view({ t, w: W, h: H, px: 1 })),
      cols = ['stray', 'specks', 'flat', 'fine', 'edges', 'spread', 'cool', 'colours'],
      fmt = (c, v) => {
        if (!Number.isFinite(v)) return 'n/a';
        if (c === 'fine') return v.toFixed(3);
        return c === 'colours' ? String(v) : (v * 100).toFixed(1) + '%';
      },
      mr = C.measure(rimg, { bg: (rimg.rgb[0] << 16) | (rimg.rgb[1] << 8) | rimg.rgb[2] }), // (its corner colour, joined to the edge, is its background)
      md = C.measure(im, { bg: (im.palette || w.pal)[0] });
    console.log(''.padEnd(16) + cols.map(c => c.padStart(10)).join(''));
    console.log(path.basename(ref).slice(0, 15).padEnd(16) + cols.map(c => fmt(c, mr[c]).padStart(10)).join(''));
    console.log(w.id.padEnd(16) + cols.map(c => fmt(c, md[c]).padStart(10)).join(''));
    const up = num('up', 3),
      a = R.upscale(rimg, up),
      b = R.upscale(im, up);
    save(w.id + '-vs-' + path.basename(ref).replace(/\.[a-z]+$/i, '') + '.png', R.grid([a, b], 2));
  },
  /* how crisp a diorama is at its own pixel size, beside what the pixel-art references came to: stray pixels (unlike all eight round
     them), specks (in same-colour patches of 3 or fewer), flat area (like all eight), the share of brightness variation at the finest
     frequencies, how much of it runs straight across or down, checker (dither) and how many colours make up 95% of it.
     A mark (!) is a target missed. --map writes where the stray pixels are. --t, and the view options, as for render */
  crisp() {
    const C = require('./crisp.js'),
      ids = pos[0] === 'all' ? lib().SCENES.map(s => s.id) : pos;
    if (!ids.length) die('crisp which diorama? (or: all)');
    const t = num('t', 2),
      pc = v => (v * 100).toFixed(1) + '%',
      cols = ['stray', 'specks', 'flat', 'fine', 'straight', 'edges', 'spread', 'cool', 'checker', 'colours'],
      fmt = (k, v) => {
        if (!Number.isFinite(v)) return 'n/a';
        if (k === 'fine' || k === 'straight') return v.toFixed(3);
        return k === 'colours' ? String(v) : pc(v);
      },
      miss = (k, v) =>
        C.FLOORS[k] !== undefined
          ? v >= C.FLOORS[k]
            ? ' '
            : '!'
          : C.TARGETS[k] === undefined
            ? ' '
            : (k === 'flat' ? v >= C.TARGETS[k] : v <= C.TARGETS[k])
              ? ' '
              : '!';
    console.log('diorama'.padEnd(16) + cols.map(c => c.padStart(11)).join(''));
    console.log(
      'references'.padEnd(16) +
        cols.map(c => (C.REFERENCE[c] ? fmt(c, C.REFERENCE[c][2]) : '').padStart(10) + ' ').join('') +
        '  (median of 8 at true pixel size)'
    );
    console.log(
      'targets'.padEnd(16) +
        cols
          .map(
            c =>
              (C.FLOORS[c] !== undefined
                ? '>' + fmt(c, C.FLOORS[c])
                : C.TARGETS[c] === undefined
                  ? ''
                  : (c === 'flat' ? '>' : '<') + fmt(c, C.TARGETS[c])
              ).padStart(10) + ' '
          )
          .join('')
    );
    let missed = 0;
    for (const id of ids) {
      const w = build(id);
      pose(w, t);
      const im = R.render(w, view({ t })),
        m = C.measure(im, { bg: (im.palette || w.pal)[0] });
      const marks = cols.map(c => (Number.isFinite(m[c]) ? miss(c, m[c]) : ' '));
      missed += marks.some(x => x === '!') ? 1 : 0;
      console.log(w.id.padEnd(16) + cols.map((c, i) => fmt(c, m[c]).padStart(10) + marks[i]).join(''));
      if (opt.map) {
        save(w.id + '-stray.png', R.upscale(C.strayMap(im, { bg: (im.palette || w.pal)[0] }), im.px));
        save(w.id + '-edges.png', R.upscale(C.edgeMap(im, { bg: (im.palette || w.pal)[0] }), im.px));
      }
    }
    if (ids.length > 1) console.log(missed + ' of ' + ids.length + ' miss a target');
  },
  check() {
    const files = fs.existsSync(SNAPS)
      ? fs
          .readdirSync(SNAPS)
          .filter(f => f.endsWith('.png') && (!pos.length || pos.includes(f.split('@')[0])))
          .sort()
      : [];
    if (!files.length) die('no reference pictures: make some with  ink-studio snap <id>');
    let fails = 0,
      cur = null,
      w = null;
    for (const f of files) {
      const [id, tt] = f.replace('.png', '').split('@'),
        t = +tt;
      if (id !== cur) {
        w = build(id);
        cur = id;
      }
      pose(w, t);
      const im = R.render(w, { t }),
        ref = PNG.read(path.join(SNAPS, f));
      let diff = 0;
      if (ref.w !== im.w || ref.h !== im.h) diff = im.w * im.h;
      else
        for (let i = 0; i < im.w * im.h; i++)
          if (
            ref.rgb[i * 3] !== im.rgb[i * 3] ||
            ref.rgb[i * 3 + 1] !== im.rgb[i * 3 + 1] ||
            ref.rgb[i * 3 + 2] !== im.rgb[i * 3 + 2]
          )
            diff++;
      const pct = (100 * diff) / (im.w * im.h),
        ok = pct <= num('allow', 0.2);
      if (!ok) {
        fails++;
        fs.mkdirSync(OUT, { recursive: true });
        const both = R.grid([R.upscale(ref.w === im.w && ref.h === im.h ? ref : im, 3), R.upscale(im, 3)], 2, [
          '0',
          '1'
        ]);
        PNG.write(path.join(OUT, 'check-' + id + '@' + t + '.png'), both.w, both.h, both.rgb);
      }
      console.log(
        (ok ? 'same     ' : 'CHANGED  ') +
          f.padEnd(26) +
          pct.toFixed(2) +
          '% of pixels differ' +
          (ok ? '' : '   (before | after in studio/out/check-' + id + '@' + t + '.png)')
      );
    }
    console.log(fails ? fails + ' changed' : 'all ' + files.length + ' the same');
    process.exit(fails ? 1 : 0);
  }
};
async function run() {
  const mode = Shot.modeFor(cmd,pos);
  if (opt.recipe !== undefined)
    shot = Shot.createRecorder(opt.recipe,{mode,scene:pos[cmd === 'sim' ? 1 : 0],options:opt,root:CWD});
  shotReplay = Shot.replayState(mode);
  shotRender = shot?.render ?? shotReplay?.render;
  if (worldCommands.has(cmd)) {
    await worldCLI().execute(cmd,pos);
    shotReplay?.verify();
    return;
  }
  const splatFiles = cmd === 'snap' ? pos.filter(gaussianFile) : ['render', 'turn', 'sheet', 'clip'].includes(cmd)
    ? pos.slice(0, 1).filter(gaussianFile) : [];
  if (splatFiles.length) {
    const ink = require('../index.js');
    const { gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
    for (const file of new Set(splatFiles)) {
      const cloud = await ink.readGaussianSplat(path.resolve(file));
      const name = path.basename(file), id = name.replace(/\W+/g, '-');
      gaussianScenes.set(file, {
        id, name, seed: 1,
        build: () => gaussianSplatWorld(cloud, { size: num('size', 6), up: opt.up })
      });
    }
  }
  if (/\.glb$/i.test(pos[0] || '') && opt.uv !== 'off') {
    try {
      importedAssets.set(path.resolve(pos[0]), await require('../index.js').readAsset(path.resolve(pos[0]), { size: 3 }));
    } catch (error) {
      if (opt.uv === true) throw error;
      console.error('UV asset import unavailable: ' + error.message + '. Using the geometry importer. Pass --uv to require UV import.');
    }
  }
  await (CMD[cmd] || (() => die('unknown command "' + cmd + '". try: ink-studio help')))();
  shotReplay?.verify();
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
