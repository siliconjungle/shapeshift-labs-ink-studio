const unitCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
const bounded = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

export function projectionHomography(corners) {
  if (!Array.isArray(corners) || corners.length !== 4 || !corners.every(p => Array.isArray(p) && p.length === 2 &&
      p.every(n => bounded(n, -2, 3))) || corners.some((a, i) => cross(a, corners[(i + 1) % 4], corners[(i + 2) % 4]) < 1e-5))
    throw new RangeError('Projection needs four convex corners in top-left, top-right, bottom-right, bottom-left order');
  const matrix = corners.flatMap(([x, y], i) => {
    const [u, v] = unitCorners[i];
    return [[x, y, 1, 0, 0, 0, -x * u, -y * u, u], [0, 0, 0, x, y, 1, -x * v, -y * v, v]];
  });
  for (let i = 0; i < 8; i++) {
    let largest = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[largest][i])) largest = j;
    [matrix[i], matrix[largest]] = [matrix[largest], matrix[i]];
    const diagonal = matrix[i][i];
    if (Math.abs(diagonal) < 1e-10) throw new RangeError('Projection corners are degenerate');
    for (let j = i; j <= 8; j++) matrix[i][j] /= diagonal;
    for (let row = 0; row < 8; row++) {
      if (row === i) continue;
      const factor = matrix[row][i];
      for (let j = i; j <= 8; j++) matrix[row][j] -= factor * matrix[i][j];
    }
  }
  return [...matrix.map(row => row[8]), 1];
}

export function projectionPoint(matrix, [x, y]) {
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / w, (matrix[3] * x + matrix[4] * y + matrix[5]) / w];
}

export function prepareProjectionSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length > 32) throw new RangeError('Projection takes up to 32 surfaces');
  const ids = new Set();
  return surfaces.map(({ id, source, corners, crop = [0, 0, 1, 1], edges = [0, 0, 0, 0], gain = 1, gamma = 1 }) => {
    if (typeof id !== 'string' || !id || ids.has(id) || typeof source !== 'string' || !source ||
        !Array.isArray(crop) || crop.length !== 4 || !crop.every(n => bounded(n, 0, 1)) ||
        crop[2] <= crop[0] || crop[3] <= crop[1] || !Array.isArray(edges) || edges.length !== 4 ||
        !edges.every(n => bounded(n, 0, 1)) || !bounded(gain, 0, 2) || !bounded(gamma, .2, 5))
      throw new TypeError('Invalid projection surface parameters');
    ids.add(id);
    const homography = projectionHomography(corners);
    return { id, source, corners: corners.map(p => [...p]), crop: [...crop], edges: [...edges], gain, gamma, homography };
  });
}

const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec3 rowX, rowY, rowW;
uniform vec2 resolution;
uniform vec4 crop, edges;
uniform float gain, gamma;
out vec4 color;
float edge(float distance, float width) {
  return width > 0.0 ? clamp(distance / width, 0.0, 1.0) : 1.0;
}
void main() {
  vec3 outputPoint = vec3(gl_FragCoord.x / resolution.x, 1.0 - gl_FragCoord.y / resolution.y, 1.0);
  float denominator = dot(rowW, outputPoint);
  if (abs(denominator) < 1e-5) discard;
  vec2 uv = vec2(dot(rowX, outputPoint), dot(rowY, outputPoint)) / denominator;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  float blend = edge(uv.x, edges.x) * edge(uv.y, edges.y) *
    edge(1.0 - uv.x, edges.z) * edge(1.0 - uv.y, edges.w);
  vec4 sampleColor = texture(image, mix(crop.xy, crop.zw, uv));
  color = vec4(sampleColor.rgb * (gain * pow(blend, gamma) * sampleColor.a), 1.0);
}`;

export function createProjectionMapper(canvas, definition = []) {
  let surfaces = prepareProjectionSurfaces(definition);
  const gl = canvas?.getContext?.('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('Projection mapping requires a WebGL 2 canvas');
  const textures = new Map(), shaders = [];
  const program = gl.createProgram();
  try {
    for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
  }
  const vao = gl.createVertexArray();
  const loc = Object.fromEntries(['image', 'rowX', 'rowY', 'rowW', 'resolution', 'crop', 'edges', 'gain', 'gamma']
    .map(name => [name, gl.getUniformLocation(program, name)]));
  let disposed = false;
  function texture(id) {
    if (textures.has(id)) return textures.get(id);
    const handle = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.set(id, handle);
    return handle;
  }
  return {
    setSurfaces(values) {
      if (disposed) throw new Error('Projection mapper is disposed');
      surfaces = prepareProjectionSurfaces(values);
      const active = new Set(surfaces.map(surface => surface.source));
      for (const [id, handle] of textures) if (!active.has(id)) {
        gl.deleteTexture(handle);
        textures.delete(id);
      }
    },
    render(sources) {
      if (disposed) throw new Error('Projection mapper is disposed');
      const uploaded = new Set();
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(loc.image, 0);
      gl.uniform2f(loc.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      for (const surface of surfaces) {
        const image = Object.hasOwn(sources, surface.source) ? sources[surface.source] : null;
        if (!image || image.readyState !== undefined && image.readyState < 2) continue;
        gl.bindTexture(gl.TEXTURE_2D, texture(surface.source));
        if (!uploaded.has(surface.source)) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          uploaded.add(surface.source);
        }
        const h = surface.homography;
        gl.uniform3f(loc.rowX, h[0], h[1], h[2]);
        gl.uniform3f(loc.rowY, h[3], h[4], h[5]);
        gl.uniform3f(loc.rowW, h[6], h[7], h[8]);
        gl.uniform4fv(loc.crop, surface.crop);
        gl.uniform4fv(loc.edges, surface.edges);
        gl.uniform1f(loc.gain, surface.gain);
        gl.uniform1f(loc.gamma, surface.gamma);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of textures.values()) gl.deleteTexture(handle);
      textures.clear();
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    }
  };
}
