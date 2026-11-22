// ink-studio: sculpt with signed distance, bake to pixel-art gaussian splats, and look at the result without a browser.
// The sources are plain scripts (they are concatenated into a web page as they stand), so this file offers them three ways:
//   files()   the library's source files, in the order they must be loaded
//   bundle()  those files as one piece of text, to put in a page or in front of your own scripts
//   load()    the prebuilt Node toolkit and demos, or a source build in a development checkout
const fs = require('fs'),
  path = require('path'),
  { createHash, randomUUID } = require('crypto');
const KIT_DIR = path.join(__dirname, 'src', 'kit'),
  read = f => fs.readFileSync(f, 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
// Keep the browser bake profile on the shared core and the kit modules used by
// direct sculpting, materials, rigs, captured light, and native splat delivery.
const bakeKit = new Set([
  'k0-math.js', 'k0-ownership.js', 'k1-stage.js', 'k2-motion.js', 'k3-shapes.js', 'k4-art.js',
  'k5-fields.js', 'k8-light.js', 'ka-build.js', 'kb-mesh.js', 'ke-volume.js', 'ki-deform.js', 'kl-vox.js', 'km-ramp.js',
  'kn-afterimages.js', 'kn-scene-optics.js', 'ko-grow.js', 'kp-curve.js', 'kpx-pixel.js',
  'kq-surface-presets.js', 'kr-tex.js', 'kt-nodes.js', 'kv-form.js', 'kz-weather.js', 'kza-ascii.js',
  'p00-procedural.js', 'p01-cutaway.js', 'p01-procedural-surfaces.js', 'p01-splat-sample-state.js',
  'p02-procedural-mesh.js', 'p04-profile-triangulation.js', 'p17-profile-distance.js', 'p1b-sample-coverage.js',
  'p39-noise-fields.js', 'p40-field-composition.js', 'p43-render-grid.js', 'p44-splat-footprints.js',
  'p59-sculptural-fields.js', 'p68-drawing.js', 'p69-material-masks.js', 'p73-blue-noise.js', 'p95-weather-tracks.js'
]);
const files = () =>
  [
    'src/story-analysis.js',
    'src/story-document.js', 'src/stippling.js', 'src/splat-footprints.js', 'src/surface-brush.js', 'src/brushwork.js', 'src/screen-print.js', 'src/engraving.js', 'src/render-grid.js', 'src/randomness.js', 'src/fft.js', 'src/math-fields.js', 'src/typography-truetype.js', 'src/typography.js', 'src/frame-budget.js', 'src/target-inspection.js', 'src/drawing-primitives.js', 'src/palette-cycles.js', 'src/raster-schedule.js', 'src/texture-address.js', 'src/view-annotations.js', 'src/frame-composite.js', 'src/composite-video.js', 'src/frame-bank.js', 'src/motion-smear.js', 'src/ink-veil.js', 'src/textured-surface.js', 'src/palette-resampling.js', 'src/shadow-shell.js', 'src/sprite-surface.js', 'src/sprite-scanline-budget.js', 'src/render-outputs.js', 'src/camera-atlas.js', 'src/sprite-cels.js', 'src/sprite-fringe.js', 'src/sprite-transitions.js', 'src/atlas-sprites.js', 'src/target-selectors.js', 'src/sprite-reconstruction.js', 'src/camera-lens.js', 'src/camera-impulses.js', 'src/camera-staging.js', 'src/splat-provenance.js',
    'src/art-passes.js', 'src/art-direction.js', 'src/art-ink.js', 'src/art-effects.js', 'src/art-stability.js', 'src/cluster-coherence.js', 'src/color-clusters.js', 'src/shot-corrections.js', 'src/stable-detail.js', 'src/edge-filter.js', 'src/translucent-silhouettes.js', 'src/motional-coverage.js', 'src/material-pixel-style.js', 'src/glitter-burst-cels.js', 'src/pixel-tile-cels.js', 'src/reconnecting-tile-cels.js', 'src/contact-mark-cels.js', 'src/highlight-cel-presets.js', 'src/shore-foam-presets.js', 'src/boundary-cel-presets.js', 'src/pixel-stamp-presets.js', 'src/pixel-stamps.js', 'src/boundary-cels.js',
    'src/color-space.js', 'src/paint-corrections.js', 'src/color-curves.js', 'src/color-lut.js', 'src/color-stack.js', 'src/pixel-look.js', 'src/palette-fields.js', 'src/palette-extract.js', 'src/palette-distributions.js', 'src/reflection-plane.js', 'src/reflection-detail.js', 'src/airflow.js', 'src/wind-field.js', 'src/light-schedule.js', 'src/geometric-caustics.js', 'src/light-cookies.js', 'src/area-lights.js', 'src/shadow-cutouts.js', 'src/emissive-finishes.js',
    'src/route-visibility.js', 'src/sample-coverage.js', 'src/contribution-rules.js', 'src/sample-visibility.js', 'src/swept-disc.js', 'src/splat-order.js', 'src/cutaway.js', 'src/splat-codec.js', 'src/ripple-field.js',
    'src/volume-field.js', 'src/field-bands.js', 'src/atmosphere-palette.js', 'src/geometry-density.js', 'src/volume-cutouts.js', 'src/cloud-recipes.js', 'src/cloud-detail.js', 'src/cloud-field.js', 'src/lightning.js', 'src/volume-light.js', 'src/celestial-tracks.js', 'src/sky-environment.js', 'src/environment-frame.js', 'src/weather-front.js', 'src/material-history.js', 'src/weather-binding.js', 'src/optical-materials.js', 'src/atmosphere-depth-bands.js', 'src/scene-optics.js', 'src/scene-exposure.js', 'src/splat-effects.js',
    'src/look-inputs.js', 'src/render-effects.js', 'src/tracked-window.js', 'src/render-graph.js', 'src/render-stages.js', 'src/render-contract.js', 'src/programmable-exposure.js', 'src/effect-palettes.js', 'src/silhouette-protection.js', 'src/pass-quality.js', 'src/detail-budgets.js', 'src/shadow-art.js', 'src/shot-lighting.js', 'src/reflection-probes.js', 'src/contact-shadows.js', 'src/bounce-probes.js', 'src/horizon-bands.js', 'src/surface-detail-kits.js', 'src/shadow-band-paint.js', 'src/surface-look.js', 'src/material-controls.js', 'src/splat-frames.js', 'src/splat-relighting.js', 'src/sdf-assist.js', 'src/sculpt-sampling.js', 'src/builder.js', 'src/sculpt.js'
  ]
    .map(f => path.join(__dirname, f))
    .concat(
      fs
        .readdirSync(KIT_DIR)
        .filter(f => f.endsWith('.js'))
        .sort()
        .map(f => path.join(KIT_DIR, f))
    );
const demoFiles = () => [path.join(__dirname, 'demos', 'labscenes.js')];
// the names the bundle defines at top level (add them to your own module.exports)
const EXPORTS =
  'Typography, Stippling, ScreenPrint, Engraving, SurfaceBrush, SplatFootprints, RenderGrid, Randomness, MathFields, MaterialControls, CameraLens, CameraImpulses, makeBuilder, makeSculpt, basis, flame, motes, pondMat, lilies, courses, PALETTES, PAL_HEX, KIT, FrameBudget, InkVeil, TexturedSurface, SpriteSurface, TargetSelectors, SplatProvenance, ColorSpace, PaintCorrections, ColorCurves, ColorLUT, ColorStack, PixelLook, PaletteFields, LookInputs, RenderStages, ContributionRules, SurfaceDetailKits, SurfaceLook, SceneOptics, ReflectionProbes, SceneExposure, SkyEnvironment, AtmospherePalette, EnvironmentFrame, CelestialTracks, CloudField, Lightning, VOX, SplatEffects, ArtPasses, ArtDirection, ArtInk, EffectPalettes, SilhouetteProtection, DetailBudgets, ContactShadows, BounceProbes, LightCookies, AreaLights, EmissiveFinishes, HorizonBands, ArtStability, ColorClusters, StableDetail, EdgeFilter, ArtEffects, VolumeField, VolumeLight';
const prebuiltNode = path.join(__dirname, 'dist', 'ink-studio.node.cjs');
const playbackSource = path.join(__dirname, 'src', 'scene-replay.js');
const playbackExports = 'mountSceneReplay, sampleReplayFrame, validateSceneReplay';

function bundle({ format = 'script', profile = 'development' } = {}) {
  if (!['script', 'module', 'commonjs'].includes(format)) throw Error('Ink bundle format must be script, module or commonjs');
  if (profile === 'playback') {
    const source = read(playbackSource);
    if (format === 'module') return source + '\nexport { ' + playbackExports + ' };\n';
    if (format === 'commonjs') return source + '\nmodule.exports = { ' + playbackExports + ' };\n';
    return 'const InkScenePlayer = (() => {\n' + source + '\nreturn { ' + playbackExports + ' };\n})();\n';
  }
  if (profile !== 'development' && profile !== 'bake') throw Error('Ink bundle profile must be development, bake or playback');
  const inputs = files();
  const sources = (profile === 'bake' ? inputs.filter(file => !['story-document.js', 'story-analysis.js'].includes(path.basename(file)) &&
    (path.dirname(file) !== KIT_DIR || bakeKit.has(path.basename(file)))) : inputs)
    .map(read).join('\n');
  if (format === 'module') return sources + '\nexport { ' + EXPORTS + ' };\n';
  if (format === 'commonjs' && profile === 'bake') return sources + '\nmodule.exports = { ' + EXPORTS + ' };\n';
  if (format === 'commonjs')
    return sources + '\nconst SCENES = [];\n' + demoFiles().map(read).join('\n') +
      '\nmodule.exports = { SCENES, ' + EXPORTS + ' };\n';
  return sources;
}

function nodeBundlePath() {
  if (process.env.INK_STUDIO_DEVELOPMENT !== '1' && fs.existsSync(prebuiltNode)) return prebuiltNode;
  const out = path.join(__dirname, 'dist', 'standalone.js');
  const newest = Math.max(...files().concat(demoFiles(), [__filename]).map(f => fs.statSync(f).mtimeMs));
  if ((fs.statSync(out, { throwIfNoEntry: false })?.mtimeMs ?? -1) < newest) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Parallel consumers may compile together. Publish only complete bundles.
    const temporary = out + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, bundle({ format: 'commonjs' }));
      fs.renameSync(temporary, out);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return out;
}

