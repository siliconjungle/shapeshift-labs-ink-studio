const RoomRenderer = (() => {
  const rad = degrees => degrees * Math.PI / 180;
  const bits = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  function meshValues(base64) {
    const view = new DataView(bits(base64).buffer);
    return Float32Array.from({length:view.byteLength/4},(_,i)=>view.getFloat32(i*4,true));
  }
  function lens(rig, width, height) {
    const row = rig.camera, yaw = rad(row.yaw), pitch = rad(row.pitch);
    const fov = CameraLens.fieldOfView(row.focalLength,row.sensorHeight), aspect = width/height;
    const target = CameraLens.target({ target:row.target, dist:row.distance, yaw,pitch,fov,composition:row.framing },aspect);
    const pose = CameraLens.orbitPose(yaw,pitch,row.distance,target);
    const h = Math.tan(fov*.5), w = h*aspect, ortho = row.projection === 'orthographic';
    const near = .025, far = 180, span = far-near;
    const projection = ortho ? [1/(w*row.distance),0,0,0, 0,1/(h*row.distance),0,0, 0,0,-2/span,0, 0,0,-(far+near)/span,1] :
      [1/w,0,0,0, 0,1/h,0,0, 0,0,-(far+near)/span,-1, 0,0,-2*far*near/span,0];
    return { pose, view:CameraLens.matrix(pose), projection,frustum:[w,h],ortho };
  }

  // Keep HDR samples in RGBE. Mip levels average decoded radiance, including latitude weight.
  function nextLevel({width,height,pixels}) {
    const w=Math.max(1,width>>1), h=Math.max(1,height>>1), data=new Uint8Array(w*h*4);
    const weight=Float64Array.from({length:height},(_,y)=>Math.cos(y*Math.PI/height)-Math.cos((y+1)*Math.PI/height));
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const rgb=[0,0,0];
      let total=0;
      for(let j=Math.floor(y*height/h); j<Math.floor((y+1)*height/h); j++)
        for(let i=Math.floor(x*width/w); i<Math.floor((x+1)*width/w); i++) {
          const p=(j*width+i)*4, exp=pixels[p+3], factor=exp?2**(exp-136)*weight[j]:0;
          for(let c=0;c<3;c++) rgb[c]+=pixels[p+c]*factor;
          total+=weight[j];
        }
      const peak=Math.max(...rgb)/total;
      if(peak<1e-20)continue;
      const exponent=Math.floor(Math.log2(peak))+1, scale=2**(8-exponent)/total, at=(y*w+x)*4;
      for(let c=0;c<3;c++) data[at+c]=Math.min(255,Math.floor(rgb[c]*scale));
      data[at+3]=exponent+128;
    }
    return {width:w,height:h,pixels:data};
  }

  function create(canvas, data) {
    const {width,height}=data.view;
    canvas.width=width;
    canvas.height=height;
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl)throw new Error('Lighting room needs WebGL 2');
    function program(vertex,fragment,keys) {
      const output=gl.createProgram();
      for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
        const shader=gl.createShader(type);
        gl.shaderSource(shader,source);
        gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(output,shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(output);
      if(!gl.getProgramParameter(output,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(output));
      return { output, u:Object.fromEntries(keys.map(name=>[name,gl.getUniformLocation(output,'u'+name)])) };
    }
    const { screen, filter, background, vertex, material }=LightingRoomShaders;
    const prefilter=program(screen,filter,['Panorama','Roughness','MaxMip']);
    const sky=program(screen,background,['Panorama','Visible','Right','Up','Back','Frustum','Yaw','EnvEV','CameraEV']);
    const shade=program(vertex,material,['View','Projection','Panorama','Reflections','BaseColor','Finish','Normal','Emission',
      'HasNormal','Irradiance[0]','Back','Eye','Ortho','Yaw','EnvEV','CameraEV']);
    gl.disable(gl.DITHER);
    const screenArray=gl.createVertexArray(), filterFB=gl.createFramebuffer();
    const meshes=new Map(data.carriers.map(row=>{
      const vao=gl.createVertexArray(), vbo=gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
      gl.bufferData(gl.ARRAY_BUFFER,meshValues(row.data),gl.STATIC_DRAW);
      for(const [index,size,offset] of [[0,3,0],[1,3,12],[2,2,24]]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
      }
      return [row.kind,{vao,count:row.count}];
    }));
    const bind=(unit,target,texture)=>{
      gl.activeTexture(gl.TEXTURE0+unit);
      gl.bindTexture(target,texture);
    };
    function sampler(target, min, mag, wrap=gl.CLAMP_TO_EDGE) {
      gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,min);
      gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,mag);
      gl.texParameteri(target,gl.TEXTURE_WRAP_S,wrap);
      gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    const maps=data.material.maps, mapWidth=data.material.width, mapHeight=data.material.height;
    const materialLayers=[['baseColor',gl.SRGB8_ALPHA8],['finish',gl.RGBA8],['normal',gl.RGBA8],['emission',gl.SRGB8_ALPHA8]];
    const textures=materialLayers.map(([name,format],i)=>{
      const tex=gl.createTexture(), values=maps[name];
      bind(i+2,gl.TEXTURE_2D,tex);
      sampler(gl.TEXTURE_2D,gl.LINEAR,gl.LINEAR,gl.REPEAT);
      gl.texImage2D(gl.TEXTURE_2D,0,format,values?mapWidth:1,values?mapHeight:1,0,gl.RGBA,gl.UNSIGNED_BYTE,
        values?bits(values):Uint8Array.of(0,0,0,255));
      return tex;
    });

    const environments=new Map();
    function environment(source) {
      const key=typeof source==='string'?source:source.data;
      if(environments.has(key))return environments.get(key);
      const image=typeof source==='string'?HDREnvironment.neutral(source):HDREnvironment.unembed(source);
      const texture=gl.createTexture();
      bind(0,gl.TEXTURE_2D,texture);
      sampler(gl.TEXTURE_2D,gl.NEAREST_MIPMAP_NEAREST,gl.NEAREST);
      let row=image, mip=0;
      for(;;) {
        gl.texImage2D(gl.TEXTURE_2D,mip,gl.RGBA8,row.width,row.height,0,gl.RGBA,gl.UNSIGNED_BYTE,row.pixels);
        if(row.width===1&&row.height===1)break;
        row=nextLevel(row);
        mip++;
      }
      const reflections=gl.createTexture(), w=192,h=96;
      bind(1,gl.TEXTURE_2D_ARRAY,reflections);
      sampler(gl.TEXTURE_2D_ARRAY,gl.NEAREST,gl.NEAREST);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY,1,gl.RGBA8,w,h,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,filterFB);
      gl.disable(gl.DEPTH_TEST);
      gl.viewport(0,0,w,h);
      gl.useProgram(prefilter.output);
      gl.bindVertexArray(screenArray);
      gl.uniform1i(prefilter.u.Panorama,0);
      gl.uniform1i(prefilter.u.MaxMip,mip);
      for(let level=0;level<6;level++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,reflections,0,level);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)
          throw new Error('Could not prepare the HDRI reflection layers');
        gl.uniform1f(prefilter.u.Roughness,(level+1)/6);
        gl.drawArrays(gl.TRIANGLES,0,3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      const record={texture,reflections,irradiance:HDREnvironment.diffuse(image)};
      environments.set(key,record);
      if(environments.size>4) {
        const [old,value]=environments.entries().next().value;
        gl.deleteTexture(value.texture);
        gl.deleteTexture(value.reflections);
        environments.delete(old);
      }
      return record;
    }

    function light(program, rig) {
      const {u}=program;
      gl.uniform1i(u.Panorama,0);
      gl.uniform1f(u.Yaw,rad(rig.environment.rotation));
      gl.uniform1f(u.EnvEV,rig.environment.exposureEV);
      gl.uniform1f(u.CameraEV,rig.camera.exposureEV);
    }
    function render(rig, carrier) {
      const maps=environment(rig.environment.source), model=meshes.get(carrier);
      const {pose,view,projection,ortho,frustum}=lens(rig,width,height);
      bind(0,gl.TEXTURE_2D,maps.texture);
      bind(1,gl.TEXTURE_2D_ARRAY,maps.reflections);
      textures.forEach((texture,i)=>bind(i+2,gl.TEXTURE_2D,texture));
      gl.viewport(0,0,width,height);
      gl.disable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(sky.output);
      gl.bindVertexArray(screenArray);
      light(sky,rig);
      gl.uniform1i(sky.u.Visible,rig.environment.background?1:0);
      gl.uniform3fv(sky.u.Right,pose.right);
      gl.uniform3fv(sky.u.Up,pose.up);
      gl.uniform3fv(sky.u.Back,pose.back);
      gl.uniform2fv(sky.u.Frustum,frustum);
      gl.drawArrays(gl.TRIANGLES,0,3);

      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(shade.output);
      gl.bindVertexArray(model.vao);
      light(shade,rig);
      const {u}=shade;
      gl.uniformMatrix4fv(u.View,false,view);
      gl.uniformMatrix4fv(u.Projection,false,projection);
      gl.uniform1i(u.Reflections,1);
      gl.uniform1i(u.BaseColor,2);
      gl.uniform1i(u.Finish,3);
      gl.uniform1i(u.Normal,4);
      gl.uniform1i(u.Emission,5);
      gl.uniform1i(u.HasNormal,data.material.maps.normal?1:0);
      gl.uniform3fv(u['Irradiance[0]'],maps.irradiance);
      gl.uniform3fv(u.Back,pose.back);
      gl.uniform3fv(u.Eye,pose.eye);
      gl.uniform1i(u.Ortho,ortho?1:0);
      gl.drawArrays(gl.TRIANGLES,0,model.count);
    }
    return {render};
  }
  return {create};
})();
