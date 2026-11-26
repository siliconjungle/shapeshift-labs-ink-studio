/* Camera-facing presentation frames for linked prefab placements. */
(function (K) {
  const A = K.authoring, { M, V } = K;
  const up = [0, 1, 0], forward = [0, 0, 1];
  const horizontal = v => [v[0], 0, v[2]];
  const usable = v => V.len(v) > 1e-8;
  const reject = (v, axis) => V.mad(v, axis, -V.dot(v, axis));

  function read(value) {
    const { mode = 'upright', facing = 'direction', snapDegrees } = value ?? {};
    if (!K.world.data.record(value) || Object.keys(value).some(key => !['mode','facing','snapDegrees'].includes(key)) ||
        !['full','upright'].includes(mode) || !['direction','position'].includes(facing) ||
        snapDegrees !== undefined && (!Number.isFinite(snapDegrees) || snapDegrees < .001 || snapDegrees > 180))
      throw new TypeError('Use full or upright billboarding, direction or position facing, and an optional angle from 0.001 to 180 degrees');
    return { mode, facing, ...(snapDegrees !== undefined && { snapDegrees }) };
  }

  function orient(frame, instance, rule, camera) {
    const origin = A.scenePrefabs.placedOrigin(instance, frame);
    const sight = rule.facing === 'position' ? V.sub(camera.eye, origin) : camera.back;
    const aim = usable(sight) ? V.norm(sight) : camera.back;
    const guides = [horizontal(aim), horizontal(frame.direction(forward)), V.cross(camera.right, up), forward];
    const level = guides.find(usable);
    let back = aim, right;
    if (rule.mode === 'upright' || rule.snapDegrees !== undefined) {
      let yaw = Math.atan2(level[0], level[2]), pitch = rule.mode === 'upright' ? 0 : Math.asin(Math.max(-1, Math.min(1, aim[1])));
      if (rule.snapDegrees !== undefined) {
        const radians = Math.PI / 180, step = rule.snapDegrees;
        const snap = (angle, limit) => {
          const steps = Math.floor(limit / step), index = Math.round(angle / radians / step);
          return Math.max(-steps, Math.min(steps, index)) * step * radians;
        };
        yaw = snap(yaw, 180);
        pitch = snap(pitch, 90);
      }
      const c = Math.cos(pitch);
      back = [Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
      right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    }
    if (rule.mode === 'full' && rule.snapDegrees === undefined) {
      const cameraRight = V.cross(camera.up, back);
      if (usable(cameraRight)) right = V.norm(cameraRight);
      else right = V.norm(reject(camera.right, back));
    }
    const vertical = V.cross(back, right);
    if (M.det(frame.basis) < 0) right = V.mul(right, -1);
    const basis = M.tr([...right, ...vertical, ...back]);
    const offset = V.mul(M.app(basis, instance.origin ?? [0, 0, 0]), frame.scale);
    return K.diorama.solidFrames.affine(basis, frame.scale, V.sub(origin, offset));
  }

  function plan(scene, env, request) {
    const { equal, record } = K.world.data;
    if (!record(request) || Object.keys(request).some(key => !['instances','selection','billboard'].includes(key)))
      throw new TypeError('Choose prefab instances and a billboard rule, or use null to clear it');
    const rule = request.billboard === null ? undefined : read(request.billboard);
    const selected = A.sceneInstances.prefabSelection(scene, request);
    const { instances: links } = A.scenePrefabs.expand(scene, env), instances = { ...scene.instances };
    const report = { format:'ink-studio/prefab-billboard', version:1, scene:scene.id,
      instances:[], conflicts:[], changed:false, canCommit:false };
    const targets = new Set(selected.map(row => row.instance));
    for (const [id, link] of links) {
      const current = instances[id];
      if (targets.has(id)) {
        const before = current.billboard ?? null, after = rule ?? null;
        report.instances.push({ instance:id, origin:link.origin, before, after,
          objects:[...link.solids,...[...link.meshes.values()].map(row => row.object)] });
        if (current.mirror) {
          report.conflicts.push({ instance:id, reason:'edit-live-mirror-source', source:current.mirror.source });
          continue;
        }
        if (equal(before, after)) continue;
        instances[id] = { ...current };
        if (rule) instances[id].billboard = rule;
        else delete instances[id].billboard;
        report.changed = true;
      } else {
        let ancestor = current.mirror?.source ?? current.parent;
        while (ancestor !== undefined && !targets.has(ancestor))
          ancestor = instances[ancestor].mirror?.source ?? instances[ancestor].parent;
        if (ancestor !== undefined) report.instances.push({ instance:id, inheritedFrom:ancestor,
          objects:[...link.solids,...[...link.meshes.values()].map(row => row.object)] });
      }
    }
    report.canCommit = !report.conflicts.length;
    return { report: K.procedural.data.freeze(report), patch: report.canCommit ? { instances } : undefined };
  }

  const presentation = Symbol('prefab presentation frames');
  const bakeFlags = ['INK_FINE', 'INK_PIXEL', 'INK_BOUNCE', 'INK_FOCUS', 'INK_FOLLOW', 'INK_ADAPTIVE_SAMPLING',
    'INK_LOOK_ALBEDO', 'INK_RETAIN_RENDER_SDF', 'INK_RETAIN_REFERENCE_SDF', 'INK_DECAL_NEXT'];
  function prepare(source, env, inputs) {
    if (env.billboardFrames) return world => { world[presentation] = env.billboardFrames; };
    if (!Object.values(source.instances ?? {}).some(row => row.billboard !== undefined)) return;
    const rest = A.scenePrefabs.placements(source.instances);
    const flags = Object.fromEntries(bakeFlags.map(key => [key, globalThis[key]]));
    const identity = K.sceneGraph.transform();
    const numbers = frames => [...frames.values()].map(frame => frame?.mesh ?? identity);
    const base = numbers(rest), { equal } = K.world.data;
    let previous, baked;
    const sampler = Object.freeze({
      sample(camera) {
        const frames = A.scenePrefabs.placements(source.instances, { camera }), key = numbers(frames);
        if (equal(key, base)) return null;
        if (baked && equal(key, previous)) return baked;
        const saved = Object.fromEntries(bakeFlags.map(name => [name, globalThis[name]]));
        try {
          Object.assign(globalThis, flags);
          const posed = K.diorama.build(source, { ...env, parameterInputs:inputs ?? env.parameterInputs, billboardFrames:frames });
          if (!posed.anim && !inputs) {
            previous = key;
            baked = posed;
          }
          return posed;
        } finally {
          Object.assign(globalThis, saved);
        }
      }
    });
    return world => { world.prefabBillboards = sampler; };
  }

  A.prefabBillboards = Object.freeze({ read, orient, plan, prepare, frames: world => world[presentation] });
})(KIT);
