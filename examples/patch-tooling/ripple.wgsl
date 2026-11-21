@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var image: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> controls: vec4f;

@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(frame);
  if (any(id.xy >= size)) { return; }
  let pixel = vec2i(id.xy);
  let beat = controls.y;
  let offset = i32((1.0 + 7.0*beat) * sin(f32(id.y)*.19 + controls.x*5.5));
  let last = vec2i(size)-1;
  let clean = textureLoad(frame,pixel,0);
  let left = textureLoad(frame,clamp(pixel - vec2i(offset,0),vec2i(0),last),0);
  let right = textureLoad(frame,clamp(pixel + vec2i(offset,0),vec2i(0),last),0);
  let drift = vec3f(left.r,right.g,left.b);
  let tone = mix(clean.rgb,drift,.22 + .48*beat);
  let glow = max(0.0, max(tone.r,max(tone.g,tone.b))-.33);
  let scan = .88 + .12 * f32(id.y%2u);
  textureStore(image,pixel,vec4f((tone + vec3f(.05,.15,.17)*glow)*scan,clean.a));
}
