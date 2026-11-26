const LightingRoomShaders = (() => {
  const panorama = `
precision highp float;
precision highp int;
const float PI = 3.141592653589793;
uniform highp sampler2D uPanorama;
vec2 envUV(vec3 d) {
  return vec2(0.5 + atan(d.x,d.z)/(2.0*PI), acos(clamp(d.y,-1.0,1.0))/PI);
}
vec3 envDirection(vec2 uv) {
  float phi = (uv.x - 0.5) * 2.0 * PI, theta = uv.y * PI;
  float s = sin(theta);
  return vec3(sin(phi)*s,cos(theta),cos(phi)*s);
}
vec3 radiance(vec4 rgbe) {
  vec4 b = floor(rgbe*255.0 + 0.5);
  return b.a < 1.0 ? vec3(0.0) : b.rgb * exp2(b.a - 136.0);
}
vec4 rgbe(vec3 rgb) {
  float p = max(max(rgb.r,rgb.g),rgb.b);
  if(p < 1e-20) return vec4(0.0);
  float e = floor(log2(p)) + 1.0;
  return vec4(clamp(floor(rgb*exp2(8.0-e)),0.0,255.0),e+128.0)/255.0;
}
ivec2 address(ivec2 p, ivec2 extent) {
  return ivec2((p.x%extent.x+extent.x)%extent.x,clamp(p.y,0,extent.y-1));
}
vec3 rawLevel(vec2 uv, int lod) {
  ivec2 extent = textureSize(uPanorama,lod);
  vec2 p = uv * vec2(extent) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec3 a = radiance(texelFetch(uPanorama,address(i,extent),lod));
  vec3 b = radiance(texelFetch(uPanorama,address(i+ivec2(1,0),extent),lod));
  vec3 c = radiance(texelFetch(uPanorama,address(i+ivec2(0,1),extent),lod));
  vec3 d = radiance(texelFetch(uPanorama,address(i+ivec2(1,1),extent),lod));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
`;
  const exposure = `
uniform float uYaw;
uniform float uEnvEV;
uniform float uCameraEV;
vec3 localLight(vec3 d) {
  float a = cos(uYaw), b = sin(uYaw);
  return vec3(a*d.x-b*d.z,d.y,b*d.x+a*d.z);
}
vec3 srgb(vec3 x) {
  return mix(x*12.92,1.055*pow(x,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),x));
}
vec3 display(vec3 value) {
  vec3 n = max(vec3(0.0),value) * exp2(uCameraEV);
  return srgb(n/(1.0+n));
}
`;
  const screen = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  vUv = p;
  gl_Position = vec4(p*2.0-1.0,0.0,1.0);
}
`;

  const filter = `#version 300 es
${panorama}
uniform float uRoughness;
uniform int uMaxMip;
in vec2 vUv;
out vec4 result;
float sequence(uint n) {
  n = (n<<16u) | (n>>16u);
  n = ((n&0x55555555u)<<1u) | ((n&0xAAAAAAAAu)>>1u);
  n = ((n&0x33333333u)<<2u) | ((n&0xCCCCCCCCu)>>2u);
  n = ((n&0x0F0F0F0Fu)<<4u) | ((n&0xF0F0F0F0u)>>4u);
  n = ((n&0x00FF00FFu)<<8u) | ((n&0xFF00FF00u)>>8u);
  return float(n)*2.32830643654e-10;
}
void main() {
  vec3 n = envDirection(vUv);
  vec3 helper = abs(n.y) > 0.97 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0);
  vec3 tangent = normalize(cross(helper,n)), bitangent = cross(n,tangent);
  vec3 sum = vec3(0.0);
  float weight = 0.0, alpha = uRoughness*uRoughness, a2 = alpha*alpha;
  vec2 extent = vec2(textureSize(uPanorama,0));
  for(uint i=0u; i<64u; i++) {
    float x = (float(i)+0.5)/64.0, y = sequence(i);
    float phi = 2.0*PI*x;
    float cosTheta = sqrt((1.0-y)/(1.0+(a2-1.0)*y));
    float sinTheta = sqrt(max(0.0,1.0-cosTheta*cosTheta));
    vec3 h = tangent*cos(phi)*sinTheta + bitangent*sin(phi)*sinTheta + n*cosTheta;
    vec3 d = reflect(-n,h);
    float facing = max(0.0,dot(n,d));
    if(facing <= 0.0) continue;
    float den = cosTheta*cosTheta*(a2-1.0)+1.0;
    float pdf = max(0.000001,a2/(PI*den*den*4.0));
    float solid = 2.0*PI*PI*max(0.08,sqrt(max(0.0,1.0-d.y*d.y)))/(extent.x*extent.y);
    float mip = clamp(0.5*log2(1.0/(64.0*pdf*solid)),0.0,float(uMaxMip));
    int lo = int(floor(mip)), hi = min(lo+1,uMaxMip);
    vec2 uv = envUV(d);
    sum += mix(rawLevel(uv,lo),rawLevel(uv,hi),fract(mip))*facing;
    weight += facing;
  }
  result = rgbe(sum/max(0.0001,weight));
}
`;

  const background = `#version 300 es