module.exports = {
  files,
  demoFiles,
  EXPORTS,
  version: require('./package.json').version,
  bundle,
  nodeToolkitHash: () => createHash('sha256').update(fs.readFileSync(nodeBundlePath())).digest('hex'),
  // the seven built-in demo dioramas. They push onto an array called SCENES, which must already exist
  demos: () => demoFiles().map(read).join('\n'),
  // refuse-to-build check: code written after a // comment on the same line never runs. Returns the offending lines
  lint: require('./scripts/lint.js'),
  // a mesh file from disk, by its ending: .obj (with the .mtl beside it), .gltf (with its .bin files), .glb
  createShowBridge: require('./cli/show-bridge.js').createShowBridge,
  readGaussianSplat: require('./cli/gaussian-splats.js').readGaussianSplat,
  async gaussianSplatWorld(cloud, options) {
    return (await import('./src/gaussian-splats.mjs')).gaussianSplatWorld(cloud, options);
  },
  readMesh(file, { attributes = false } = {}) {
    const K = module.exports.load().KIT,
      ext = path.extname(file).toLowerCase(),
      dir = path.dirname(file);
    if (ext === '.obj') {
      const text = fs.readFileSync(file, 'utf8'),
        m = /^mtllib\s+(.+)$/m.exec(text),
        mf = m && path.join(dir, m[1].trim());
      const mtl = mf && fs.existsSync(mf) ? fs.readFileSync(mf, 'utf8') : null;
      const mesh = K.mesh.obj(text, mtl, { attributes });
      if (attributes && mtl && mesh.uvs) {
        let name;
        const textures = new Map();
        for (const raw of mtl.split('\n')) {
          const entry = /^(newmtl|map_Kd)\s+(.+)$/.exec(raw.trim());
          if (!entry) continue;
          if (entry[1] === 'newmtl') name = entry[2];
          else if (name && !entry[2].startsWith('-')) {
            const image = path.resolve(path.dirname(mf), entry[2].replace(/^["']|["']$/g, ''));
            const mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[path.extname(image).toLowerCase()];
            if (mimeType && fs.existsSync(image)) textures.set(name, { bytes: fs.readFileSync(image), mimeType });
          }
        }
        mesh.mats = mesh.mats.map(m => ({ ...m, texture: textures.get(m.name) }));
      }
      return mesh;
    }
    if (ext === '.glb') return K.mesh.glb(fs.readFileSync(file));
    if (ext === '.gltf') {
      const g = JSON.parse(fs.readFileSync(file, 'utf8'));
      return K.mesh.gltf(
        g,
        (g.buffers || []).map(b =>
          b.uri && !b.uri.startsWith('data:') ? fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))) : null
        )
      );
    }
    throw new Error('do not know how to read ' + ext + ' (obj, gltf and glb are read)');
  },
  async readAsset(file, options = {}) {
    if (path.extname(file).toLowerCase() !== '.glb') throw Error('Portable asset import expects a GLB file');
    const decodeImage = options.decodeImage || ((bytes, mime) => {
      if (mime !== 'image/png') throw Error('Supply decodeImage to import embedded JPEG images');
      const image = require('./cli/png.js').raster(Buffer.from(bytes));
      return { width: image.w, height: image.h,
        pixels: image.max === 255 ? image.data : Uint8Array.from(image.data, v => Math.round(v * 255 / image.max)) };
    });
    return module.exports.load().KIT.authoring.assetMeshes.importGLB(
      new Uint8Array(fs.readFileSync(file)), { ...options, decodeImage });
  },
  readDataInputs(file) {
    const { KIT } = module.exports.load(), api = KIT.dataInputs;
    const input = JSON.parse(fs.readFileSync(file, 'utf8')), bundles = KIT.authoring.projectBundles;
    const { dataInputs } = input?.format === bundles.format ? bundles.open(input).scene() : input;
    if (dataInputs === undefined) throw new TypeError('Expected a dataInputs catalog in ' + file);
    return api.prepare(require('./cli/data-inputs.js').embed(api, dataInputs, file));
  },
  exportGlb: require('./cli/export-glb.js'),
  ...require('./cli/gltf-asset.js'),
  render: require('./cli/render.js').render,
  createMotionalCoverageHistory: require('./src/motional-coverage.js').history,
  createPartMotionHistory: require('./cli/part-motion.js').history,
  createGraphProject: require('./cli/graph-project.js').createGraphProject,
  createGraphWorkers: require('./cli/graph-workers.js').createGraphWorkers,
  readGraphProject: require('./cli/graph-project.js').readGraphProject,
  validateStoryDocument: require('./cli/story-document.js').validateStoryDocument,
  preflightStoryDocument: require('./cli/story-document.js').preflightStoryDocument,
  readStoryDocument: require('./cli/story-document.js').readStoryDocument,
  instantiateStoryTemplate(template, instance) {
    return module.exports.load().KIT.world.storyTemplates.instantiate(template, instance);
  },
  findGraphGroupUsers: require('./cli/graph-groups.js').findGraphGroupUsers,
  diffGraphs: require('./cli/graph-diff.js').diffGraphs,
  listGraphNodes: require('./cli/graph-catalog.js').listGraphNodes,
  describeGraphNode: require('./cli/graph-catalog.js').describeGraphNode,
  createTake: require('./cli/take.js').createTake,
  readTake: require('./cli/take.js').readTake,
  runReferenceExperiments: ({ kit = module.exports.load(), ...options } = {}) =>
    require('./cli/reference-experiments.js').run(kit, options),
  renderAudiovisualTake: require('./cli/audiovisual-take.js').render,
  readAudiovisualTake: require('./cli/audiovisual-take.js').open,
  ...require('./cli/graph-host.js'),
  readWav: require('./cli/wav.js').read,
  decodeWav: require('./cli/wav.js').decode,
  encodeWav: require('./cli/wav.js').encode,
  ...require('./cli/graph-render.js'),
  paletteUsage: require('./cli/palette-usage.js').paletteUsage,
  reviewRampShot: require('./cli/ramp-review.js').reviewRampShot,
  comparePaletteDistributions: require('./cli/palette-distributions.js').comparePaletteDistributions,
  measureQuantizationError: require('./cli/palette-error.js').measureQuantizationError,
  reviewQuantizationError: require('./cli/palette-error.js').reviewQuantizationError,
  inspectPalettePixel: require('./cli/palette-pixel.js').inspectPalettePixel,
  reviewPaletteShimmer: require('./cli/palette-shimmer.js').reviewPaletteShimmer,
  reviewSubjectReadability: require('./cli/readability-review.js').reviewSubjectReadability,
  reviewShadowReadability: require('./cli/shadow-readability.js').reviewShadowReadability,
  reviewPaletteWeather: require('./cli/palette-weather.js').reviewPaletteWeather,
  reviewPaletteStages: require('./cli/palette-stages.js').reviewPaletteStages,
  compareShotPalettes: require('./cli/palette-compare.js').compareShotPalettes,
  checkPaletteShot: require('./cli/palette-checks.js').checkPaletteShot,
  approveShot: require('./cli/shot-approval.js').approveShot,
  exportLayers: require('./cli/export-layers.js').exportLayers,
  objectMatte: require('./cli/object-mattes.js').objectMatte,
  captureLightGroups: require('./cli/light-groups.js').captureLightGroups,
  exportScene: require('./cli/scene-export.js').exportScene,
  ...require('./cli/scene-audio.js'),
  openGestureBank: require('./cli/gesture-bank.js').openGestureBank,
  openSampleLibrary: require('./cli/sample-library.js').openSampleLibrary,
  readSceneReplay: require('./cli/scene-replay.js').readSceneReplay,
  sampleSceneReplay: require('./cli/scene-replay.js').sampleSceneReplay,
  writeSceneEmbed: require('./cli/scene-replay.js').writeSceneEmbed,
  packProject: require('./cli/project-bundle.js').packProject,
  readProjectBundle: require('./cli/project-bundle.js').readProjectBundle,
  writeProjectBundle: require('./cli/project-bundle.js').writeProjectBundle,
  unpackProject: require('./cli/project-bundle.js').unpackProject,
  verifyProjectExperiment: (...args) => require('./cli/project-experiment.js').verify(...args),
  describeRenderFrame: (world, frame) => require('./src/render-contract.js').describe(world, frame),
  capturePixelScan: require('./cli/pixel-scan.js').capturePixelScan,
  createCameraAtlas(options) {
    return module.exports.load().KIT.cameraAtlas.raster(options, (world, frame) => {
      const { width: w, height: h, time: t, camera, cameraSnapshot, ...settings } = frame;
      if (cameraSnapshot !== undefined || camera?.pose !== undefined)
        throw new TypeError('Headless camera atlas views use orbit camera settings');
      const ortho = camera?.ortho ?? (camera?.projection === undefined ? settings.ortho :
        camera.projection === 'orthographic');
      return module.exports.render(world, { ...settings, ...camera, ortho, w, h, t, px: 1 });
    });
  },
  bakeBounceProbes: (world, settings) => module.exports.load().KIT.bounceProbes.bake(world, settings),
  inspectEnvironment: require('./cli/environment-inspector.js').inspectEnvironment,
  silhouetteReview: require('./cli/silhouette-review.js').silhouetteReview,
  transitionReview: require('./cli/transition-review.js').transitionReview,
  spriteAtlas: require('./cli/sprite-atlas.js').spriteAtlas,
  readSpriteAtlas: require('./cli/sprite-atlas.js').readSpriteAtlas,
  writeSpriteAtlas: require('./cli/sprite-atlas.js').writeSpriteAtlas,
  readHorizonBands: require('./cli/horizon-bands.js').readHorizonBands,
  readEnvironmentImage: require('./cli/horizon-bands.js').readEnvironmentImage,
  previewTimeline: require('./cli/animation-timeline.js').previewTimeline,
  readRasterAsset(file) {
    return require('./cli/raster-asset.js').readRasterAsset(file, module.exports.load().KIT.procedural.graph.raster);
  },
  readReferencePalette(file, options) {
    return require('./src/palette-extract.js').extract(require('./cli/png.js').paletteSource(file), options);
  },
  writeRasterAsset: require('./cli/raster-asset.js').writeRasterAsset,
  createSceneEditor(source, options) {
    return module.exports.load().KIT.authoring.sceneEditor.create(source, options);
  },
  createSplatPicker(world, options = {}) {
    const K = module.exports.load().KIT;
    const time = options.time ?? world.lookSnapshot?.time ?? 0;
    const posed = K.reconstruction.frame(world, time, options.reconstruction ?? world.look?.reconstruction);
    return K.procedural.contributions.create(posed, options);
  },
  createSimulationWorkers: require('./src/simulation-worker-pool.js'),
  openCheckpointStore: require('./src/simulation-checkpoint-store.js').openCheckpointStore,
  nodeBundlePath,
  toolkitBuildHash(kit) {
    const file = nodeBundlePath();
    if (require.cache[file]?.exports === kit) return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  },
  load() { return require(nodeBundlePath()); }
};
