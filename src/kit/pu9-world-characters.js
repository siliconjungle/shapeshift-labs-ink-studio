/* Capsule controller over shared terrain, medium and gravity queries. */
(function (K) {
  const W = K.world, { V, M } = K, P = K.procedural;
  const { clone, freeze } = P.data;
  const finite = Number.isFinite, xyz = v => W.data.vector(v) && Array.from(v).every(finite);
  const defaults = {
    radius: 0.18, height: 1.64, flatBottom: false, stepUp: 0.32, groundSnap: 0.16, minimumNormal: 0.63,
    walkSpeed: 3.4, groundAcceleration: 28, airAcceleration: 9, jumpSpeed: 4.6, gravity: 14, terminalSpeed: 20,
    swimSpeed: 2.25, swimVerticalSpeed: 1.8, swimAcceleration: 12, currentScale: 1, buoyancy: 0,
    swimEnter: 0.52, swimExit: 0.39, eyes: 0.91, climbHeight: 0.75, climbReach: 0.42,
    maxStep: 1 / 60, maxSteps: 120
  };
  const standard = new Set(['ground', 'air', 'swim']);
  const zero = Object.freeze([0, 0, 0]), air = Object.freeze({ kind: 'air' });
  const close = (a, b) => V.dist(a, b) <= 1e-5;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const identity = Object.freeze(M.id()), still = Object.freeze({ traction: 1, downhill: 0, drift: zero });

  function response(row) {
    if (row == null) return still;
    const { traction = 1, downhill = 0, drift = zero, launch } = row;
    if (!W.data.record(row) || !finite(traction) || traction < 0 || !finite(downhill) || downhill < 0 || !xyz(drift))
      throw new TypeError('A surface response needs nonnegative traction and downhill factors and finite drift');
    if (launch === undefined) return { traction, downhill, drift };
    const { speed = 0, restitution = 0, minImpact = .5, direction } = launch ?? {};
    if (!W.data.record(launch) || !finite(speed) || speed < 0 || !finite(restitution) || restitution < 0 ||
        restitution > 1 || !finite(minImpact) || minImpact < 0 ||
        direction !== undefined && (!xyz(direction) || V.len(direction) < 1e-8))
      throw new TypeError('A surface launch needs finite speed, impact threshold and restitution in [0, 1]');
    return { traction, downhill, drift, launch: { speed, restitution, minImpact, direction } };
  }

  function surfaces({ bySupport = {}, byMaterial = {} } = {}) {
    function catalog(rows) {
      if (!W.data.record(rows)) throw new TypeError('Surface responses need JSON records keyed by support or material');
      const entries = Object.entries(clone(rows));
      for (const [, row] of entries) if (row !== null) response(row);
      return new Map(entries.map(([key, row]) => [key, freeze(row)]));
    }
    const supports = catalog(bySupport), materials = catalog(byMaterial);
    return seat => supports.has(seat.support) ? supports.get(seat.support) : materials.get(seat.material);
  }

  function surfaceFrame(world, id) {
    if (id == null) return null;
    const row = world.surfaceMotion?.(id);
    if (row == null) return null;
    const { position, rotation = identity, velocity, angular } = row;
    if (!xyz(position) || !Array.isArray(rotation) || rotation.length !== 9 || !Array.from(rotation).every(finite) ||
        velocity !== undefined && !xyz(velocity) || angular !== undefined && !xyz(angular))
      throw new TypeError('A moving support needs a position, rotation matrix and optional finite velocities');
    return { position, rotation, velocity, angular };
  }

  function fromBiome(frame, { supportPadding = 0.24, gravityAt, surfaceResponse } = {}) {
    if (typeof frame?.supports !== 'function' || typeof frame.distance !== 'function' ||
        typeof frame.view?.mediumAt !== 'function' || !finite(supportPadding) || supportPadding < 0 ||
        gravityAt!==undefined&&typeof gravityAt!=='function' ||
        surfaceResponse!==undefined&&typeof surfaceResponse!=='function')
      throw new TypeError('Expected a prepared biome frame and nonnegative support padding');
    return Object.freeze({ supports: (x, z, low, high) => frame.supports(x, z, low, high),
      clearance: point => frame.distance(...point), mediumAt: point => frame.view.mediumAt(...point),
      ...(gravityAt&&{gravityAt}),...(surfaceResponse&&{surfaceResponse}),supportPadding });
  }
  function fromQuery(query,{gravity,clearance,support,medium,supportPadding=0,exclude,surfaceBodies,surfaceResponse}={}){
    if(typeof query?.probe!=='function'||typeof clearance!=='string'||typeof gravity!=='string'||
        [support,medium,surfaceBodies].some(field=>field!==undefined&&typeof field!=='string')||
        surfaceResponse!==undefined&&typeof surfaceResponse!=='function'||
        !finite(supportPadding)||supportPadding<0)throw new TypeError('A local character adapter needs gravity and clearance fields');
    const bodies=surfaceBodies?query.probe(surfaceBodies):null;
    if(bodies&&(bodies.status!=='ok'||!W.data.record(bodies.value)))
      throw new TypeError('Character moving supports need a body record field');
    return Object.freeze({
      gravityAt:point=>W.gravity.sample(query,gravity,point),
      clearance(point,radius,withoutSupport){
        const ignored=withoutSupport===undefined?exclude:[...(Array.isArray(exclude)?exclude:exclude===undefined?[]:[exclude]),withoutSupport];
        const read=query.probe(clearance,point,{exclude:ignored});
        return read.status==='ok'?read.value:Infinity;
      },
      ...(bodies&&{surfaceMotion:id=>W.data.own(bodies.value,id)?bodies.value[id]:null}),
      ...(surfaceResponse&&{surfaceResponse}),
      ...(support&&{supportAlong(origin,axis,distance){
        const hit=query.trace(support,origin,{direction:axis,distance,exclude});
        return hit.status==='ok'?hit.value:null;
      }}),
      ...(medium&&{mediumAt(point){
        const read=query.probe(medium,point);
        if(read.status!=='ok')return air;
        const value=read.value;
        if(typeof value==='number')return value>0?{kind:'water'}:air;
        const kind=value.kind??(point[1]<value.surface?'water':'air');
        const flow=value.current??value.velocity;
        return {...value,kind,...(flow&&{current:flow.length===2?[flow[0],0,flow[1]]:flow})};
      }}),supportPadding
    });
  }
  function steer(from, to, amount) {
    const delta = V.sub(to, from), length = V.len(delta);
    return length <= amount ? to : V.mad(from, delta, amount / length);
  }

  function create({ tuning = {}, modes = {}, selectMode, allowSupport } = {}) {
    if (!W.data.record(tuning) || Object.keys(tuning).some(key => !Object.hasOwn(defaults, key)) ||
        !W.data.record(modes) || Object.entries(modes).some(([name, mode]) => !W.data.safeKey(name) ||
          standard.has(name) || typeof mode !== 'function') ||
        selectMode !== undefined && typeof selectMode !== 'function' ||
        allowSupport !== undefined && typeof allowSupport !== 'function')
      throw new TypeError('Invalid character tuning or movement extensions');
    const t = Object.freeze({ ...defaults, ...tuning });
    if (typeof t.flatBottom !== 'boolean' || Object.entries(t).some(([key, value]) =>
        key !== 'flatBottom' && (!finite(value) || key !== 'buoyancy' && value < 0)) ||
        t.radius < 0.03 || t.radius > 4 || t.height < 2 * t.radius + 0.05 || t.height > 12 ||
        t.stepUp > t.height - 2 * t.radius - 0.025 || t.groundSnap > 16 || t.climbHeight > 1000 ||
        t.minimumNormal < 0.01 || t.minimumNormal > 1 || t.maxStep <= 0 || t.maxStep > 1 ||
        !Number.isSafeInteger(t.maxSteps) || t.maxSteps < 1 ||
        t.swimExit > t.swimEnter || t.swimEnter > t.eyes || t.eyes > 1)
      throw new RangeError('Invalid character body, medium thresholds or time limits');
    const { radius, height } = t, half = height / 2;
    const shaft = half - radius, sections = Math.max(1, Math.ceil(shaft * 2 / (radius * 0.55)));
    const sole=t.flatBottom?P.traversal.footprint(radius):null;
    const soleHeights=[-half,-half+radius*.5,-shaft];
    const stride = Math.min(0.085, radius * 0.5), extensions = new Map(Object.entries(modes)), worlds = new WeakMap();
    const above = (p, y) => [p[0], p[1] + y, p[2]];
    const horizontal = v => [v[0], 0, v[2]];
    const supportHeight = (actor, fraction) => above(actor.position, height * fraction - half);

    function state(actor = {}) {
      const anchor = actor.surfaceAnchor;
      if (!xyz(actor.position) || actor.velocity !== undefined && !xyz(actor.velocity) || actor.forward !== undefined && !xyz(actor.forward) ||
          actor.up !== undefined && !xyz(actor.up) || actor.gravityForward!==undefined&&!xyz(actor.gravityForward) ||
          actor.surfaceMomentum !== undefined && !xyz(actor.surfaceMomentum) ||
          anchor !== undefined && (!W.data.record(anchor) || !W.data.safeKey(anchor.id) ||
            !xyz(anchor.local) || !xyz(anchor.foot) || !xyz(anchor.center)) ||
          actor.mode !== undefined &&
          !standard.has(actor.mode) && !extensions.has(actor.mode) ||
          actor.jumpHeld !== undefined && typeof actor.jumpHeld !== 'boolean')
        throw new TypeError('A character needs a position, finite vectors and a known movement mode');
      return freeze(clone({ velocity: zero, forward: [0, 0, -1], up: [0, 1, 0],
        mode: 'air', jumpHeld: false, ...actor }));
    }
    function queries(world) {
      if (!world || typeof world.supports !== 'function' || typeof world.clearance !== 'function' ||
          world.mediumAt !== undefined && typeof world.mediumAt !== 'function' ||
          world.surfaceResponse !== undefined && typeof world.surfaceResponse !== 'function' ||
          world.supportPadding !== undefined && (!finite(world.supportPadding) || world.supportPadding < 0))
        throw new TypeError('A character world needs supports, point clearance and an optional medium query');
      if (!worlds.has(world)) worlds.set(world, P.traversal.create({
        supports: (...args) => world.supports(...args), clearance: (...args) => world.clearance(...args),
        radius, height, flatBottom:t.flatBottom, stepUp: t.stepUp, stepDown: t.groundSnap, minimumNormal: t.minimumNormal
      }));
      return worlds.get(world);
    }
    function medium(world, point) {
      const m = world.mediumAt?.(point) ?? air;
      if (typeof m.kind !== 'string' || m.current !== undefined && !xyz(m.current))
        throw new TypeError('A character medium needs a kind and an optional finite XYZ current');
      return m;
    }
    function fits(world, p) {
      function clear(point, required) {
        const d=world.clearance(point,radius);
        if(!finite(d)&&d!==Infinity)throw new TypeError('Character clearance must be signed distance or positive infinity');
        return d>=required-.0005;
      }
      for (let i = 0; i <= sections; i++) {
        if(!clear(above(p,-shaft+i*(2*shaft/sections)),radius))return false;
      }
      if(sole)for(const [x,z] of sole){
        for(const y of soleHeights)if(!clear([p[0]+x,p[1]+y,p[2]+z],0))return false;
      }
      return true;
    }
    function sweep(world, from, to) {
      const delta = V.sub(to, from), steps = Math.ceil(V.len(delta) / stride);
      if (!Number.isSafeInteger(steps) || steps > 2048) throw new RangeError('Character motion exceeds the sweep budget');
      let previous = from;
      for (let i = 1; i <= steps; i++) {
        const next = V.mad(from, delta, i / steps);
        if (!fits(world, next)) {
          let lo = (i - 1) / steps, hi = i / steps;
          for (let refine = 0; refine < 7; refine++) {
            const at = (lo + hi) / 2;
            if (fits(world, V.mad(from, delta, at))) lo = at;
            else hi = at;
          }
          return { position: V.mad(from, delta, lo), blocked: true };
        }
        previous = next;
      }
      return { position: previous, blocked: false };
    }
    function slide(world, from, delta, trace) {
      const to = V.add(from, delta), direct = sweep(world, from, to);
      trace(from, direct.position);
      if (!direct.blocked || !delta[0] || !delta[2]) return direct;
      let p = direct.position;
      for (const axis of Math.abs(delta[0]) >= Math.abs(delta[2]) ? [0, 2] : [2, 0]) {
        const target = p.slice();
        target[axis] = to[axis];
        const next = sweep(world, p, target).position;
        trace(p, next);
        p = next;
      }
      return { position: p, blocked: true };
    }
    function seated(world, ground, actor, candidate, rise, drop) {
      const seat = ground.stand(above(candidate, -half), { rise, drop });
      if (!seat || allowSupport && !allowSupport(actor, seat, world)) return null;
      const center = above(seat.foot, half), padding = world.supportPadding ?? 0;
      if (fits(world, center)) return { center, seat };
      if (padding === 0 || !fits(world, above(center, padding))) return null;
      // Biome fields can conservatively underestimate distance even above flat supports.
      let low = 0, high = padding;
      for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2;
        if (fits(world, above(center, mid))) high = mid;
        else low = mid;
      }
      return { center: above(center, high), seat };
    }
    function stepToSeat(world, from, target, trace) {
      if (!target) return null;
      const to = target.center;
      const over = to[1] > from[1] ? [from[0], to[1], from[2]] : [to[0], from[1], to[2]];
      if (sweep(world, from, over).blocked || sweep(world, over, to).blocked) return null;
      trace(from, over);
      trace(over, to);
      return target;
    }
    function walk(world, ground, actor, delta, trace) {
      const from = actor.position, candidate = V.add(from, delta);
      function attempt(to, minimumRise) {
        const target = seated(world, ground, actor, to, t.stepUp, t.groundSnap + (world.supportPadding ?? 0));
        const rise = target && target.center[1] - from[1];
        return target && rise >= minimumRise && rise <= t.stepUp + 0.008 ? stepToSeat(world, from, target, trace) : null;
      }
      const direct = attempt(candidate, -t.groundSnap - 0.008);
      if (direct || t.stepUp === 0 || V.len(delta) < 1e-5) return direct;
      // A rounded body reaches the riser before its center reaches the new support.
      const ahead = V.mad(candidate, V.norm(delta), radius + stride);
      return attempt(ahead, 0.008);
    }
    function climb(world, ground, actor, input, eyes, trace) {
      if (!input.climb || t.climbHeight === 0 || eyes.kind === 'water' || V.len(input.move) < 1e-5) return null;
      const ahead = V.mad(actor.position, V.norm(input.move), t.climbReach);
      const target = seated(world, ground, actor, ahead, t.climbHeight, 0);
      if (!target || target.center[1] <= actor.position[1] + 1e-5 ||
          medium(world, above(target.center, height * t.swimExit - half)).kind === 'water') return null;
      return stepToSeat(world, actor.position, target, trace);
    }
    function control(raw) {
      const { move = [0, 0], vertical = 0, jump = false, climb = true } = raw;
      if (!Array.isArray(move) || move.length !== 2 || !Array.from(move).every(finite) ||
          !finite(vertical) || typeof jump !== 'boolean' || typeof climb !== 'boolean')
        throw new TypeError('Movement needs world XZ input, vertical input and optional jump and climb buttons');
      const length = Math.max(1, Math.hypot(...move));
      return freeze({ ...clone(raw), move: [move[0] / length, 0, move[1] / length],
        vertical: clamp(vertical, -1, 1), jump, climb });
    }
    const tangent = (vector, normal) => V.mad(vector, normal, -V.dot(vector, normal));
    function profile(world, seat) {
      return seat && world.surfaceResponse ? response(world.surfaceResponse(seat)) : still;
    }
    function launch(velocity, surface, seat, settings) {
      if (!settings) return null;
      const relative = V.sub(velocity, surface), impact = -V.dot(relative, seat.normal);
      if (impact <= 1e-8 || impact < settings.minImpact) return null;
      const speed = Math.max(settings.speed, impact * settings.restitution);
      const direction = settings.direction ? V.norm(settings.direction) : seat.normal;
      if (speed <= 0 || direction[1] <= 0 || V.dot(direction, seat.normal) <= 0) return null;
      const impulse = V.mad(surface, direction, speed);
      return { velocity: V.add(tangent(relative, seat.normal), impulse), momentum: horizontal(impulse), impact };
    }
    const noVelocity = () => zero;

    function stepUpright(actor, raw, seconds, world, velocityAt = noVelocity) {
      const ground = queries(world), input = control(raw ?? {});
      if (!finite(seconds) || seconds < 0 || Math.ceil(seconds / t.maxStep) > t.maxSteps)
        throw new RangeError('Character step duration exceeds its time budget');
      let current = state(actor), support = null, blocked = false;
      const events = [], segments = [], steps = Math.ceil(seconds / t.maxStep);
      const dt = steps ? seconds / steps : 0;
      for (let tick = 0; tick < steps; tick++) {
        const from = current.position;
        const sampled = medium(world, supportHeight(current, current.mode === 'swim' ? t.swimExit : t.swimEnter));
        const eyes = medium(world, supportHeight(current, t.eyes));
        const padding = world.supportPadding ?? 0;
        const floor = seated(world, ground, current, from, 0.008, t.groundSnap + padding);
        const jumpPressed = input.jump && !current.jumpHeld && tick === 0;
        const settings = profile(world, floor?.seat);
        const drift = floor && settings.drift !== zero ? tangent(settings.drift, floor.seat.normal) : zero;
        const platform = floor ? velocityAt(floor.seat) : zero;
        const surface = drift === zero ? platform : V.add(platform, drift);
        const spring = floor && current.mode === 'air' && launch(current.velocity, surface, floor.seat, settings.launch);
        const planted = floor && !spring && current.velocity[1] <= 0 &&
          (current.mode === 'ground' || Math.abs(floor.center[1] - from[1]) <= 0.008);
        const natural = sampled.kind === 'water' ? 'swim' : planted ? 'ground' : 'air';
        const context = Object.freeze({ actor: current, input, world, medium: sampled, eyes,
          support: floor?.seat ?? null, natural, jumpPressed, dt, tuning: t });
        let mode = selectMode?.(context) ?? natural, p = from, velocity = current.velocity, patch = {};
        let momentum = mode === 'air' ? current.surfaceMomentum ?? zero : zero;
        if (!standard.has(mode) && !extensions.has(mode)) throw new RangeError('Unknown character movement mode ' + mode);
        const path = [], trace = (a, b) => { if (!close(a, b)) path.push({ previous: a, position: b }); };
        const climbed = mode === 'swim' && climb(world, ground, current, input, eyes, trace);
        support = null;
        if (climbed) {
          p = climbed.center;
          support = climbed.seat;
          velocity = V.mul(input.move, t.walkSpeed * 0.65);
          mode = 'ground';
          events.push({ type: 'climb-out', position: p });
        } else if (extensions.has(mode)) {
          const result = extensions.get(mode)(context);
          if (!xyz(result?.velocity) || result.actor !== undefined && (!W.data.record(result.actor) ||
              result.actor.forward !== undefined && !xyz(result.actor.forward) ||
              result.actor.up !== undefined && !xyz(result.actor.up)))
            throw new TypeError('Custom movement must return velocity and can patch actor data');
          velocity = result.velocity.slice();
          patch = result.actor ?? {};
          const motion = sweep(world, p, V.mad(p, velocity, dt));
          trace(p, motion.position);
          p = motion.position;
          blocked ||= motion.blocked;
          if (motion.blocked) velocity = V.mul(V.sub(p, from), 1 / dt);
        } else {
          const swimming = mode === 'swim';
          if (swimming) {
            const desired = V.add(V.mul(input.move, t.swimSpeed), V.mul(sampled.current ?? zero, t.currentScale));
            desired[1] += (input.jump ? 1 : input.vertical) * t.swimVerticalSpeed + t.buoyancy*(world.localBuoyancy??1);
            velocity = steer(velocity, desired, t.swimAcceleration * dt);
          } else {
            let speed = steer(horizontal(momentum === zero ? velocity : V.sub(velocity, momentum)), V.mul(input.move, t.walkSpeed),
              (mode === 'ground' ? t.groundAcceleration * settings.traction : t.airAcceleration) * dt);
            if (mode === 'ground' && settings.downhill > 0) {
              const gravity = world.localAcceleration ?? [0, -t.gravity, 0];
              speed = V.mad(speed, horizontal(tangent(gravity, floor?.seat.normal ?? [0, 1, 0])), settings.downhill * dt);
            }
            velocity = [speed[0] + momentum[0], velocity[1], speed[2] + momentum[2]];
          }
          if (mode === 'ground' && floor && jumpPressed && t.jumpSpeed > 0) {
            mode = 'air';
            velocity[1] = t.jumpSpeed;
            if (surface !== zero) {
              velocity = V.add(velocity, surface);
              momentum = horizontal(surface);
            }
            events.push({ type: 'jump', position: from });
          }
          if (mode === 'ground') {
            const landed = walk(world, ground, current, V.mul(horizontal(drift === zero ? velocity : V.add(velocity, drift)), dt), trace);
            if (landed) {
              p = landed.center;
              support = landed.seat;
              velocity[1] = 0;
            } else {
              mode = 'air';
              if (surface !== zero) {
                velocity = V.add(velocity, surface);
                momentum = horizontal(surface);
              }
            }
          }
          if (mode !== 'ground') {
            if (!swimming) {
              if(world.localAcceleration)velocity=V.mad(velocity,world.localAcceleration,dt);
              else velocity[1]-=t.gravity*dt;
              velocity[1]=Math.max(-t.terminalSpeed,velocity[1]);
            }
            const vertical = () => {
              const dy = velocity[1] * dt;
              const target = !swimming && dy <= 0 && seated(world, ground, current, p, 0.008, -dy + 0.008 + padding);
              if (target && target.center[1] >= p[1] + dy - 0.008 && target.center[1] <= p[1] + 0.008 &&
                  stepToSeat(world, p, target, trace)) {
                p = target.center;
                if (current.mode !== 'ground' || !floor) events.push({ type: 'land', position: p });
                const on = profile(world, target.seat), platform = velocityAt(target.seat);
                const flow = on.drift === zero ? zero : tangent(on.drift, target.seat.normal);
                const rebound = launch(velocity, flow === zero ? platform : V.add(platform, flow), target.seat, on.launch);
                if (rebound) {
                  velocity = rebound.velocity;
                  momentum = rebound.momentum;
                  events.push({ type: 'surface-launch', position: p, point: target.seat.foot,
                    normal: target.seat.normal, support: target.seat.support,
                    material: target.seat.material ?? null, impact: rebound.impact, velocity });
                } else {
                  support = target.seat;
                  mode = 'ground';
                  velocity = horizontal(platform === zero ? velocity : V.sub(velocity, platform));
                  momentum = zero;
                }
                return;
              }
              const moved = sweep(world, p, above(p, dy));
              trace(p, moved.position);
              p = moved.position;
              blocked ||= moved.blocked;
              if (moved.blocked) velocity[1] = 0;
            };
            const rising = velocity[1] > 0;
            if (rising) vertical();
            const flat = slide(world, p, V.mul(horizontal(velocity), dt), trace);
            if (flat.blocked) {
              blocked = true;
              const achieved = V.mul(V.sub(flat.position, p), 1 / dt);
              if (momentum !== zero) momentum = momentum.map((value, axis) =>
                Math.abs(achieved[axis] - velocity[axis]) > 1e-5 ? 0 : value);
              velocity[0] = (flat.position[0] - p[0]) / dt;
              velocity[2] = (flat.position[2] - p[2]) / dt;
            }
            p = flat.position;
            if (!rising) vertical();
          }
        }
        if (mode !== current.mode) events.push({ type: 'mode', from: current.mode, to: mode, position: p });
        const next = { ...current, ...clone(patch), position: p, velocity, mode, jumpHeld: input.jump,
          forward: patch.forward ? clone(patch.forward) : V.len(input.move) > 1e-5 ? V.norm(input.move) : current.forward };
        if (momentum !== zero && momentum.some(n => Math.abs(n) > 1e-8)) next.surfaceMomentum = momentum;
        else delete next.surfaceMomentum;
        current = freeze(next);
        for (const segment of path) segments.push({ previous: segment.previous, actor: freeze({ ...current, position: segment.position }) });
      }
      return freeze({ actor: current, segments, events, support, blocked,
        medium: clone(medium(world, current.position)), eyes: clone(medium(world, supportHeight(current, t.eyes))) });
    }
    function localWorld(world,origin,frame,heading,velocity){
      const G=W.gravity, matrix=G.basis(frame.up,heading), inverse=M.tr(matrix);
      const toVector=v=>M.app(inverse,v), fromVector=v=>M.app(matrix,v);
      const toPoint=p=>toVector(V.sub(p,origin)), fromPoint=p=>V.add(origin,fromVector(p));
      const fromSeat=seat=>({...seat,foot:fromPoint(seat.foot),normal:fromVector(seat.normal)});
      const adapter={
        supports(x,z,low,high){
          const start=fromPoint([x,high,z]), down=V.mul(frame.up,-1);
          const hit=world.supportAlong?world.supportAlong(start,down,high-low):G.ray(world.clearance,start,down,high-low);
          if(!hit)return [];
          return [{y:toPoint(hit.point)[1],normal:toVector(hit.normal),id:hit.id??'surface',material:hit.material}];
        },
        clearance:(p,radius)=>world.clearance(fromPoint(p),radius),
        mediumAt(p){
          const hit=medium(world,fromPoint(p));
          return hit.current?{...hit,current:toVector(hit.current)}:hit;
        },
        ...(world.surfaceResponse&&{surfaceResponse(seat){
          const profile=response(world.surfaceResponse(fromSeat(seat)));
          return {...profile,drift:toVector(profile.drift),...(profile.launch?.direction&&{
            launch:{...profile.launch,direction:toVector(profile.launch.direction)}
          })};
        }}),
        supportPadding:world.supportPadding,
        localAcceleration:toVector(G.inertial(frame,velocity)),localBuoyancy:frame.buoyancy
      };
      return {adapter,toVector,fromVector,toPoint,fromPoint,fromSeat};
    }
    function advance(actor,raw,seconds,world,velocityAt=noVelocity){
      if(typeof world?.gravityAt!=='function')return stepUpright(actor,raw,seconds,world,velocityAt);
      if(typeof world.clearance!=='function'||world.supportAlong!==undefined&&typeof world.supportAlong!=='function')
        throw new TypeError('Local gravity needs clearance and optional directional support');
      if(world.surfaceResponse!==undefined&&typeof world.surfaceResponse!=='function')
        throw new TypeError('Expected a surface response callback');
      const count=Math.ceil(seconds/t.maxStep);
      if(!finite(seconds)||seconds<0||count>t.maxSteps)throw new RangeError('Character step duration exceeds its time budget');
      raw??={};
      if(raw.moveWorld!==undefined&&!xyz(raw.moveWorld))throw new TypeError('World movement needs a finite XYZ vector');
      const G=W.gravity, dt=count?seconds/count:0;
      let current=state(actor), support=null, blocked=false;
      const segments=[],events=[];
      for(let tick=0;tick<count;tick++){
        const frame=G.normalize(world.gravityAt(current.position),[0,-t.gravity,0]);
        const transport=G.turn(V.norm(current.up),frame.up);
        const heading=V.norm(G.tangent(M.app(transport,current.gravityForward??current.forward),frame.up),V.perp(frame.up));
        const velocity=current.mode==='ground'?M.app(transport,current.velocity):current.velocity;
        const map=localWorld(world,current.position,frame,heading,velocity);
        const {toVector,fromVector,fromPoint,fromSeat}=map;
        const desired=raw.moveWorld===undefined?null:toVector(raw.moveWorld);
        const input=desired?{...raw,move:[desired[0],desired[2]]}:raw;
        const localVelocity=toVector(velocity);
        if(current.mode==='ground')localVelocity[1]=0;
        const upright={...current,position:zero,up:[0,1,0],velocity:localVelocity,forward:toVector(M.app(transport,current.forward)),
          ...(current.surfaceMomentum&&{surfaceMomentum:toVector(current.surfaceMomentum)})};
        const localVelocityAt=velocityAt===noVelocity?noVelocity:seat=>toVector(velocityAt(fromSeat(seat)));
        const result=stepUpright(upright,input,dt,map.adapter,localVelocityAt);
        function fromActor(row){
          const position=fromPoint(row.position), axis=G.normalize(world.gravityAt(position),[0,-t.gravity,0]).up;
          const change=G.turn(frame.up,axis);
          const speed=fromVector(row.velocity);
          return {...row,position,up:axis,velocity:row.mode==='ground'?M.app(change,speed):speed,
            ...(row.surfaceMomentum&&{surfaceMomentum:fromVector(row.surfaceMomentum)}),
            forward:V.norm(G.tangent(M.app(change,fromVector(row.forward)),axis),V.perp(axis)),
            gravityForward:M.app(change,heading)};
        }
        current=freeze(fromActor(result.actor));
        support=result.support?fromSeat(result.support):null;
        blocked ||= result.blocked;
        for(const row of result.segments)segments.push({previous:fromPoint(row.previous),actor:fromActor(row.actor)});
        for(const row of result.events)events.push({...row,position:fromPoint(row.position),
          ...(row.point&&{point:fromPoint(row.point),normal:fromVector(row.normal)}),
          ...(row.velocity&&{velocity:fromVector(row.velocity)})});
      }
      return freeze({actor:current,segments,events,support,blocked,medium:clone(medium(world,current.position)),
        eyes:clone(medium(world,V.mad(current.position,current.up,height*t.eyes-half)))});
    }
    function carry(actor, anchor, world, frame) {
      const foot = V.add(frame.position, M.app(frame.rotation, anchor.local));
      const displacement = V.sub(foot, anchor.foot);
      const from = actor.position, target = V.add(from, displacement);
      if (V.dist(from, target) === 0) return { position: from, blocked: false };
      const clearance = (point, radius) => world.clearance(point, radius, anchor.id);
      const local = typeof world.gravityAt === 'function'
        ? localWorld({ ...world, clearance }, from, W.gravity.normalize(world.gravityAt(from), [0, -t.gravity, 0]),
          actor.forward, actor.velocity) : null;
      const motion = local ? sweep(local.adapter, zero, local.toPoint(target)) : sweep({ clearance }, from, target);
      return { position: local ? local.fromPoint(motion.position) : motion.position, blocked: motion.blocked };
    }
    function step(actor, raw = {}, seconds, world) {
      if ((world?.surfaceMotion === undefined && actor?.surfaceAnchor === undefined) || seconds === 0)
        return advance(actor, raw, seconds, world);
      if (world?.surfaceMotion !== undefined && typeof world.surfaceMotion !== 'function')
        throw new TypeError('Expected a moving support callback');
      if (!finite(seconds) || seconds < 0 || Math.ceil(seconds / t.maxStep) > t.maxSteps)
        throw new RangeError('Character step duration exceeds its time budget');
      const { surfaceAnchor, ...current } = state(actor);
      const anchor = current.mode === 'ground' && surfaceAnchor && close(current.position, surfaceAnchor.center)
        ? surfaceAnchor : null;
      const frame = anchor && surfaceFrame(world, anchor.id);
      const moved = frame && carry(current, anchor, world, frame);
      const position = moved?.position ?? current.position;
      const event = moved?.blocked ? { type: 'surface-blocked', support: anchor.id, position } : null;
      if (moved && !fitsAt(world, position)) {
        // A host can stop or roll back the support when it leaves no valid carried pose.
        return freeze({ actor: state(actor), segments: [], support: null, blocked: true,
          events: [{ type: 'surface-blocked', support: anchor.id, position: current.position }],
          medium: clone(medium(world, current.position)),
          eyes: clone(medium(world, V.mad(current.position, current.up, height * t.eyes - half))) });
      }
      const start = { ...current, position };
      const observed = moved && V.mul(V.sub(position, current.position), 1 / seconds);
      const result = advance(start, raw, seconds, world, seat => {
        const returning = moved && seat.support === anchor.id;
        if (returning && moved.blocked) return zero;
        const sample = returning ? frame : surfaceFrame(world, seat.support);
        if (!sample) return zero;
        if (!sample.velocity && returning) return observed;
        return sample.angular ? V.add(sample.velocity ?? zero, V.cross(sample.angular, V.sub(seat.foot, sample.position))) :
          sample.velocity ?? zero;
      });
      const landed = result.actor.mode === 'ground' && result.support;
      const landingFrame = landed && surfaceFrame(world, landed.support);
      const next = landingFrame ? { ...result.actor, surfaceAnchor: {
        id: landed.support, local: M.app(M.tr(landingFrame.rotation), V.sub(landed.foot, landingFrame.position)),
        foot: landed.foot, center: result.actor.position
      } } : result.actor;
      return freeze({ ...result, actor: next, blocked: result.blocked || Boolean(event),
        segments: close(current.position, position) ? result.segments
          : [{ previous: current.position, actor: start }, ...result.segments],
        events: event ? [event, ...result.events] : result.events });
    }
    function sweepTo(actor, target, world) {
      const current = state(actor);
      if (!xyz(target)) throw new TypeError('A character sweep needs a finite destination');
      if (typeof world?.gravityAt !== 'function') {
        queries(world);
        return sweep(world, current.position, target);
      }
      const frame = W.gravity.normalize(world.gravityAt(current.position), [0, -t.gravity, 0]);
      const map = localWorld(world, current.position, frame, current.forward, current.velocity);
      const result = sweep(map.adapter, zero, map.toPoint(target));
      return { ...result, position: map.fromPoint(result.position) };
    }
    async function cross(session, linkId, movement, { camera } = {}) {
      const link = session.linksFrom(session.current()?.id).find(row => row.id === linkId);
      if (!link?.sweep) return null;
      const segment = movement.segments.find(({ previous, actor }) => link.sweep.hit(previous, actor.position, { radius }));
      if (!segment) return null;
      const actorForLink = segment.actor.surfaceMomentum && link.opening ? { ...segment.actor,
        surfaceMomentum: link.opening.direction(segment.actor.surfaceMomentum) } : segment.actor;
      const arrival = await session.cross(linkId, { ...segment, actor: actorForLink, radius, camera });
      if (arrival) return Object.freeze({ status: 'crossed', actor: arrival.actor, arrival });
      const normal = link.from.at.normal, inward = Math.min(0, V.dot(segment.actor.velocity, normal));
      const actor = freeze({ ...segment.actor, position: segment.previous,
        velocity: V.mad(segment.actor.velocity, normal, -inward) });
      return Object.freeze({ status: 'blocked', actor, arrival: null });
    }
    function fitsAt(world, position) {
      if (!xyz(position)) throw new TypeError('A character capsule needs a finite center');
      if(typeof world?.gravityAt==='function'){
        const frame=W.gravity.normalize(world.gravityAt(position),[0,-t.gravity,0]);
        return fits(localWorld(world,position,frame,[0,0,-1],zero).adapter,zero);
      }
      queries(world);
      return fits(world, position);
    }
    return Object.freeze({ state, step, cross, sweepTo, fits: fitsAt, tuning: t });
  }
  W.characters = Object.freeze({ create, fromBiome, fromQuery, surfaces });
})(KIT);