${panorama}
${exposure}
in vec2 vUv;
uniform bool uVisible;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uBack;
uniform vec2 uFrustum;
out vec4 result;
void main() {
  vec2 p=(vUv*2.0-1.0)*uFrustum;
  vec3 d=normalize(-uBack+uRight*p.x+uUp*p.y);
  if(uVisible) {
    result=vec4(display(rawLevel(envUV(localLight(d)),0)*exp2(uEnvEV)),1.0);
  } else {
    float l=1.0-clamp(length((vUv-vec2(0.47,0.54))*vec2(1.35,1.0)),0.0,1.0);
    result=vec4(mix(vec3(0.081,0.079,0.1),vec3(0.201,0.192,0.21),l),1.0);
  }
}
`;

  const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uView;
uniform mat4 uProjection;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
void main() {
  vWorld=aPosition;
  vNormal=aNormal;
  vUV=aUV;
  gl_Position=uProjection*uView*vec4(aPosition,1.0);
}
`;
  const material = `#version 300 es
${panorama}
${exposure}
uniform highp sampler2DArray uReflections;
uniform sampler2D uBaseColor;
uniform sampler2D uFinish;
uniform sampler2D uNormal;
uniform sampler2D uEmission;
uniform bool uHasNormal;
uniform vec3 uIrradiance[9];
uniform vec3 uBack;
uniform vec3 uEye;
uniform bool uOrtho;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
out vec4 result;

vec3 diffuse(vec3 n) {
  float x=n.x,y=n.y,z=n.z;
  return max(vec3(0.0),uIrradiance[0]*0.2820947918 + 0.4886025119*
    (uIrradiance[1]*x+uIrradiance[2]*y+uIrradiance[3]*z) +
    1.0925484306*(uIrradiance[4]*x*y+uIrradiance[5]*y*z+uIrradiance[7]*x*z) +
    uIrradiance[6]*(0.3153915653*(3.0*z*z-1.0)) + uIrradiance[8]*(0.5462742153*(x*x-y*y)));
}
vec3 blurred(vec2 uv, int layer) {
  if(layer==0)return rawLevel(uv,0);
  ivec2 extent=textureSize(uReflections,0).xy;
  vec2 p=uv*vec2(extent)-0.5;
  ivec2 i=ivec2(floor(p));
  vec2 f=fract(p);
  int l=layer-1;
  vec3 a=radiance(texelFetch(uReflections,ivec3(address(i,extent),l),0));
  vec3 b=radiance(texelFetch(uReflections,ivec3(address(i+ivec2(1,0),extent),l),0));
  vec3 c=radiance(texelFetch(uReflections,ivec3(address(i+ivec2(0,1),extent),l),0));
  vec3 d=radiance(texelFetch(uReflections,ivec3(address(i+ivec2(1,1),extent),l),0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
vec3 reflection(vec3 d,float rough) {
  vec2 uv=envUV(d);
  float t=rough*6.0;
  int lo=int(floor(t));
  return mix(blurred(uv,lo),blurred(uv,min(lo+1,6)),fract(t));
}
vec3 mappedNormal(vec3 n) {
  if(!uHasNormal)return n;
  vec3 px=dFdx(vWorld),py=dFdy(vWorld);
  vec2 ux=dFdx(vUV),uy=dFdy(vUV);
  float det=ux.x*uy.y-ux.y*uy.x;
  if(abs(det)<1e-9)return n;
  vec3 du=(px*uy.y-py*ux.y)/det;
  vec3 dv=(py*ux.x-px*uy.x)/det;
  vec3 t=normalize(du-n*dot(n,du)),b=normalize(cross(n,t));
  if(dot(b,-dv)<0.0)b=-b;
  vec3 mapped=texture(uNormal,vUV).rgb*2.0-1.0;
  return normalize(t*mapped.x+b*mapped.y+n*mapped.z);
}
vec2 brdf(float rough, float nv) {
  vec4 r=rough*vec4(-1.0,-0.0275,-0.572,0.022)+vec4(1.0,0.0425,1.04,-0.04);
  float a=min(r.x*r.x,exp2(-9.28*nv))*r.x+r.y;
  return max(vec2(0.0),vec2(-1.04,1.04)*a+r.zw);
}
void main() {
  vec3 n=normalize(vNormal)*(gl_FrontFacing?1.0:-1.0);
  vec3 v=uOrtho?uBack:normalize(uEye-vWorld);
  n=mappedNormal(n);
  vec4 paint=texture(uBaseColor,vUV);
  if(paint.a<0.5)discard;
  vec2 finish=texture(uFinish,vUV).rg;
  float rough=clamp(finish.r,0.045,1.0), metal=finish.g, nv=clamp(dot(n,v),0.0,1.0);
  vec3 f0=mix(vec3(0.04),paint.rgb,metal);
  vec2 df=brdf(rough,nv);
  vec3 f=f0*df.x+df.y;
  vec3 indirect=diffuse(localLight(n))*paint.rgb*(1.0-metal)*(1.0-clamp(f,0.0,1.0));
  vec3 spec=reflection(localLight(reflect(-v,n)),rough)*f;
  vec3 emission=texture(uEmission,vUV).rgb;
  result=vec4(display((indirect+spec)*exp2(uEnvEV)+emission),1.0);
}
`;
  return { screen,filter,background,vertex,material };
})();
