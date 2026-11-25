// Authored shadow casters in a bound rig's rest coordinates. Each caster uses
// three inverse affine rows and two metadata vectors in the host shader.
const RigShadowProxies = (() => {
  const maxCasters = 8, stride = 20, V = KIT.V;

  function boundPart(rig, name, field) {
    // A bound rig's part() method declares missing names, so check first.
    const id = typeof name === 'string' && name.trim() && rig?.has?.(name) !== false ? rig?.part?.(name) : 0;
    if (!Number.isSafeInteger(id) || id <= 0 || (rig.M && id >= rig.M.length / 12))
      throw new RangeError('Unknown bound rig part in ' + field + ': ' + name);
    return id;
  }

  function vector(value, field, positive = false) {
    const xyz = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [];
    if (xyz.length !== 3 || !xyz.every(n => Number.isFinite(n) && Number.isFinite(Math.fround(n)) &&
      (!positive || Math.fround(n) > 0)))
      throw new TypeError(field + ' must be a ' + (positive ? 'positive ' : 'finite ') + 'XYZ vector');
    return xyz.map(Math.fround);
  }

  function prepare(rig, sun, parts) {
    const shadows = sun?.shadows;
    if (shadows === undefined || shadows === false) return null;
    if (shadows?.bake !== 'unshadowed')
      throw new TypeError('Proxy shadows require bake: "unshadowed" and receivers baked without a shadow march');
    const { casters, bias = 0.02 } = shadows;
    if (!Number.isFinite(bias) || bias < 0 || !Number.isFinite(Math.fround(bias)))
      throw new RangeError('Proxy shadow bias must be finite and nonnegative');
    if (!Array.isArray(casters) || !casters.length || casters.length > maxCasters)
      throw new RangeError('Proxy shadows need 1 to ' + maxCasters + ' authored casters');
    if (!rig?.M) throw new TypeError('Proxy shadows need a bound rig');
    const masks = new Uint8Array(rig.M.length / 12);
    const shapes = casters.map((caster, index) => {
      const part = boundPart(rig, caster?.part, 'shadow casters');
      if (!Array.isArray(caster.receivers) || !caster.receivers.length)
        throw new TypeError('Each shadow caster needs an explicit list of receivers');
      for (const name of caster.receivers) {
        const receiver = boundPart(rig, name, 'shadow receivers');
        if (!parts.has(receiver)) throw new RangeError('Shadow receiver must also be listed in sun.parts: ' + name);
        masks[receiver] |= 1 << index;
      }
      if (caster.type === 'box') return {
        part, type: 1, center: vector(caster.center, 'Box center'),
        shape: [...vector(caster.halfSize, 'Box halfSize', true), 0], feather: 0
      };
      if (caster.type !== 'capsule') throw new TypeError('Proxy shadow type must be box or capsule');
      const a = vector(caster.a, 'Capsule start'), b = vector(caster.b, 'Capsule end');
      const { radius, feather = 0 } = caster;
      if (!Number.isFinite(radius) || !Number.isFinite(Math.fround(radius)) || Math.fround(radius) <= 0 ||
          !Number.isFinite(feather) || feather < 0 || feather > radius)
        throw new RangeError('Capsule radius must be positive and feather must be between zero and radius');
      return { part, type: 2, center: a, shape: [...vector(V.sub(b, a), 'Capsule axis'), radius], feather };
    });
    return {
      rig,
      shapes,
      frame: { bias: Math.fround(bias), masks, uniforms: new Float32Array(maxCasters * stride) }
    };
  }

  function update(settings, matrices = settings.rig.M) {
    const { shapes, frame } = settings;
    const { uniforms } = frame;
    for (let i = 0; i < shapes.length; i++) {
      const { part, type, center, shape, feather } = shapes[i];
      const k = part * 12, j = i * stride;
      const x = [matrices[k], matrices[k + 3], matrices[k + 6]];
      const y = [matrices[k + 1], matrices[k + 4], matrices[k + 7]];
      const z = [matrices[k + 2], matrices[k + 5], matrices[k + 8]];
      const first = V.cross(y, z), det = V.dot(first, x);
      // A singular part has collapsed and cannot cast a volume shadow.
      uniforms[j + 16] = 0;
      if (!Number.isFinite(det) || det === 0) continue;
      const t = [matrices[k + 9], matrices[k + 10], matrices[k + 11]];
      const inverse = [first, V.cross(z, x), V.cross(x, y)];
      let valid = true;
      for (let row = 0; row < 3; row++) {
        const axis = V.mul(inverse[row], 1 / det);
        const offset = -V.dot(axis, t) - center[row];
        const p = j + row * 4;
        uniforms.set([...axis, offset], p);
        valid &&= uniforms.subarray(p, p + 4).every(Number.isFinite);
      }
      if (!valid) {
        uniforms.fill(0, j, j + 12);
        continue;
      }
      uniforms.set(shape, j + 12);
      uniforms[j + 16] = type;
      uniforms[j + 17] = feather;
    }
    return frame;
  }

  const epsilon = 1e-7;

  function boxVisibility(p, origin, d, size) {
    if (p.every((v, i) => Math.abs(v) <= size[i])) return 1;
    let near = 0, far = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) <= epsilon) {
        if (Math.abs(origin[i]) > size[i]) return 1;
        continue;
      }
      const a = (-size[i] - origin[i]) / d[i], b = (size[i] - origin[i]) / d[i];
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (far < near) return 1;
    }
    return 0;
  }

  function distanceToRaySquared(p, d) {
    const gap = V.mad(p, d, -Math.max(0, V.dot(p, d)));
    return V.dot(gap, gap);
  }

  function capsuleVisibility(p, origin, d, axis, radius, feather) {
    const length2 = V.dot(axis, axis);
    const closest = length2 > 0 ? clamp01(V.dot(p, axis) / length2) : 0;
    const gap = V.mad(p, axis, -closest);
    if (V.dot(gap, gap) <= radius * radius) return 1;

    // Minimize over both capsule endpoints, the ray origin, and the interior
    // point on the axis nearest the infinite ray line if it is in front.
    const end = V.sub(axis, origin), start = V.mul(origin, -1);
    let distance2 = Math.min(distanceToRaySquared(start, d), distanceToRaySquared(end, d));
    if (length2 > 0) {
      const atOrigin = V.mad(origin, axis, -clamp01(V.dot(origin, axis) / length2));
      distance2 = Math.min(distance2, V.dot(atOrigin, atOrigin));
      const across = V.mad(axis, d, -V.dot(axis, d)), across2 = V.dot(across, across);
      if (across2 > epsilon * epsilon * length2) {
        const at = clamp01(V.dot(origin, across) / across2);
        distance2 = Math.min(distance2, distanceToRaySquared(V.mad(start, axis, at), d));
      }
    }
    if (distance2 >= radius * radius) return 1;
    if (!feather) return 0;
    const edge = clamp01((Math.sqrt(distance2) - (radius - feather)) / feather);
    return edge * edge * (3 - 2 * edge);
  }

  function clamp01(n) {
    return Math.min(1, Math.max(0, n));
  }

  function visibility(frame, mask, position, normal, direction) {
    if (!mask || V.dot(normal, direction) <= 0) return 1;
    const u = frame.uniforms;
    let visible = 1;
    for (let i = 0; i < maxCasters; i++) {
      const j = i * stride, type = u[j + 16];
      if (!(mask & (1 << i)) || !type) continue;
      const local = (p, point) => [
        p[0] * u[j] + p[1] * u[j + 1] + p[2] * u[j + 2] + point * u[j + 3],
        p[0] * u[j + 4] + p[1] * u[j + 5] + p[2] * u[j + 6] + point * u[j + 7],
        p[0] * u[j + 8] + p[1] * u[j + 9] + p[2] * u[j + 10] + point * u[j + 11]
      ];
      const p = local(position, 1), origin = V.mad(p, local(normal, 0), frame.bias), ray = local(direction, 0);
      const length = V.len(ray);
      if (!length) continue;
      const d = V.mul(ray, 1 / length), shape = u.subarray(j + 12, j + 15);
      visible = Math.min(visible, type === 1 ? boxVisibility(p, origin, d, shape) :
        capsuleVisibility(p, origin, d, shape, u[j + 15], u[j + 17]));
      if (visible === 0) break;
    }
    return visible;
  }

  const glsl = `
uniform highp vec4 uCapturedProxies[${maxCasters * stride / 4}];
uniform highp float uCapturedProxyBias;

float capturedProxyBox(vec3 p, vec3 origin, vec3 d, vec3 size) {
  if (all(lessThanEqual(abs(p), size))) return 1.0;
  float near = 0.0, far = 3.4e38;
  for (int i = 0; i < 3; ++i) {
    if (abs(d[i]) <= 1e-7) {
      if (abs(origin[i]) > size[i]) return 1.0;
    } else {
      float a = (-size[i] - origin[i]) / d[i], b = (size[i] - origin[i]) / d[i];
      near = max(near, min(a, b));
      far = min(far, max(a, b));
      if (far < near) return 1.0;
    }
  }
  return 0.0;
}

float capturedProxyRayDistance2(vec3 p, vec3 d) {
  vec3 gap = p - d * max(0.0, dot(p, d));
  return dot(gap, gap);
}

float capturedProxyCapsule(vec3 p, vec3 origin, vec3 d, vec3 axis, float radius, float feather) {
  float length2 = dot(axis, axis);
  float closest = length2 > 0.0 ? clamp(dot(p, axis) / length2, 0.0, 1.0) : 0.0;
  vec3 gap = p - axis * closest;
  if (dot(gap, gap) <= radius * radius) return 1.0;

  vec3 start = -origin, end = axis - origin;
  float distance2 = min(capturedProxyRayDistance2(start, d), capturedProxyRayDistance2(end, d));
  if (length2 > 0.0) {
    vec3 atOrigin = origin - axis * clamp(dot(origin, axis) / length2, 0.0, 1.0);
    distance2 = min(distance2, dot(atOrigin, atOrigin));
    vec3 across = axis - d * dot(axis, d);
    float across2 = dot(across, across);
    if (across2 > 1e-14 * length2) {
      float at = clamp(dot(origin, across) / across2, 0.0, 1.0);
      distance2 = min(distance2, capturedProxyRayDistance2(start + axis * at, d));
    }
  }
  if (distance2 >= radius * radius) return 1.0;
  if (feather == 0.0) return 0.0;
  return smoothstep(radius - feather, radius, sqrt(distance2));
}

float capturedProxyVisibility(vec3 p, vec3 n, vec3 direction, highp uint mask) {
  if (mask == 0u || dot(n, direction) <= 0.0) return 1.0;
  float visible = 1.0;
  for (int i = 0; i < ${maxCasters}; ++i) {
    if ((mask & (1u << uint(i))) == 0u) continue;
    int j = i * ${stride / 4};
    vec2 flags = uCapturedProxies[j+4].xy;
    if (flags.x == 0.0) continue;
    vec4 x = uCapturedProxies[j], y = uCapturedProxies[j+1], z = uCapturedProxies[j+2];
    vec4 shape = uCapturedProxies[j+3];
    vec3 local = vec3(dot(x, vec4(p, 1.0)), dot(y, vec4(p, 1.0)), dot(z, vec4(p, 1.0)));
    vec3 o = local + uCapturedProxyBias * vec3(dot(x.xyz, n), dot(y.xyz, n), dot(z.xyz, n));
    vec3 d = normalize(vec3(dot(x.xyz, direction), dot(y.xyz, direction), dot(z.xyz, direction)));
    visible = min(visible, flags.x == 1.0 ? capturedProxyBox(local, o, d, shape.xyz)
      : capturedProxyCapsule(local, o, d, shape.xyz, shape.w, flags.y));
    if (visible == 0.0) break;
  }
  return visible;
}
`;

  return { boundPart, prepare, update, visibility, glsl };
})();
