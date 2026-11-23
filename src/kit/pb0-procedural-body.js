/* One collision-aware joint graph can drive flexible curves and rigid parts. */
(function (K) {
  const { V, M } = K;
  const vector = p => p?.length === 3 && Array.from(p).every(Number.isFinite);
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  const name = id => typeof id === 'string' && id.length > 0;
  const check = (ok, message) => {
    if (!ok) throw new RangeError('Procedural body: ' + message);
  };
  function basis(from, to, up, fallback = [1, 0, 0]) {
    const x = V.norm(V.sub(to, from), fallback);
    const y = V.norm(V.mad(up, x, -V.dot(x, up)), V.perp(x));
    return M.tr([...x, ...y, ...V.cross(x, y)]);
  }

  function create({ joints, links, bends = [], gravity = [0, -1, 0], damping = 3, friction = .12,
    sdf, hz = 120, substeps = 6, contactTolerance = .02 } = {}) {
    check(joints && typeof joints === 'object' && Object.keys(joints).length >= 2 &&
      Array.isArray(links) && links.length && Array.isArray(bends), 'provide named joints and links');
    check(vector(gravity) && nonnegative(damping) && nonnegative(friction) && friction <= 1 &&
      Number.isInteger(hz) && hz >= 24 && hz <= 240 && Number.isInteger(substeps) && substeps >= 1 && substeps <= 12 &&
      nonnegative(contactTolerance) && (sdf === undefined || typeof sdf === 'function'), 'invalid clock or contact settings');
    const field = sdf && K.xpbd.contactField(sdf,{friction,tolerance:contactTolerance,fallback:[0,1,0]});
    const solver = K.xpbd.sim({ gravity:Array.from(gravity), damp:damping, substeps, project:field?.project,
      fixedStep:true, substepPins:true });
    const nodes = new Map(), edges = new Map();
    const overrides = new Map();
    const restPose = [];
    let ticks=0, seconds=0;
    for (const [id, joint] of Object.entries(joints)) {
      const { at, radius = .03, mass = 1, drive, compliance = .00004 } = joint ?? {};
      check(name(id) && vector(at) && nonnegative(radius) && Number.isFinite(mass) && mass > 0 &&
        (drive === undefined || typeof drive === 'function') && nonnegative(compliance), 'invalid joint ' + id);
      const rest = Array.from(at);
      const index=solver.point(rest,1/mass,radius);
      restPose.push(...rest);
      nodes.set(id,{ index, rest, radius, drive });
      edges.set(id,new Set());
      if (drive) solver.tie(index, time => {
        const point=overrides.get(id) ?? drive(time);
        check(vector(point), 'drive must return a finite point for ' + id);
        return point;
      }, compliance);
    }
    function node(id) {
      const value=nodes.get(id);
      check(value, 'unknown joint ' + id);
      return value;
    }
    function link(from,to,compliance) {
      const a=node(from), b=node(to);
      check(V.dist(a.rest,b.rest)>1e-5 && nonnegative(compliance), 'invalid link ' + from + ' to ' + to);
      solver.link(a.index,b.index,compliance);
    }
    for (const { from, to, compliance = 0 } of links) {
      const neighbors=edges.get(from);
      check(neighbors && edges.has(to) && !neighbors.has(to), 'links need known endpoints and must be unique');
      link(from,to,compliance);
      neighbors.add(to);
      edges.get(to).add(from);
    }
    function edge(from,to) {
      check(edges.get(from)?.has(to), 'no link from ' + from + ' to ' + to);
    }
    for (const { through, compliance = .003 } of bends) {
      check(Array.isArray(through) && through.length === 3, 'a bend needs three joints');
      const [from, joint, to]=through;
      edge(from,joint);
      edge(joint,to);
      link(from,to,compliance);
    }

    const position = index => Array.from(solver.X.subarray(index*3,index*3+3));
    const point = id => position(node(id).index);
    function attachment(from,to,{ at = 0, up = [0,1,0], offset = [0,0,0] } = {}) {
      edge(from,to);
      check(Number.isFinite(at) && at >= 0 && at <= 1 && vector(up) &&
        V.len(up)>1e-5 && vector(offset), 'invalid attachment');
      const a=node(from), b=node(to), axis=Array.from(up), local=Array.from(offset);
      const rest=basis(a.rest,b.rest,axis), inverse=M.tr(rest);
      const origin=(a,b,rotation)=>V.add(V.lerp(a,b,at),M.app(rotation,local));
      const restOrigin=origin(a.rest,b.rest,rest);
      const fallback=V.norm(V.sub(b.rest,a.rest));
      function frame() {
        const p=position(a.index), q=position(b.index), rotation=basis(p,q,axis,fallback);
        return { point:origin(p,q,rotation), rotation };
      }
      return Object.freeze({ frame, matrix() {
        const posed=frame(), rotation=M.mul(posed.rotation,inverse);
        return [...rotation,...V.sub(posed.point,M.app(rotation,restOrigin))];
      } });
    }
    function curve(ids) {
      check(Array.isArray(ids) && ids.length>=2, 'a curve needs at least two joints');
      const indices=ids.map((id,i) => {
        if (i) edge(ids[i-1],id);
        return node(id).index;
      });
      return K.curveSplats.drivers.xpbd(solver,indices);
    }
    return Object.freeze({
      ids:Object.freeze([...nodes.keys()]),
      get time() { return ticks/hz; },
      point, attachment, curve,
      target(id, value) {
        check(node(id).drive && (value === undefined || vector(value)), 'target needs a driven joint and a finite point');
        if (value === undefined) overrides.delete(id);
        else overrides.set(id,Array.from(value));
      },
      step(dt) {
        check(Number.isFinite(dt) && dt >= 0 && dt <= 1, 'step takes up to one second of elapsed time');
        const elapsed=seconds+dt, next=Math.floor(elapsed*hz+1e-8);
        if (next>ticks) {
          const saved=solver.motion();
          try {
            for (let tick=ticks+1;tick<=next;tick++) solver.step(1/hz,tick/hz);
          } catch (error) {
            solver.restoreMotion(saved);
            throw error;
          }
        }
        ticks=next;
        seconds=elapsed;
        return ticks/hz;
      },
      reset() {
        overrides.clear();
        ticks=seconds=0;
        solver.resetPose(restPose);
      },
      contacts() {
        if (!field) return [];
        return [...nodes].filter(([id,{radius}])=>field.hit(point(id),ticks/hz,radius)).map(([id])=>id);
      }
    });
  }
  K.proceduralBody=Object.freeze({ create });
})(KIT);
