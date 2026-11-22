struct Settings {
  controls: vec4f,
  position: vec4f,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var result: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> settings: Settings;

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) p: vec3u) {
  let dimensions = textureDimensions(source);
  if (any(p.xy >= dimensions)) { return; }

  // This patch maps the spillway's world XZ bounds onto the canvas.
  let uv = (vec2f(p.xy) + 0.5) / vec2f(dimensions);
  let xz = (uv - 0.5) * vec2f(7.6, 4.6);
  let world = settings.position.xz;
  let value = textureLoad(source, vec2i(p.xy), 0);
  let grid = abs(fract(xz * 2.0 + 0.5) - 0.5);
  let gridline = 1.0 - smoothstep(0.012, 0.035, min(grid.x, grid.y));
  let base = value.rgb + vec3f(0.06, 0.09, 0.12) * gridline;
  let d = distance(xz, world);
  let amount = settings.controls.y;
  let tint = select(vec3f(1.0, 0.57, 0.26), vec3f(0.24, 0.90, 0.99), world.x > 0.0);
  let radius = 0.38 + 0.48 * amount;
  let ring = 1.0 - smoothstep(0.025, 0.065, abs(d - radius));
  let ripple = 1.0 - smoothstep(0.015, 0.045, abs(d - radius - fract(settings.controls.x * 1.5) * 0.38));
  let fill = exp(-3.8 * d * d);
  let marker = 1.0 - smoothstep(0.038, 0.066, d);
  textureStore(result, vec2i(p.xy), vec4f(base + tint * amount * (ring + 0.35 * ripple + 0.45 * fill + marker), 1.0));
}
