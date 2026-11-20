import { waterGLSL } from './water-optics.mjs';
import { createResources } from './resources.mjs';

// Opaque pixel cutouts share an atlas and depth buffer with the splat pass.
export function createSurfacePipeline(gl, { updatesSince, cutaway } = {}) {
  const resources=createResources(gl);
  try {
    const shaders=new Map();
    function shaderFor(wet,section){
      const key=(wet ? 1+Number(wet.airPockets)+2*Number(wet.layered)+4*Number(wet.atlas) : 0)+16*Boolean(section);
      if(shaders.has(key))return shaders.get(key);
      const shader=resources.program(`#version 300 es
precision highp float;
layout(location=0) in vec3 a_point;
layout(location=1) in vec2 a_texel;
uniform mat4 u_view,u_proj;
out vec2 v_texel;
out vec3 v_world;
out float v_depth;
out vec3 v_camera;
void main(){
  vec4 p=u_view*vec4(a_point,1.0);
  v_texel=a_texel;v_world=a_point;v_depth=-p.z;v_camera=p.xyz;
  gl_Position=u_proj*p;
}`,`#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec4 u_range,u_splatPlane;
${wet ? waterGLSL(wet.airPockets,wet.layered,wet.atlas) : "uniform vec4 u_arrivalPlane;"}
uniform vec2 u_surfaceViewport;
uniform vec3 u_fog;
uniform bool u_index;
${section ? cutaway : ''}
in vec2 v_texel;
in vec3 v_world;
in float v_depth;
in vec3 v_camera;
layout(location=0) out vec4 color;
layout(location=1) out vec4 depth;
layout(location=2) out vec4 water;
void main(){
  vec4 ink=texelFetch(u_atlas,ivec2(v_texel),0);
  if(ink.a<.5||dot(u_arrivalPlane,vec4(v_world,1.0))<0.0||dot(u_splatPlane,vec4(v_camera,1.0))<0.0)discard;
  ${section ? 'float margin=sectionMargin(v_world,v_depth); if(margin<0.0)discard;' : ''}
  float d=clamp((v_depth-u_range.x)/(u_range.y-u_range.x),0.0,1.0);
  float fog=u_range.z<1.0?smoothstep(u_range.z,1.0,d)*u_range.w:0.0;
  vec3 mark=vec3(0.0), rgb=ink.rgb;
  ${wet ? 'if(!u_index)rgb=waterPaint(rgb,gl_FragCoord.xy,u_surfaceViewport,v_depth,mark);' : ''}
  rgb=mix(rgb,u_fog,fog);
  ${section ? 'rgb=mix(rgb,u_sectionEdge.rgb,sectionInk(margin));' : ''}
  color=u_index?vec4(0.0):vec4(rgb,1.0);
  depth=vec4(d,0.0,0.0,1.0);water=vec4(mark,1.0);
}`);
      shaders.set(key,shader);
      return shader;
    }
    const vao=resources.allocate('VertexArray'),buffer=resources.allocate('Buffer'),texture=resources.texture();
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);
    gl.bindVertexArray(null);
    let active,activeVertices,revision=-1,width=0,height=0,disposed=false,staging=new Uint8Array(0);
    const stats={textureBytes:0,geometryBytes:0};
    function upload(atlas){
      stats.textureBytes=0;stats.geometryBytes=0;
      if(disposed)throw new Error('Surface pipeline has been disposed');
      const next=atlas?.revision??0;
      if(active===atlas&&revision===next&&activeVertices===atlas.vertices&&width===atlas.width&&height===atlas.height)return;
      if(!atlas||!(atlas.vertices instanceof Float32Array)||atlas.vertices.length%15||
        !Number.isSafeInteger(atlas.width)||atlas.width<1||!Number.isSafeInteger(atlas.height)||atlas.height<1||
        !(atlas.pixels instanceof Uint8Array)||atlas.pixels.length!==atlas.width*atlas.height*4||
        !atlas.vertices.every(Number.isFinite)||!Number.isSafeInteger(next)||next<0)throw new RangeError('Invalid sprite surface atlas');
      if(Math.max(atlas.width,atlas.height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new RangeError('Surface atlas exceeds GPU size limit');
      const replace=active!==atlas||width!==atlas.width||height!==atlas.height;
      if(replace||activeVertices!==atlas.vertices){
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,atlas.vertices,gl.STATIC_DRAW);
        stats.geometryBytes=atlas.vertices.byteLength;
      }
      gl.activeTexture(gl.TEXTURE0+6);gl.bindTexture(gl.TEXTURE_2D,texture);
      if(replace){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,atlas.width,atlas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,atlas.pixels);
        stats.textureBytes=atlas.pixels.byteLength;
      }else if(revision!==next){
        const changes=updatesSince?.(atlas,revision);
        let x=0,y=0,w=atlas.width,h=atlas.height;
        if(changes?.length){
          x=Math.min(...changes.map(r=>r.x));y=Math.min(...changes.map(r=>r.y));
          w=Math.max(...changes.map(r=>r.x+r.width))-x;h=Math.max(...changes.map(r=>r.y+r.height))-y;
        }
        const bytes=w*h*4;
        if(staging.length<bytes)staging=new Uint8Array(bytes);
        for(let row=0;row<h;row++)staging.set(atlas.pixels.subarray(((y+row)*atlas.width+x)*4,((y+row)*atlas.width+x+w)*4),row*w*4);
        gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,w,h,gl.RGBA,gl.UNSIGNED_BYTE,staging.subarray(0,bytes));
        stats.textureBytes=bytes;
      }
      active=atlas;activeVertices=atlas.vertices;revision=next;width=atlas.width;height=atlas.height;
    }
    function draw(atlas,{view,projection,range,fog,index=false,arrivalPlane=[0,0,0,0],clip=[0,0,0,0],water,wet,width=1,height=1,section}){
      upload(atlas);
      gl.activeTexture(gl.TEXTURE0+6);gl.bindTexture(gl.TEXTURE_2D,texture);
      const shader=shaderFor(wet,section);
      gl.useProgram(shader.p);shader.set({u_view:view,u_proj:projection,u_range:range,u_fog:fog,u_atlas:6,
        u_index:+index,u_arrivalPlane:arrivalPlane,u_splatPlane:clip,u_surfaceViewport:[width,height],...water,...section});
      gl.bindVertexArray(vao);gl.drawArrays(gl.TRIANGLES,0,active.vertices.length/5);
      gl.activeTexture(gl.TEXTURE0);
    }
    return {draw,get stats(){return {...stats};},dispose(){if(disposed)return;disposed=true;resources.dispose();}};
  }catch(error){resources.dispose();throw error;}
}
