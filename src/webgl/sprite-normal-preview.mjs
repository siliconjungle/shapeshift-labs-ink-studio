export function previewSpriteNormals(rgba, normal, stride, rect, mode, azimuth = -45) {
  if (!normal || mode === 'color') return rgba;
  const angle = azimuth * Math.PI / 180;
  const x = Math.sin(angle) * .88, y = .475, z = Math.cos(angle) * .88;
  for (let row = 0; row < rect.height; row++) for (let column = 0; column < rect.width; column++) {
    const out = (row * rect.width + column) * 4;
    const at = ((rect.y + row) * stride + rect.x + column) * 4;
    if (!rgba[out + 3]) continue;
    if (mode === 'normal') {
      rgba.set(normal.subarray(at, at + 3), out);
      if (!normal[at + 3]) rgba[out + 3] = 0;
    } else if (normal[at + 3]) {
      const nx = normal[at] - 127.5, ny = normal[at + 1] - 127.5, nz = normal[at + 2] - 127.5;
      const diffuse = (nx * x + ny * y + nz * z) / Math.hypot(nx, ny, nz);
      const shade = diffuse > .62 ? 1.22 : diffuse > .24 ? .91 : .48;
      for (let c = 0; c < 3; c++) rgba[out + c] = Math.min(255, Math.round(rgba[out + c] * shade));
    }
  }
  return rgba;
}
