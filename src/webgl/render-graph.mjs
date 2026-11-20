import { layerSamplingGLSL, captureFrameCamera } from './frame-composite.mjs';
import { inspectionDepth } from './inspection.mjs';

export const graphOwner = Symbol('render graph owner capture');

const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_input, u_source, u_mask, u_owner, u_selected, u_depth, u_history;
uniform highp sampler3D u_cube;
uniform vec2 u_size, u_offset, u_amplitude;
uniform int u_operation;
uniform bool u_hasMask, u_hasSelect, u_hasRect, u_invert, u_layer, u_linear, u_add, u_enabled;
uniform float u_opacity, u_feather, u_line, u_frequency, u_phase, u_cubeSize;
uniform bool u_reflectX;
uniform vec4 u_rect, u_layerDest;
uniform ivec4 u_layerRegion;
uniform bool u_layerTopDown;
uniform vec3 u_volumeAt, u_extent, u_eye;
uniform vec2 u_depthRange, u_projectionScale;
uniform mat4 u_view;
uniform bool u_volume, u_ortho, u_captureHistory, u_hasHistory, u_hold;
uniform float u_volumeFeather, u_decay;
out vec4 color;

${layerSamplingGLSL}

void main() {
  ivec2 pos = ivec2(gl_FragCoord.xy);
  vec4 inputColor = texelFetch(u_input, pos, 0);
  if (u_operation == 0) { color = inputColor; return; }
  vec2 pixel = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  float weight = u_hasMask ? texelFetch(u_mask, pos, 0).r : 1.0;
  float chosen = 1.0;
  if (u_hasSelect) {
    vec3 encoded = layerAt(u_owner, pixel, u_size, false, false).rgb;
    ivec3 bytes = ivec3(floor(encoded * 255.0 + 0.5));
    int id = bytes.r + bytes.g * 256 + bytes.b * 65536;
    int rowWidth = textureSize(u_selected, 0).x;
    chosen = texelFetch(u_selected, ivec2(id % rowWidth, id / rowWidth), 0).r;
    weight *= chosen;
  }
  if (u_operation == 1) {
    if (u_volume) {
      ivec2 size = textureSize(u_depth, 0);
      ivec2 site = min(ivec2(pixel / u_size * vec2(size)), size - 1);
      float norm = texelFetch(u_depth, ivec2(site.x, size.y - 1 - site.y), 0).r;
      if (norm >= 1.0) weight = 0.0;
      else {
        float depth = mix(u_depthRange.x, u_depthRange.y, norm);
        vec2 uv = (vec2(site) + .5) / vec2(size);
        vec2 plane = (uv * vec2(2.0, -2.0) + vec2(-1.0, 1.0)) * u_projectionScale;
        vec3 local = vec3(plane * (u_ortho ? 1.0 : depth), -depth);
        vec3 position = u_eye + vec3(dot(u_view[0].xyz, local), dot(u_view[1].xyz, local), dot(u_view[2].xyz, local));
        float d = length((position - u_volumeAt) / u_extent);
        weight *= u_volumeFeather > 0.0 ? clamp((1.0 - d) / u_volumeFeather, 0.0, 1.0) : step(d, 1.0);
      }
    }
    if (u_hasRect) {
      vec2 edges = min(pixel - u_rect.xy, u_rect.xy + u_rect.zw - pixel);
      float edge = min(edges.x, edges.y);
      weight *= u_feather > 0.0 ? clamp(edge / u_feather, 0.0, 1.0) : step(0.0, edge);
    }
    color = vec4(u_enabled ? (u_invert ? 1.0 - weight : weight) * u_opacity : 0.0);
    return;
  }
  if (u_operation == 6) {
    vec4 previous = u_hasHistory ? texelFetch(u_history, pos, 0) : vec4(0.0);
    if (u_captureHistory) {
      vec4 fresh = inputColor * weight;
      color = u_hold && previous.a > 0.0 ? previous :
        min(vec4(1.0), fresh + floor(previous * u_decay * (1.0 - fresh.a) * 255.0 + .00001) / 255.0);
    } else {
      vec4 sampleColor = previous * (chosen * u_opacity);
      color = sampleColor + inputColor * (1.0 - sampleColor.a);
    }
    return;
  }
  weight *= u_opacity;
  color = inputColor;
  if (weight <= 0.0) return;
  if (u_operation == 2) {
    if (inputColor.a <= 0.0) return;
    vec3 lookup = (clamp(inputColor.rgb / inputColor.a, 0.0, 1.0) * (u_cubeSize - 1.0) + 0.5) / u_cubeSize;
    color.rgb = mix(inputColor.rgb, texture(u_cube, lookup).rgb * inputColor.a, weight);
  } else if (u_operation == 5) {
    vec4 over = u_layer ? placedLayerAt(u_source, pixel, u_layerDest, u_layerRegion, u_layerTopDown, u_linear) : texelFetch(u_source, pos, 0);
    over *= weight;
    color.a = over.a + inputColor.a * (1.0 - over.a);
    color.rgb = min(vec3(color.a), over.rgb + inputColor.rgb * (u_add ? 1.0 : 1.0 - over.a));
  } else {
    vec2 sourcePixel = pixel;
    if (u_operation == 3) {
      if (u_reflectX) sourcePixel.x = 2.0 * u_line - sourcePixel.x;
      else sourcePixel.y = 2.0 * u_line - sourcePixel.y;
    } else sourcePixel += u_offset + u_amplitude * sin(pixel.yx * u_frequency + u_phase);
    if (all(greaterThanEqual(sourcePixel, vec2(0.0))) && all(lessThan(sourcePixel, u_size)))
      color = mix(inputColor, layerAt(u_source, sourcePixel, u_size, false, false), weight);
  }
}`;

export function createRenderGraph(gl, { api, program, resources, target, textureUnit, fullscreen, maxSize }) {
  const shader = program(fragment), scene = target();
  const selected = resources.texture(), raster = resources.texture(), cube = resources.allocate('Texture');
  const pool = [], historyFree = [];
  const history = api.history({ release: buffer => historyFree.push(buffer) });
  let lastCube;
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_3D, cube);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.activeTexture(gl.TEXTURE0);

  function execute(world, frame, plan, w, h, destination, present) {
    scene.resize(w, h);
    let ownership, camera, depth;
    present(world, { ...frame, ...(plan.needsCamera && captureFrameCamera(frame, view => { camera = view; })),
      ...(plan.needsDepth && { [inspectionDepth](scene, texture, view) {
        depth = texture;
        frame[inspectionDepth]?.(scene, texture, view);
      } }),
      [graphOwner]: plan.needsOwner ? (world, texture) => { ownership = { world, texture }; } : undefined },
      w, h, scene.framebuffer);
    if (!destination) {
      if (gl.canvas.width !== w) gl.canvas.width = w;
      if (gl.canvas.height !== h) gl.canvas.height = h;
    }
    for (const test of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(test);
    gl.colorMask(true, true, true, true);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_3D, cube);
    const outputs = new Map([['scene', scene]]), free = pool.slice(), selections = new Map();
    const time = frame.time ?? world.lookSnapshot?.time ?? 0;
    const openHistory = history.begin(plan, { source: frame.renderHistoryKey ?? world,
      w, h, time, camera, reset: frame.resetRenderHistory });
    let lastSelect;
    for (const [index, node] of plan.passes.entries()) {
      const input = outputs.get(node.input) ?? scene;
      if ((!node.enabled || node.type === 'history' && !ownership) && node.type !== 'mask') outputs.set(node.id, input);
      else {
        const out = free.pop() ?? target();
        if (!pool.includes(out)) pool.push(out);
        out.resize(w, h);
        const mask = outputs.get(node.mask), table = node.type === 'grade' && api.cube(node);
        const layer = node.layer && api.layer(node, w, h, world, time, camera, gl);
        const select = node.enabled && ownership && node.select && JSON.stringify(node.select);
        const opacity = node.opacity * (node.layer ? layer?.opacity ?? 0 : 1);
        if (layer?.gpu) textureUnit(1, layer.gpu.texture);
        else if (layer) {
          if (layer.w > maxSize || layer.h > maxSize) throw new RangeError('Render graph layer exceeds the WebGL texture size limit');
          textureUnit(1, raster);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, layer.w, layer.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, layer.data);
        } else textureUnit(1, (outputs.get(node.source) ?? scene).textures[0]);
        if (table && table !== lastCube) {
          gl.activeTexture(gl.TEXTURE4);
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, table.size, table.size, table.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, table.data);
          lastCube = table;
        }
        if (select && select !== lastSelect) {
          if (!selections.has(select)) {
            const rows = api.selection(ownership.world, node.select), width = Math.min(2048, maxSize);
            const height = Math.ceil(rows.length / width), data = new Uint8Array(width * height);
            data.set(rows);
            selections.set(select, { width, height, data });
          }
          const { width, height, data } = selections.get(select);
          textureUnit(5, selected);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
          lastSelect = select;
        }
        textureUnit(0, input.textures[0]);
        textureUnit(2, (mask ?? scene).textures[0]);
        textureUnit(3, ownership?.texture ?? scene.textures[0]);
        textureUnit(5, select ? selected : scene.textures[0]);
        textureUnit(6, depth ?? scene.textures[0]);
        const values = {
          u_input: 0, u_source: 1, u_mask: 2, u_owner: 3, u_cube: 4, u_selected: 5, u_size: [w, h],
          u_operation: node.operation, u_opacity: opacity, u_enabled: node.enabled, u_hasMask: Boolean(mask),
          u_hasSelect: Boolean(select), u_hasRect: Boolean(node.rect),
          ...(node.rect && { u_rect: node.rect, u_feather: node.feather }),
          u_invert: node.invert ?? false, u_cubeSize: table?.size ?? 1,
          u_depth: 6, u_history: 7, u_volume: Boolean(node.volume && depth && camera),
          ...(node.volume && depth && camera && { u_volumeAt: node.volume.at, u_extent: node.volume.extent,
            u_volumeFeather: node.volume.feather, u_eye: camera.eye, u_view: camera.view,
            u_depthRange: camera.depthRange, u_projectionScale: [camera.tangent * camera.aspect, camera.tangent],
            u_ortho: camera.ortho }),
          u_layer: Boolean(layer), ...(layer && { u_layerDest: layer.dest, u_layerTopDown: !layer.gpu,
            u_layerRegion: layer.gpu?.region ?? [0, 0, layer.w, layer.h] }), u_linear: layer?.filter === 'linear', u_add: (layer?.blend ?? node.blend) === 'add',
          u_reflectX: node.axis === 'x', u_line: node.line ?? (node.axis === 'x' ? w : h) * .5,
          ...(node.offset && { u_offset: node.offset, u_amplitude: node.amplitude, u_frequency: 2 * Math.PI / node.period,
            u_phase: 2 * Math.PI * ((node.phase + time * node.rate) % 1) })
        };
        if (node.type === 'history') {
          const memory = openHistory(node);
          let stamp = memory.value;
          if (memory.capture) {
            // Target allocation binds a texture on the active unit.
            gl.activeTexture(gl.TEXTURE0);
            stamp = historyFree.pop() ?? target();
            stamp.resize(w, h);
            // Resizing rebinds texture unit zero.
            textureUnit(0, input.textures[0]);
            textureUnit(7, memory.value?.textures[0] ?? scene.textures[0]);
            fullscreen(shader, stamp.framebuffer, w, h, { ...values, u_captureHistory: true,
              u_hasHistory: Boolean(memory.value), u_hold: node.mode === 'hold',
              u_decay: node.mode === 'persistence' ? memory.decay : 0 });
            memory.save(stamp);
          }
          textureUnit(7, stamp.textures[0]);
          fullscreen(shader, out.framebuffer, w, h, { ...values, u_captureHistory: false, u_hasHistory: true });
        } else {
          textureUnit(7, scene.textures[0]);
          fullscreen(shader, out.framebuffer, w, h, values);
        }
        outputs.set(node.id, out);
      }
      for (const id of node.dependencies) if (plan.lastUse.get(id) === index) {
        const used = outputs.get(id);
        outputs.delete(id);
        if (used !== scene && ![...outputs.values()].includes(used)) free.push(used);
      }
    }
    textureUnit(0, outputs.get(plan.output).textures[0]);
    fullscreen(shader, destination, w, h, { u_operation: 0 });
  }
  return Object.assign(execute, { reset: history.clear });
}
