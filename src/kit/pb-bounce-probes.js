/* Bake diffuse transport and re-trace the local probes that have live sources. */
(function (K) {
  const probes = BounceProbes;
  const linear = ColorSpace.prepare('srgb', 'srgb-linear');
  const nonDiffuse = 16 | 32 | 64 | 128 | 256 | 512 | 2048 | 32768;
  const packedRGB = value => [value & 255, value >> 8 & 255, value >> 16 & 255].map(n => n / 255);

  function sources(world, settings, data, posed = false) {
    const { count, moving, back, anim } = world;
    const background = new Set(back ?? []), movement = new Set([...(moving ?? []), ...(anim?.boned ?? [])]);
    const casts = ShadowArt.bind(settings, world, 'cast');
    const selectors = settings.dynamic && (settings.dynamic.reflect.length || settings.dynamic.emit.length) ?
      TargetSelectors.index(world) : null;
    const groups = settings.dynamic ? [...settings.dynamic.reflect.map(select => ({ select })),
      ...settings.dynamic.emit].map(row => ({ ...row, indices: [] })) : [];
    const opaque = new Uint8Array(count), eligible = new Uint8Array(count), emission = new Float32Array(count);
    const coverage = ContributionRules.coverageMode(world.look?.splatCoverage);
    const matches = new Map();
    for (let i = 0; i < count; i++) {
      const q = i * 16, flags = Math.round(data[q + 11]);
      if (background.has(i) || data[q + 3] <= 0) continue;
      let selection = [];
      if (selectors) {
        const row = selectors.row(i);
        if (!matches.has(row)) matches.set(row, groups.filter(group => TargetSelectors.matches(group.select, row)));
        selection = matches.get(row);
      }
      const mover = selection.some(group => group.gain === undefined);
      const diffuse = data[q + 3] >= 1 && !(flags & nonDiffuse) &&
        !world.opticalSplats?.[i * OpticalMaterials.STRIDE + 3] &&
        ContributionRules.materialCoverage(world.materialPixelStyles?.[i * 4] ?? 0, coverage) !== ContributionRules.softCoverage &&
        (!casts || casts(i));
      const fixed = !(flags & 15) && !movement.has(i) && !anim?.rig?.bid?.[i];
      if (diffuse && (posed ? mover || fixed : !mover && fixed)) {
        eligible[i] = opaque[i] = 1;
        if (posed && mover) for (const group of selection) if (group.gain === undefined) group.indices.push(i);
      }
      if (posed && flags & 32 && !(flags & (64 | 128 | 256 | 2048))) {
        for (const group of selection) if (group.gain > 0) {
          emission[i] = Math.max(emission[i], group.gain);
          eligible[i] = 1;
          group.indices.push(i);
        }
      }
    }
    return { groups, eligible, opaque, emission };
  }

  function trace(settings, sites, picker, color, extraHits) {
    const { samples, reach } = settings, directions = probes.directions(samples), weight = 4 * Math.PI / samples;
    const light=settings.geometry?.light, toward=light && K.V.norm(light.direction);
    const tint=light && linear([1,3,5].map(i=>parseInt(light.color.slice(i,i+2),16)/255));
    const bias=4*(settings.geometry?.epsilon??.003);
    const rayOptions={maxDistance:reach,water:false,meshes:false,brickMeshes:false,...(extraHits&&{cutaway:false,extraHits})};
    return sites.map(site => {
      const coefficients = new Array(27).fill(0), open = [];
      for (const { direction, basis } of directions) {
        const ray = picker.ray({ ...rayOptions, origin:site.at, direction });
        const incoming = [0, 0, 0];
        for (const hit of ray.contributions) {
          let rgb = hit.bounceRGB ?? color(hit);
          if(light && hit.bounceRGB && rgb.some(Boolean)){
            const normal=hit.normal, facing=normal ? Math.max(0,K.V.dot(toward,normal)) : 0;
            const visibility=facing&&light.intensity ? picker.ray({
              ...rayOptions,origin:K.V.mad(hit.point,normal,bias),direction:toward,limit:1
            }).transmission : 0;
            rgb=rgb.map((value,c)=>value*(light.ambient+tint[c]*light.intensity*facing*visibility));
          }
          const transfer = hit.weight * (1 - hit.distance / reach) ** 2;
          for (let c = 0; c < 3; c++) incoming[c] += transfer * rgb[c];
        }
        open.push(ray.transmission);
        probes.project(coefficients, basis, incoming, weight);
      }
      return { ...site, coefficients, open };
    });
  }

  function radiance(data) {
    const colors = new Map();
    return index => {
      const packed = data[index * 16 + 7];
      if (!colors.has(packed)) colors.set(packed, linear(packedRGB(packed)));
      return colors.get(packed);
    };
  }

  function bake(world, value = world.bounceProbes) {
    const settings = probes.prepare(value);
    if (!settings || settings.format) return settings ?? false;
    if (!settings.probes.length) return { ...settings, format: probes.format, version: 1 };
    const data = world.rest ?? world.data;
    const selection = sources(world, settings, data), color = radiance(data);
    const extraHits = K.bounceProxyGeometry(world, settings, data, selection, color);
    const picker = K.procedural.contributions.create({
      ...world, anim: undefined, lookSnapshot: undefined, data
    }, { time: 0, splatCoverage: 'continuous', rowMask: selection.eligible });
    const baked = trace(settings, settings.probes, picker, hit => color(hit.index), extraHits);
    return { ...settings, format: probes.format, version: 1, probes: baked };
  }

  function distanceToBounds(point, { min, max }) {
    return Math.hypot(...point.map((n, i) => Math.max(min[i] - n, n - max[i], 0)));
  }

  function update(world, settings, { time = world.lookSnapshot?.time ?? 0, emissiveTime = time, lights = [], spill = [], lighting } = {}) {
    const { dynamic, reach, probes: sites } = settings;
    const noWork = { probes: sites, updated: [], rays: 0 };
    if (!dynamic || !sites.length) return noWork;
    const live = lights.filter(light => light.intensity > 0 && dynamic.lights.includes(light.id));
    const spillSources=new Set(spill), emission=lighting?.curves.emission;
    const shapedSpill=emission ? live.filter(light=>spillSources.has(light)) : [];
    const direct=shapedSpill.length ? live.filter(light=>!spillSources.has(light)) : live;
    const litSites = new Set(sites.filter(site => live.some(light =>
      Math.hypot(...light.at.map((n, i) => n - site.at[i])) < reach + light.radius + Math.hypot(...light.half))));
    if (!litSites.size && !dynamic.reflect.length && !dynamic.emit.length) return noWork;
    const posed = sources(world, settings, world.data, true);
    if (!litSites.size && !posed.groups.some(group => group.indices.length)) return noWork;
    const bakedColor = radiance(world.data);
    const extraHits = K.bounceProxyGeometry(world, settings, world.rest ?? world.data, posed, bakedColor);
    const picker = K.procedural.contributions.create(world, {
      time, emissiveTime, splatCoverage: 'continuous', rowMask: posed.eligible
    });
    const bounds = posed.groups.map(group => picker.boundsOf(group.indices)).filter(Boolean);
    const near = sites.filter(site => litSites.has(site) || bounds.some(bounds => distanceToBounds(site.at, bounds) < reach));
    if (!near.length) return noWork;

    const frames = live.length && SplatFrames.create(world, time, K.M), normals = [];
    const casters = live.some(light => light.shadows) ? AreaLights.staticSources(world) : [];
    const shadow = casters.length ? (origin, direction, stop) => AreaLights.occludes(casters, origin, direction, stop) : undefined;
    const lit = [0, 0, 0], albedos = new Map();
    function color({ index, point }) {
      const base = bakedColor(index), gain = posed.emission[index];
      if (gain) {
        const color=base.map(n=>n*gain);
        return emission?emission(color):color;
      }
      const normal = frames && (normals[index] ?? (normals[index] = frames(index).normal || false));
      if (!normal || !posed.opaque[index]) return base;
      const shaped=lighting?.normal?.(index,normal) ?? normal;
      const contribution=lighting?.spill && ((light,at)=>spillSources.has(light)?lighting.spill(light,index,at):1);
      AreaLights.evaluate(direct,point,shaped,lit,{shadow,biasNormal:normal,contribution});
      if(shapedSpill.length){
        const emitted=[0,0,0];
        AreaLights.evaluate(shapedSpill,point,shaped,emitted,{shadow,biasNormal:normal,contribution});
        const graded=emission(emitted);
        for(let c=0;c<3;c++)lit[c]+=graded[c];
      }
      if (!lit.some(Boolean)) return base;
      const packed = world.materialAlbedo?.[index];
      if (packed && !albedos.has(packed)) {
        const rgb = packed - 1;
        albedos.set(packed, linear([rgb >> 16, rgb >> 8 & 255, rgb & 255].map(n => n / 255)));
      }
      const albedo = albedos.get(packed) ?? base;
      return base.map((n, k) => n + lit[k] * albedo[k]);
    }
    const updated = trace(settings, near, picker, color, extraHits), byId = new Map(updated.map(site => [site.id, site]));
    return { probes: sites.map(site => byId.get(site.id) ?? site), updated: updated.map(site => site.id),
      rays: updated.length * settings.samples };
  }

  K.bounceProbes = Object.freeze({ bake, update });
})(KIT);
