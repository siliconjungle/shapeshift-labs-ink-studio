/* Offscreen WebGL comparison on the requested native art grid. */
const DisplacementRenderer = (() => {
  const modes = ['flat', 'parallax', 'relief'];
  const clips = [.08, 180];
  const degrees = n => n * Math.PI / 180;
  const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  function heights(value) {
    const packed = bytes(value), view = new DataView(packed.buffer);
    return Float32Array.from({ length: packed.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
  }

  function projection({ fov, distance, projection }, ratio) {
    const y = 1 / Math.tan(degrees(fov) * .5), x = y / ratio, [near, far] = clips, span = far - near;
    if (projection === 'orthographic')
      return [x / distance,0,0,0, 0,y / distance,0,0, 0,0,-2 / span,0, 0,0,-(far + near) / span,1];
    return [x,0,0,0, 0,y,0,0, 0,0,-(far + near) / span,-1, 0,0,-2 * far * near / span,0];
  }

  function create(data) {
    const { width, height } = data.view;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
    if (!gl) throw new Error('This displacement preview needs a WebGL 2 context');
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, DisplacementShaders.vertex], [gl.FRAGMENT_SHADER, DisplacementShaders.fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const uniforms = Object.fromEntries(['Height', 'Color', 'Normal', 'Shape', 'Displacement', 'Seam', 'SeamWidth',
      'Tiles', 'Mode', 'View', 'Projection', 'HasNormal', 'HasColor', 'Camera', 'Back', 'Ortho', 'Steps', 'Tangent',
      'HeightRange', 'Clips'].map(name => [name, gl.getUniformLocation(program, 'u' + name)]));

    function texture({ width, height }, internal, format, type, samples) {
      const value = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, value);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, samples);
      return value;
    }
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const attached = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1];
    for (const target of attached) {
      const layer = texture(data.view, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, target, gl.TEXTURE_2D, layer, 0);
    }
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.drawBuffers(attached);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('The displacement comparison framebuffer is incomplete');

    const maps = [
      ['Height', data.maps.height, gl.R32F, gl.RED, gl.FLOAT, heights(data.maps.height.data)],
      ['Color', data.maps.baseColor, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE,
        data.maps.baseColor ? bytes(data.maps.baseColor.data) : Uint8Array.of(211, 172, 129, 255)],
      ['Normal', data.maps.normal, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE,
        data.maps.normal ? bytes(data.maps.normal.data) : Uint8Array.of(128, 128, 255, 255)]
    ];
    for (const [index, [name, extent, internal, rgba, type, values]] of maps.entries()) {
      gl.activeTexture(gl.TEXTURE0 + index);
      texture(extent ?? { width: 1, height: 1 }, internal, rgba, type, values);
      gl.uniform1i(uniforms[name], index);
    }
    gl.uniform1i(uniforms.HasColor, data.maps.baseColor ? 1 : 0);
    gl.uniform1i(uniforms.HasNormal, data.maps.normal ? 1 : 0);
    gl.uniform2fv(uniforms.Shape, data.settings.tileSize);
    gl.uniform2fv(uniforms.Clips, clips);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);    gl.depthFunc(gl.LESS);
    gl.clearColor(0, 0, 0, 0);

    const cache = new Map();
    function grid(segments) {
      const key = segments.join(',');
      if (cache.has(key)) return cache.get(key);
      const row = TexturedSurface.grid({ segments, point: (u, v) => [u, v, 0] });
      const vao = gl.createVertexArray(), uv = gl.createBuffer(), index = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, uv);
      gl.bufferData(gl.ARRAY_BUFFER, row.uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, row.triangles, gl.STATIC_DRAW);
      const value = { vao, uv, index, count: row.triangles.length };
      cache.set(key, value);
      if (cache.size > 5) {
        const [old, entry] = cache.entries().next().value;
        gl.deleteVertexArray(entry.vao);
        gl.deleteBuffer(entry.uv);
        gl.deleteBuffer(entry.index);
        cache.delete(old);
      }
      return value;
    }

    const pixels = () => new Uint8Array(width * height * 4);
    function buffer(attachment) {
      const data = pixels();
      gl.readBuffer(attachment);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    }

    function render(camera, mode, settings, segments = settings.tessellation) {
      const pose = CameraLens.orbitPose(degrees(camera.yaw), degrees(camera.pitch), camera.distance, [0, 0, 0]);
      const depth = [data.maps.height.min, data.maps.height.max].map(n => (n - settings.bias) * settings.scale);
      const tiles = settings.repeats[0] * settings.repeats[1], mesh = grid(mode === 'relief' ? segments : [1, 1]);
      gl.bindVertexArray(mesh.vao);
      gl.uniformMatrix4fv(uniforms.View, false, CameraLens.matrix(pose));
      gl.uniformMatrix4fv(uniforms.Projection, false, projection(camera, width / height));
      gl.uniform3fv(uniforms.Camera, pose.eye);
      gl.uniform3fv(uniforms.Back, pose.back);
      gl.uniform1i(uniforms.Ortho, camera.projection === 'orthographic' ? 1 : 0);
      gl.uniform1i(uniforms.Mode, modes.indexOf(mode));
      gl.uniform1i(uniforms.Steps, settings.steps);
      gl.uniform1i(uniforms.Seam, ['clamp', 'repeat', 'fade'].indexOf(settings.seam));
      gl.uniform1i(uniforms.Tangent, settings.tangent === 'directx' ? -1 : 1);
      gl.uniform1f(uniforms.SeamWidth, settings.seamWidth);
      gl.uniform2iv(uniforms.Tiles, settings.repeats);
      gl.uniform2f(uniforms.Displacement, settings.scale, settings.bias);
      gl.uniform2f(uniforms.HeightRange, Math.min(0, ...depth), Math.max(0, ...depth));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0, tiles);
      return { rgba: buffer(attached[0]), depth: buffer(attached[1]), triangles: mesh.count / 3 * tiles };
    }
    return { render, width, height };
  }

  const depthAt = (array, i) => clips[0] +
    (array[i] * 65536 + array[i + 1] * 256 + array[i + 2]) / 16777215 * (clips[1] - clips[0]);

  function metrics(ref, result) {
    let profile = 0, square = 0, overlap = 0, referencePixels = 0, candidatePixels = 0, maxDepthError = 0;
    for (let i = 0; i < ref.rgba.length; i += 4) {
      const a = ref.rgba[i + 3] > 0, b = result.rgba[i + 3] > 0;
      if (a) referencePixels++;
      if (b) candidatePixels++;
      if (a !== b) profile++;
      if (!(a && b)) continue;
      for (let c = 0; c < 3; c++) square += (ref.rgba[i + c] - result.rgba[i + c]) ** 2;
      maxDepthError = Math.max(maxDepthError, Math.abs(depthAt(ref.depth, i) - depthAt(result.depth, i)));
      overlap++;
    }
    return { profile, profileFraction: profile / Math.max(1, referencePixels + candidatePixels - overlap),
      referencePixels, candidatePixels, overlap, colorRmse: overlap ? Math.sqrt(square / (3 * overlap)) : null,
      maxDepthError: overlap ? maxDepthError : null, triangles: result.triangles };
  }

  function compare(renderer, camera, settings, tolerance) {
    const frames = Object.fromEntries(modes.map(mode => [mode, renderer.render(camera, mode, settings)]));
    const segments = settings.reference.map((n, i) => Math.max(n, settings.tessellation[i]));
    const same = segments.every((n, i) => n === settings.tessellation[i]);
    const reference = same ? frames.relief : renderer.render(camera, 'relief', settings, segments);
    const scores = Object.fromEntries(modes.map(mode => [mode, metrics(reference, frames[mode])]));
    const pass = row => row.overlap && row.profile <= tolerance.profilePixels &&
      row.profileFraction <= tolerance.profileFraction && row.colorRmse <= tolerance.colorRmse;
    const choice = scores.relief.referencePixels === 0 ? 'outside' : modes.find(mode => pass(scores[mode])) ?? 'tessellation';
    return { frames, reference, scores, choice, segments };
  }

  function paint(canvas, frame, reference, kind, sharedDepth = [.08, 180]) {
    const { width, height } = canvas;
    const engine = canvas.getContext('2d'), image = engine.createImageData(width, height);
    for (let row = 0; row < height; row++) {
      const from = (height - 1 - row) * width * 4, to = row * width * 4;
      if (kind === 'color') {
        image.data.set(frame.rgba.subarray(from, from + width * 4), to);
        continue;
      }
      for (let x = 0; x < width; x++) {
        const i = from + x * 4, o = to + x * 4;
        if (kind === 'depth') {
          if (!frame.depth[i + 3]) continue;
          const n = 1 - Math.min(1, Math.max(0, (depthAt(frame.depth, i) - sharedDepth[0]) /
            Math.max(.0001, sharedDepth[1] - sharedDepth[0])));
          image.data.set([45 + 195 * n, 45 + 161 * n, 77 + 45 * n, 255], o);
        } else {
          const a = reference.rgba[i + 3], b = frame.rgba[i + 3];
          if (a !== b) image.data.set(a ? [255,169,87,255] : [95,222,216,255], o);
          else if (a) {
            const delta = Math.max(...[0, 1, 2].map(k => Math.abs(reference.rgba[i + k] - frame.rgba[i + k])));
            image.data.set([42 + 2.0 * delta, 40 + .76 * delta, 54 + .35 * delta, 255], o);
          }
        }
      }
    }
    engine.putImageData(image, 0, 0);
  }

  function depthSpan(frames) {
    let low = Infinity, high = -Infinity;
    for (const { depth } of Object.values(frames)) for (let i = 0; i < depth.length; i += 4) {
      if (!depth[i + 3]) continue;
      const value = depthAt(depth, i);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    return [low, high];
  }

  return { create, compare, paint, depthSpan };
})();
