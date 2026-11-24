/* Cross-backend inputs for a sampled render. Backends keep their own raster passes. */
const RenderContract = (() => {
  const art = typeof ArtDirection === 'undefined' ? require('./art-direction.js') : ArtDirection;
  const lenses = typeof CameraLens === 'undefined' ? require('./camera-lens.js') : CameraLens;
  const impulses = typeof CameraImpulses === 'undefined' ? require('./camera-impulses.js') : CameraImpulses;
  const staging = typeof CameraStaging === 'undefined' ? require('./camera-staging.js') : CameraStaging;
  const footprints = typeof SplatFootprints === 'undefined' ? require('./splat-footprints.js') : SplatFootprints;
  const grids = typeof RenderGrid === 'undefined' ? require('./render-grid.js') : RenderGrid;
  const pixels = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const stages = typeof RenderStages === 'undefined' ? require('./render-stages.js') : RenderStages;
  const inputs = typeof LookInputs === 'undefined' ? require('./look-inputs.js') : LookInputs;

  const scenePaletteLimit = 64, analyticFogLimit = 16;
  const analyticFogKinds = ['fog', 'box', 'sphere', 'shaft'];
  const stageDifferences = {
    'deep-compositing': ['Headless can capture deep fragments.', 'WebGL does not emit deep fragments.', 'Deliver the deep pass headlessly.'],
    'programmable-exposure': ['Headless can sample programmable shutters.', 'WebGL has no matching exposure pass.', 'Use a headless review for the shuttered image.'],
    'motional-coverage': ['Headless resolves motion-aware coverage.', 'WebGL has no matching coverage resolve.', 'Disable motional coverage for a shared preview.'],
    'live-pixel-boundaries': ['The shot solver uses a seekable frame sequence.', 'Live named features use the preceding frame.', 'Use the shot solver for an offline approval or disable the live pass for a shared preview.'],
    'post-stage': ['Headless applies frame and palette stage rules.', 'WebGL cannot apply those rules through shared staged color.', 'Use uniform material or lit stages for a shared look.'],
    'spatial-stage-mask': ['Headless evaluates spatial stage masks.', 'WebGL cannot apply the masked rules through shared staged color.', 'Use a uniform stage rule for a shared look.'],
    'textured-splat-color': ['Headless applies staged rules to per-pixel splat colors.', 'WebGL stages operate on baked splat RGB.', 'Review per-pixel stage color headlessly.'],
    'surface-finish': ['Headless composes staged rules with surface finishes.', 'WebGL has no shared staged path for this surface combination.', 'Review the combined finish headlessly.'],
    'contribution-color': ['Headless stages account for per-fragment color contributions.', 'WebGL has no shared staged path for these contributions.', 'Review staged translucent and coverage color headlessly.'],
    'live-lighting': ['Headless combines staged color and live lighting.', 'WebGL has no shared staged path for this lighting combination.', 'Review the lit stages headlessly or use baked lighting.']
  };

  function options(world, frame = {}, bindClocks) {
    let out = { ...frame, time: frame.time ?? frame.t };
    const clocks = out.timeDomains ?? world.timeDomains;
    if (clocks || out.take !== undefined) {
      if (bindClocks) out = bindClocks(world, out);
      else if (typeof clocks?.frame === 'function') out = clocks.frame(out);
      else throw new TypeError('Expected a live render clock set');
    }
    const time = out.time ?? world.lookSnapshot?.time;
    if (![time ?? 0, out.cameraTime ?? 0, out.skyTime ?? 0, out.interfaceTime ?? 0].every(Number.isFinite))
      throw new RangeError('Render frame sample times must be finite');
    return { ...out, time, t: time };
  }

  function clock(world, frame) {
    const look = world.look ?? {};
    const time = frame.time ?? frame.t ?? world.lookSnapshot?.time ?? 0, skyTime = frame.skyTime ?? time;
    const direction = art.prepare(look.artDirection, frame.artDirection);
    const stepped = frame.stepAnimation === true && look.pixel && !direction?.sceneCadence;
    const scene = stepped ? Math.floor(time * 10 + 1e-8) / 10 : art.time(direction, time);
    return { time, skyTime, direction, cameraTime: frame.cameraTime ?? time, interfaceTime: frame.interfaceTime ?? time,
      simulationTime: frame.simulationTime ?? null, ...art.motion(direction, time, skyTime, scene) };
  }

  const palette = pixels.framePalette;

  function stagePlan(world, frame, time, { query, lookInputs, ...settings } = {}) {
    if (frame.raw || frame.renderStages === false) return null;
    return stages.plan(world, { ...settings, sceneRules: frame.renderStages,
      lookInputs: frame.lookInputSession ?? lookInputs ?? inputs.session(time, () =>
        world.lookSnapshot?.query ?? world.surfaceEffects?.query ?? query?.()) });
  }

  function stageRules(world, frame) {
    if (frame.raw || frame.renderStages === false) return [];
    return [...((frame.renderStages ?? world.look?.renderStages) || []),
      ...(world.surfaces?.flatMap(({ settings }) => settings.renderStages || []) ?? [])];
  }
  function hasSurfacePaint(world, frame) {
    return !frame.raw && frame.renderStages !== false && world.surfaces?.some(({ settings }) =>
      Object.values(settings.layers ?? {}).some(layer => layer?.stage === 'material'));
  }
  function compatibility(world, frame = {}) {
    const look = world.look ?? {};
    const rules = stageRules(world, frame);
    const issues = [];
    if (frame.deepComposite ?? look.deepComposite) issues.push('deep-compositing');
    if (frame.shutter ?? look.shutter) issues.push('programmable-exposure');
    if (frame.motionalCoverage ?? look.motionalCoverage) issues.push('motional-coverage');
    if (!frame.raw && world.pal?.length > scenePaletteLimit) issues.push('palette-limit');
    if (!rules.length && !hasSurfacePaint(world, frame)) return issues;
    if (rules.some(rule => rule.stage === 'frame' || rule.stage === 'palette')) issues.push('post-stage');
    if (rules.some(rule => rule.mask || rule.driver?.inputs?.mask)) issues.push('spatial-stage-mask');
    if (world.pix || world.fine || world.materialPixelStyles) issues.push('textured-splat-color');
    if (world.spriteAtlases?.length || world.spriteSurfaces || frame.surfaceDecals!==false && world.surfaceDecals || frame.meshes !== false && world.meshes?.length ||
        (frame.meshes!==false && frame.reliefLOD!==false && world.reliefLOD?.length) ||
        (frame.scalePreviews !== false && world.scalePreviews?.length) || world.surfaces?.some(({ settings }) => Object.keys(settings.layers ?? {}).length))
      issues.push('surface-finish');
    if (world.opticalSplats || frame.water !== false && world.water?.count ||
        frame.paintCorrections !== false && world.paintCorrections || (frame.coverageAware ?? look.coverageAware) ||
        (frame.paletteConstraints ?? look.paletteConstraints) || look.optics?.length)
      issues.push('contribution-color');
    if ((frame.relighting ?? world.relighting) || (frame.liveSun ?? world.liveSun) || world.areaLights?.length ||
        world.bounceProbes || world.anim?.lamps?.length || world.emissiveFinishes?.length)
      issues.push('live-lighting');
    return issues;
  }

  function resolved(worldSetting, frameSetting) {
    return frameSetting === true ? worldSetting : frameSetting ?? worldSetting;
  }

  function atmosphereIssues(world, frame, sample, issues) {
    if (frame.atmosphere === false || frame.environment === false) return;
    const volumeSources = world.atmosphere ?? [];
    const shaped = resolved(world.shapedAtmosphere, frame.shapedAtmosphere);
    const active = [...volumeSources, ...(shaped || []).map(volume => ({ ...volume, type: 'field' }))]
      .filter(volume => (volume.density ?? .2) > 0);
    const analytic = active.filter(volume => analyticFogKinds.includes(volume.type));
    const fields = active.filter(volume => volume.type === 'field');
    const describeVolumes = rows => ({ count: rows.length, volumes: rows.flatMap(volume => volume.id === undefined ? [] : [volume.id]) });
    const add = (code, kind, headless, webgl, action, detail) =>
      issues.push({ code, kind, headless, webgl, action, ...(detail && { detail }) });

    if (fields.length) add('density-field', 'omitted', 'Marches shaped density fields.',
      'The analytic fog pass omits these density fields.', 'Use an analytic fog volume for playback or review the density fields in the headless export.',
      describeVolumes(fields));

    const depthBands = resolved(world.atmosphereDepthBands, frame.atmosphereDepthBands);
    if (depthBands?.length || analytic.some(volume => volume.depthBand)) add('atmosphere-depth-bands', 'different',
      'Samples depth bands along the viewing ray.', 'The analytic fog pass has no depth-band sampling.',
      'Use constant-density volumes for a shared fog look.');

    const fronts = frame.weatherBinding !== false && frame.weatherFronts !== false &&
      (frame.weatherBinding?.fronts ?? world.weatherBinding?.fronts)?.length;
    if (analytic.length > analyticFogLimit || analytic.length && fronts) {
      const environment = typeof EnvironmentFrame === 'undefined' ? require('./environment-frame.js') : EnvironmentFrame;
      const tracks = world.weatherTracks && (typeof KIT === 'undefined' ? require('../index.js').load().KIT : KIT).weather.tracks;
      const sky = environment.timeline(world, frame, sample.time, sample.direction, tracks);
      if (analytic.length > analyticFogLimit) {
        const optics = typeof SceneOptics === 'undefined' ? require('./scene-optics.js') : SceneOptics;
        const uniform = environment.opticalWeather(world, frame, sky);
        const count = optics.prepareVolumes(analytic, world.pal, undefined, uniform?.fogGain, sky.skyTime).length;
        if (count > analyticFogLimit) add('analytic-fog-limit', 'limit', 'Renders the authored analytic volumes.',
          'WebGL rejects frames above its active analytic fog limit.', 'Reduce the number of active analytic fog volumes.',
          { count, limit: analyticFogLimit });
      }
      if (fronts) {
        const regional = environment.opticalWeather(world, frame, sky, true);
        const affected = analytic.filter(volume => typeof regional?.fogGain(volume)?.sample === 'function');
        if (affected.length) add('regional-fog', 'different', 'Applies local weather-front density across the volume.',
          'WebGL uses the uniform weather sample for analytic fog.', 'Use uniform weather density for a shared fog look.', describeVolumes(affected));
      }
    }

    if ((active.length || depthBands?.length) && resolved(world.volumeCutouts, frame.volumeCutouts)) {
      const cutouts = typeof VolumeCutouts === 'undefined' ? require('./volume-cutouts.js') : VolumeCutouts;
      if (cutouts.settings(world.volumeCutouts, frame.volumeCutouts).frame(art.time(sample.direction, sample.time)).fog)
        add('volume-cutouts', 'omitted', 'Applies authored volume cutouts to fog.',
          'The analytic fog pass omits authored volume cutouts.', 'Review cutout openings in the headless export.');
    }
    if (active.length && frame.water !== false && world.water?.count && world.water.raySegments)
      add('coupled-water-air', 'different', 'Integrates water and fog along the same ray.',
        'WebGL uses separate water and analytic fog passes.', 'Review the waterline in both renderers.');
    const lit = analytic.filter(volume => volume.lit);
    if (lit.length) add('lit-fog', 'different', 'Samples light and shadow along the fog ray.',
      'WebGL samples analytic fog lighting from an emitter grid.', 'Compare the shot on its playback device before approving the lighting.',
      describeVolumes(lit));
  }

  function review(world, frame = {}, sample = clock(world, frame)) {
    const codes = compatibility(world, frame);
    if (frame.livePixelBoundaries ?? world.look?.livePixelBoundaries) codes.push('live-pixel-boundaries');
    const issues = codes.map(code => {
      if (code === 'palette-limit') return { code, kind: 'limit', headless: 'Resolves the full scene palette.',
        webgl: 'Scene palette resolve uses only the first ' + scenePaletteLimit + ' swatches.',
        action: 'Use at most ' + scenePaletteLimit + ' scene swatches for a shared palette resolve.',
        detail: { count: world.pal.length, limit: scenePaletteLimit } };
      const [headless, webgl, action] = stageDifferences[code];
      return { code, kind: 'different', headless, webgl, action };
    });
    atmosphereIssues(world, frame, sample, issues);
    return { version: 1, time: sample.time, status: issues.length ? 'differences' : 'no-known-differences', issues };
  }

  function requirePortable(world, frame) {
    const issues = compatibility(world, frame);
    if (frame.livePixelBoundaries ?? world.look?.livePixelBoundaries) issues.push('live-pixel-boundaries');
    if (issues.length) throw new Error('Frame is outside the shared rendering contract: ' + issues.join(', '));
  }

  function materialData(plan, world, source) {
    let data;
    for (let i = 0; i < world.count; i++) {
      const { material, lit } = plan.at(i);
      if (!material && !lit) continue;
      const q = i * 16 + 7, color = Math.round(source[q]);
      const baked = [color & 255, color >> 8 & 255, color >> 16 & 255].map(n => n / 255);
      const reference = world.materialAlbedo?.[i];
      const painted = material ? stages.material(material, baked, reference ? reference - 1 : undefined) : baked;
      const shaded = lit ? stages.apply(lit, painted) : painted;
      const [r, g, b] = shaded.map(n => Math.max(0, Math.min(255, Math.round(n * 255))));
      const packed = r + 256 * g + 65536 * b;
      if (packed === color) continue;
      data ??= source.slice(0, world.count * 16);
      data[q] = packed;
    }
    return data ?? source;
  }

  function describe(world, frame = {}, bindClocks) {
    frame = options(world, frame, bindClocks);
    const sample = clock(world, frame);
    const { direction, ...clocks } = sample;
    const width = frame.width ?? frame.w ?? 900, height = frame.height ?? frame.h ?? 620;
    const camera = lenses.frame(world, frame, width, height,
      { orbit: staging.prepare(frame.cameraStaging ?? world.look?.cameraStaging)?.orbit, impulse: impulses.frame });
    const { time, ortho, tangent, clipNear, clipFar, setback } = camera;
    const view = lenses.artView(camera, Math.ceil(height / (frame.px ?? 1)), world.look?.stable, frame.stable);
    const pose = view === camera.view ? camera.pose : lenses.fromView(view);
    const { grade, toneDefinition } = palette(world, frame, { grading: !frame.raw, tone: !frame.raw });
    const stageNames = new Set(stageRules(world, frame).map(rule => rule.stage));
    if (hasSurfacePaint(world, frame)) stageNames.add('material');
    const paletteMode = frame.raw ? 'raw' : stageNames.size ? 'stages' : toneDefinition ? 'tone' : 'palette';
    const markPlan=(frame.splatFootprints??world.look?.splatFootprints)!==false&&footprints.plan(world);
    const grid = grids.prepare(frame.renderGrid ?? world.look?.renderGrid);
    return { version: 1, width, height, clocks,
      ...(markPlan&&{footprints:{styles:markPlan.styles.map(p=>p.shape),atlas:[markPlan.width,markPlan.height],atlasBytes:markPlan.atlas.byteLength,rowBytes:markPlan.indices.byteLength,textureReadsPerShapedFragment:4}}),
      ...(grid && { representation: { type: 'grid', mode: grid.mode, size: grid.size, angle: grid.angle,
        origin: grid.origin, aspect: grid.aspect, gap: grid.gap, resources: grids.dimensions(grid, width, height) } }), camera: { pose, time, ortho, tangent, clipNear, clipFar, setback },
      paletteMode, palette: !frame.raw && grade ? pixels.gradePalette(grade) : world.pal?.slice(),
      stages: [...stageNames], issues: compatibility(world, frame), compatibility: review(world, frame, sample) };
  }
  return Object.freeze({ options, clock, palette, stagePlan, compatibility, review, requirePortable, materialData, describe,
    hasStages: (world, frame) => stageRules(world, frame).length > 0 || hasSurfacePaint(world, frame) });
})();
if (typeof module !== 'undefined') module.exports = RenderContract;
