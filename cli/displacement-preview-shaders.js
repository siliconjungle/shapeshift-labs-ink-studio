/* Shared scalar addressing keeps the fragment trace and the vertex mesh on the same field. */
const DisplacementShaders = (() => {
  const field = `
precision highp float;
precision highp int;
uniform highp sampler2D uHeight;
uniform vec2 uShape;
uniform vec2 uDisplacement;
uniform int uSeam;
uniform float uSeamWidth;
ivec2 address(ivec2 cell, ivec2 size) {
  if (uSeam == 1) return ((cell % size) + size) % size;
  return clamp(cell, ivec2(0), size - ivec2(1));
}
vec4 chart(highp sampler2D image, vec2 uv) {
  ivec2 size = textureSize(image, 0);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 w = fract(p);
  vec4 a = texelFetch(image, address(i, size), 0);
  vec4 b = texelFetch(image, address(i + ivec2(1,0), size), 0);
  vec4 c = texelFetch(image, address(i + ivec2(0,1), size), 0);
  vec4 d = texelFetch(image, address(i + ivec2(1,1), size), 0);
  return mix(mix(a,b,w.x), mix(c,d,w.x), w.y);
}
float displacement(vec2 uv) {
  float z = (chart(uHeight, uv).r - uDisplacement.y) * uDisplacement.x;
  if (uSeam != 2) return z;
  vec2 edges = min(uv, 1.0 - uv);
  return z * smoothstep(0.0, uSeamWidth, min(edges.x, edges.y));
}
vec2 addressUV(vec2 uv) { return uSeam == 1 ? uv : clamp(uv, 0.0, 1.0); }
`;

  const vertex = `#version 300 es
${field}
layout(location=0) in vec2 aUv;
uniform ivec2 uTiles;
uniform int uMode;
uniform mat4 uView;
uniform mat4 uProjection;
out vec2 vUv;
out vec3 vWorld;
out float vDepth;
void main() {
  vec2 tile = vec2(gl_InstanceID % uTiles.x, gl_InstanceID / uTiles.x);
  vec2 chartPosition = aUv + tile - vec2(uTiles) * 0.5;
  float relief = uMode == 2 ? displacement(aUv) : 0.0;
  vUv = aUv;
  vWorld = vec3(chartPosition.x, -chartPosition.y, 0.0) * vec3(uShape,1.0) + vec3(0.0,0.0,relief);
  vec4 camera = uView * vec4(vWorld,1.0);
  vDepth = -camera.z;
  gl_Position = uProjection * camera;
}
`;

  const fragment = `#version 300 es
${field}
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform bool uHasNormal;
uniform bool uHasColor;
uniform vec3 uCamera;
uniform vec3 uBack;
uniform bool uOrtho;
uniform int uSteps;
uniform int uMode;
uniform int uTangent;
uniform vec2 uHeightRange;
uniform vec2 uClips;
in vec2 vUv;
in vec3 vWorld;
in float vDepth;
layout(location=0) out vec4 color;
layout(location=1) out vec4 depthSample;

float residual(vec2 offset, float z) {
  return z - displacement(addressUV(vUv + offset * z));
}
vec2 intersectRelief(vec3 ray) {
  if (ray.z <= 0.025 || uHeightRange.y - uHeightRange.x < 0.000001) return vUv;
  vec2 offset = (ray.xy / ray.z) * vec2(1.0,-1.0) / uShape;
  float high = uHeightRange.y, low = uHeightRange.x;
  float stepZ = (high - low) / float(uSteps);
  high += 0.000002;
  for (int i = 1; i <= 96; ++i) {
    if (i > uSteps) break;
    float end = i == uSteps ? low - 0.000002 : uHeightRange.y - float(i) * stepZ;
    if (residual(offset, end) <= 0.0) {
      for (int j = 0; j < 4; ++j) {
        float middle = (high + end) * 0.5;
        if (residual(offset, middle) > 0.0) high = middle;
        else end = middle;
      }
      return addressUV(vUv + offset * ((high + end) * 0.5));
    }
    high = end;
  }
  return vUv;
}
vec3 normalAt(vec2 uv) {
  if (uHasNormal) {
    vec3 n = (chart(uNormal, uv).rgb * 255.0 - 128.0) / 127.0;
    n.y *= float(uTangent);
    return dot(n,n) < 0.00001 ? vec3(0.0,0.0,1.0) : normalize(n);
  }
  vec2 stepUV = 1.0 / vec2(textureSize(uHeight, 0));
  vec2 lo = addressUV(uv - stepUV), hi = addressUV(uv + stepUV);
  float left = displacement(vec2(lo.x,uv.y)), right = displacement(vec2(hi.x,uv.y));
  float top = displacement(vec2(uv.x,lo.y)), bottom = displacement(vec2(uv.x,hi.y));
  vec2 span = max(vec2(0.000001), (hi - lo) * uShape);
  return normalize(vec3((left - right) / span.x, (bottom - top) / span.y, 1.0));
}
vec3 display(vec3 linear) {
  linear = clamp(linear,0.0,1.0);
  return mix(linear * 12.92, 1.055 * pow(linear, vec3(1.0/2.4)) - 0.055, step(0.0031308,linear));
}
void main() {
  vec3 ray = uOrtho ? uBack : normalize(uCamera - vWorld);
  vec2 uv = uMode == 1 ? intersectRelief(ray) : vUv;
  vec4 paint = uHasColor ? chart(uColor, vUv) : vec4(0.39,0.21,0.13,1.0);
  if (paint.a < 0.5) discard;
  if (uHasColor && uMode == 1) {
    vec4 mapped = chart(uColor, uv);
    if (mapped.a >= 0.5) paint = mapped;
  }
  vec3 n = normalAt(uv), light = normalize(vec3(-0.52,0.61,0.58));
  float diffuse = 0.35 + 0.65 * max(0.0,dot(n, light));
  float sheen = 0.14 * max(0.0,dot(n, light)) * pow(max(0.0,dot(n,normalize(ray + light))), 22.0);
  color = vec4(display(paint.rgb * diffuse + sheen * vec3(1.0,0.9,0.76)), 1.0);
  float depth = clamp((vDepth - uClips.x) / (uClips.y - uClips.x), 0.0, 1.0);
  uint bits = uint(round(depth * 16777215.0));
  depthSample = vec4(float((bits >> 16u) & 255u), float((bits >> 8u) & 255u), float(bits & 255u),255.0) / 255.0;
}
`;

  return { vertex, fragment };
})();
