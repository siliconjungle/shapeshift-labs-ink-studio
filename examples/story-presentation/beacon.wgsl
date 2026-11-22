struct Settings {
  controls: vec4f,
  position: vec4f,
}

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var result: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> settings: Settings;

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) p: vec3u) {
  let size = textureDimensions(source);
  if (any(p.xy >= size)) { return; }
  let uv = (vec2f(p.xy) + 0.5) / vec2f(size);
  let pixel = textureLoad(source, vec2i(p.xy), 0);
  let luminance = dot(pixel.rgb, vec3f(0.2126, 0.7152, 0.0722));
  let base = mix(pixel.rgb, vec3f(0.21, 0.48, 0.84) * luminance + vec3f(0.028, 0.005, 0.08), 0.56);
  let d = distance(vec2f(1.6, 1.0) * (uv - vec2f(0.52 + settings.position.x * 0.08, 0.42)), vec2f(0.0));
  let radius = 0.13 + 0.24 * fract(settings.controls.x * 0.72);
  let ring = 1.0 - smoothstep(0.008, 0.04, abs(d - radius));
  let glow = exp(-10.0 * d);
  let beam = vec3f(0.46, 0.92, 0.88) * settings.controls.y * (0.65 * ring + 0.8 * glow);
  textureStore(result, vec2i(p.xy), vec4f(base + beam, pixel.a));
}
