/* Ordered screen-space passes and named image and mask dependencies. */
const RenderGraph = (() => {
  let stacks, luts, targets, compositor;
  try {
    stacks = ColorStack;
    luts = ColorLUT;
    targets = TargetSelectors;
    compositor = FrameComposite;
  } catch {
    stacks = require('./color-stack.js');
    luts = require('./color-lut.js');
    targets = require('./target-selectors.js');
    compositor = require('./frame-composite.js');
  }
  const operations = Object.freeze({ mask: 1, grade: 2, reflection: 3, distortion: 4, composite: 5, history: 6 });
  const fields = {
    mask: ['rect', 'feather', 'invert', 'volume'],
    grade: ['stack', 'cubeSize'],
    reflection: ['source', 'axis', 'line'],
    distortion: ['source', 'offset', 'amplitude', 'period', 'rate', 'phase'],
    composite: ['source', 'layer', 'blend'],
    history: ['mode', 'halfLife', 'cameraMotion']
  };
  const editorSnapshot = Symbol.for('ink-studio.renderGraph.snapshot');
  const compiled = new WeakMap(), cubes = new WeakMap();
  const maxHistoryPasses = 4, maxHistoryPixels = 8388608;
  const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const tuple = (value, len) => Array.isArray(value) && value.length === len && Array.from(value).every(Number.isFinite);
  const clamp = x => Math.min(1, Math.max(0, x));
  const byte = x => Math.round(x * 255);

  function record(value, keys, name) {
    if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid ' + name);
  }
  function finite(value, field) {
    if (!Number.isFinite(value)) throw new RangeError(field + ' must be finite');
    return value;
  }

  function prepare(value) {
    const readSnapshot = value?.[editorSnapshot];
    if (readSnapshot) value = readSnapshot();
    if (value === undefined || value === false) return null;
    if (compiled.has(value)) return compiled.get(value);
    record(value, ['passes', 'output'], 'render graph');
    if (!Array.isArray(value.passes) || value.passes.length > 32) throw new RangeError('A render graph needs up to 32 passes');
    const outputs = new Map([['scene', 'image']]), nodes = [];
    let current = 'scene';
    function reference(id, type) {
      if (outputs.get(id) !== type) throw new TypeError('Expected an earlier ' + type + ' output: ' + id);
      return id;
    }
    for (const pass of value.passes) {
      if (!Object.hasOwn(fields, pass?.type)) throw new TypeError('Unknown render graph pass: ' + pass?.type);
      const { id, type, enabled = true, opacity = 1 } = pass;
      record(pass, ['id', 'type', 'enabled', 'opacity', 'select', 'mask', ...(type === 'mask' ? [] : ['input']), ...fields[type]],
        'render graph ' + type + ' pass');
      if (typeof id !== 'string' || !id.trim() || outputs.has(id)) throw new TypeError('Render graph pass IDs must be distinct and nonempty');
      if (typeof enabled !== 'boolean' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
        throw new RangeError('A pass needs a boolean enabled flag and opacity in [0, 1]');
      const mask = pass.mask === undefined ? undefined : reference(pass.mask, 'mask');
      const select = pass.select === undefined ? undefined : targets.prepare(pass.select);
      const input = type === 'mask' ? undefined : reference(pass.input ?? current, 'image');
      const node = { id, type, operation: operations[type], enabled, opacity, select, mask, input };
      switch (type) {
        case 'mask': {
          const { rect, feather = 0, invert = false, volume } = pass;
          if ((rect !== undefined && (!tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0)) ||
              !Number.isFinite(feather) || feather < 0 || typeof invert !== 'boolean')
            throw new TypeError('A mask needs a positive rectangle, nonnegative feather and boolean invert');
          Object.assign(node, { rect: rect?.slice(), feather, invert });
          if (volume !== undefined) {
            record(volume, ['at', 'extent', 'feather'], 'world reveal volume');
            const { at, extent, feather = .25 } = volume;
            if (!tuple(at, 3) || !tuple(extent, 3) || extent.some(radius => radius <= 0) ||
                !Number.isFinite(feather) || feather < 0 || feather > 1)
              throw new RangeError('A world reveal needs a finite center, positive XYZ radii and a feather in [0, 1]');
            node.volume = { at: at.slice(), extent: extent.slice(), feather };
            node.needsCamera = true;
          }
          break;
        }
        case 'grade': {
          const { stack, cubeSize = 33 } = pass;
          if (!Number.isInteger(cubeSize) || cubeSize < 2 || cubeSize > 65)
            throw new RangeError('Grade cubeSize must be an integer in [2, 65]');
          if (!stacks.prepare(stack)) throw new TypeError('A grade pass needs an RGB color stack');
          Object.assign(node, { stack, cubeSize });
          break;
        }
        case 'reflection': {
          const { axis = 'y', line } = pass;
          if (axis !== 'x' && axis !== 'y') throw new TypeError('Reflection axis must be x or y');
          if (line !== undefined) finite(line, 'Reflection line');
          Object.assign(node, { axis, line, source: reference(pass.source ?? input, 'image') });
          break;
        }
        case 'distortion': {
          const { offset = [0, 0], amplitude = [0, 0], period = 32, rate = 0, phase = 0 } = pass;
          if (!tuple(offset, 2) || !tuple(amplitude, 2) || !Number.isFinite(period) || period <= 0)
            throw new RangeError('Distortion needs finite XY offset and amplitude and a positive period');
          Object.assign(node, { offset: offset.slice(), amplitude: amplitude.slice(), period,
            rate: finite(rate, 'Distortion rate'), phase: finite(phase, 'Distortion phase'), source: reference(pass.source ?? input, 'image') });
          break;
        }
        case 'history': {
          const { mode = 'persistence', halfLife = .45, cameraMotion = 'reset' } = pass;
          if (!select || !['hold', 'persistence'].includes(mode) || !['reset', 'keep'].includes(cameraMotion) ||
              !Number.isFinite(halfLife) || halfLife <= 0)
            throw new TypeError('Screen history needs a target selector, hold or persistence, a positive halfLife and a camera policy');
          Object.assign(node, { mode, halfLife, cameraMotion, needsCamera: cameraMotion === 'reset',
            historyKey: JSON.stringify([input, mask, Object.entries(select).sort(), mode, cameraMotion]) });
          break;
        }
        case 'composite': {
          if ((pass.layer === undefined) === (pass.source === undefined))
            throw new TypeError('A composite pass needs a previous image source or one mixed-resolution layer');
          if (pass.layer !== undefined) {
            if (pass.blend !== undefined) throw new TypeError('Set layer blending on the layer');
            node.needsCamera = compositor.settings({ layers: [pass.layer] }).needsCamera;
            node.layer = pass.layer;
          } else {
            const { blend = 'over' } = pass;
            if (blend !== 'over' && blend !== 'add') throw new TypeError('Composite blend must be over or add');
            Object.assign(node, { source: reference(pass.source, 'image'), blend });
          }
          break;
        }
      }
      node.dependencies = [...new Set(node.enabled ? [input, mask, node.source].filter(Boolean) : [input].filter(Boolean))];
      outputs.set(id, type === 'mask' ? 'mask' : 'image');
      if (type !== 'mask') current = id;
      nodes.push(node);
    }
    const output = reference(value.output ?? current, 'image'), live = new Set([output]);
    for (let i = nodes.length - 1; i >= 0; i--) if (live.has(nodes[i].id))
      for (const dependency of nodes[i].dependencies) live.add(dependency);
    const passes = nodes.filter(node => live.has(node.id)), lastUse = new Map();
    passes.forEach((node, i) => node.dependencies.forEach(id => lastUse.set(id, i)));
    const historyPasses = passes.filter(node => node.enabled && node.type === 'history');
    if (historyPasses.length > maxHistoryPasses) throw new RangeError('A graph supports up to four live screen history passes');
    const plan = { passes, output, lastUse, historyPasses, needsDepth: passes.some(node => node.enabled && node.volume),
      needsOwner: passes.some(node => node.enabled && node.select),
      needsCamera: passes.some(node => node.enabled && node.needsCamera) };
    if (readSnapshot) compiled.set(value, plan);
    return plan;
  }

  function snapshot(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
    if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])));
    return value;
  }

  function create(value) {
    let definition;
    function save(value) {
      const next = snapshot(value), plan = prepare(next);
      if (!plan) throw new TypeError('An editable render graph needs a definition');
      compiled.set(next, plan);
      definition = next;
    }
    const position = id => {
      const index = definition.passes.findIndex(pass => pass.id === id);
      if (index < 0) throw new RangeError('Unknown render graph pass: ' + id);
      return index;
    };
    function edit(change) {
      const passes = [...definition.passes];
      change(passes);
      save({ ...definition, passes });
    }
    save(value);
    const current = () => definition;
    return Object.freeze({
      [editorSnapshot]: current,
      snapshot: current,
      replace: save,
      update(id, changes) { edit(passes => { const i = position(id); passes[i] = { ...passes[i], ...changes }; }); },
      move(id, index) {
        if (!Number.isInteger(index) || index < 0 || index >= definition.passes.length) throw new RangeError('Invalid pass position');
        edit(passes => { const [pass] = passes.splice(position(id), 1); passes.splice(index, 0, pass); });
      },
      insert(pass, index = definition.passes.length) {
        if (!Number.isInteger(index) || index < 0 || index > definition.passes.length) throw new RangeError('Invalid pass position');
        edit(passes => passes.splice(index, 0, pass));
      },
      remove(id) { edit(passes => passes.splice(position(id), 1)); }
    });
  }

  function cube({ stack, cubeSize: size }) {
    let cache = cubes.get(stack);
    const key = JSON.stringify(stack);
    if (cache?.key !== key) cubes.set(stack, cache = { key, sizes: new Map() });
    if (!cache.sizes.has(size)) {
      const transform = stacks.prepare(stack), samples = [], data = new Uint8Array(size ** 3 * 4), rgb = [0, 0, 0];
      for (let b = 0, i = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++, i += 4) {
        transform.sample([r / (size - 1), g / (size - 1), b / (size - 1)], rgb);
        for (let c = 0; c < 3; c++) {
          const value = byte(clamp(rgb[c]));
          samples.push(value / 255);
          data[i + c] = value;
        }
        data[i + 3] = 255;
      }
      cache.sizes.set(size, { size, data, sample: luts.prepare(luts.normalize({ size, interpolation: 'trilinear', data: samples }, true)).sample });
    }
    return cache.sizes.get(size);
  }

  function selection(world, select) {
    const data = new Uint8Array(world.count + 1), index = targets.index(world), found = new Map();
    for (let i = 0; i < world.count; i++) {
      const target = index.row(i);
      if (!found.has(target)) found.set(target, targets.matches(select, target) ? 255 : 0);
      data[i + 1] = found.get(target);
    }
    return data;
  }

  function layer(node, w, h, world, time, text, camera, resolve, gl) {
    const plan = compositor.prepare({ layers: [node.layer] }, w, h);
    return compositor.layers(plan, world, time, text, camera, resolve, gl)[0];
  }

  function history({ release = () => {} } = {}) {
    const entries = new Map();
    let previousFrame;
    function drop(id) {
      const entry = entries.get(id);
      entries.delete(id);
      if (entry) release(entry.value);
    }
    function clear() {
      for (const id of entries.keys()) drop(id);
      previousFrame = undefined;
    }
    function begin(plan, { source, w, h, time, camera, reset } = {}) {
      if (!plan?.historyPasses.length) {
        clear();
        return;
      }
      if (!Number.isFinite(time)) throw new RangeError('Screen history needs a finite frame time');
      if (w * h * plan.historyPasses.length > maxHistoryPixels) throw new RangeError('Screen history exceeds its pixel budget');
      const signature = camera && [...camera.view, camera.tangent, camera.aspect, +camera.ortho, ...camera.depthRange];
      const before = previousFrame;
      if (reset || !before || before.source !== source || before.w !== w || before.h !== h || before.time > time) clear();
      const still = signature && before?.signature && signature.every((value, i) => Math.abs(value - before.signature[i]) < 1e-5);
      const active = new Map(plan.historyPasses.map(node => [node.id, node]));
      for (const [id, entry] of entries) {
        const node = active.get(id);
        if (!node || node.historyKey !== entry.key || node.cameraMotion === 'reset' && !still) drop(id);
      }
      previousFrame = { source, w, h, time, signature };
      return node => {
        const prior = entries.get(node.id);
        return {
          value: prior?.value,
          capture: !prior || prior.time < time,
          decay: prior ? 2 ** (-(time - prior.time) / node.halfLife) : 0,
          save(value) {
            drop(node.id);
            entries.set(node.id, { key: node.historyKey, time, value });
          }
        };
      };
    }
    return Object.freeze({ begin, clear });
  }

  // Depth is the axial camera distance at the center of the native texel.
  function volumeCoverage(volume, camera, u, v, depth) {
    if (!Number.isFinite(depth)) return 0;
    const view = camera.view, scale = camera.tangent * (camera.ortho ? 1 : depth);
    const x = (2 * u - 1) * scale * camera.aspect, y = (1 - 2 * v) * scale;
    const [a, b, c] = volume.at, [rx, ry, rz] = volume.extent, eye = camera.eye;
    const distance = Math.hypot(
      (eye[0] + x * view[0] + y * view[1] - depth * view[2] - a) / rx,
      (eye[1] + x * view[4] + y * view[5] - depth * view[6] - b) / ry,
      (eye[2] + x * view[8] + y * view[9] - depth * view[10] - c) / rz);
    return volume.feather ? clamp((1 - distance) / volume.feather) : Number(distance <= 1);
  }

  return Object.freeze({ prepare, create, cube, selection, layer, history, volumeCoverage });
})();
if (typeof module !== 'undefined') module.exports = RenderGraph;
