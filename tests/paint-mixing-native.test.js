const test=require('node:test'),assert=require('node:assert/strict'),core=require('..');
function paintBrowserProbe(createRenderer) {
 const P=KIT.paint,paints=['blue','yellow','red','white'].map(name=>P.preset(name)),canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{alpha:false,antialias:false});canvas.width=canvas.height=1;
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 const program=gl.createProgram(),vs=shader(gl.VERTEX_SHADER,`#version 300 es
void main(){vec2 p=gl_VertexID==0?vec2(-1,-1):gl_VertexID==1?vec2(3,-1):vec2(-1,3);gl_Position=vec4(p,0,1);}`),fs=shader(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;uniform highp sampler3D u_table;uniform vec4 u_amounts;out vec4 color;
${P.glsl}
void main(){color=vec4(inkPaintTable(u_table,u_amounts),1);}`);
 gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const texture=gl.createTexture(),vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,texture);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,axis,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,'u_table'),0);gl.viewport(0,0,1,1);
 for(const n of [2,3,4]){
  const table=P.bakeTable({paints:paints.slice(0,n),size:9}),raster=table.rgba();gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,raster.width,raster.height,raster.depth,0,gl.RGBA,gl.UNSIGNED_BYTE,raster.data);
  const samples=[Array(n).fill(1),Array.from({length:n},(_,i)=>i===0?1:0),Array.from({length:n},(_,i)=>i===n-1?1:0),Array.from({length:n},(_,i)=>i<2?.5:0)];
  for(const weights of samples){gl.uniform4fv(gl.getUniformLocation(program,'u_amounts'),weights.concat(Array(4-n).fill(0)));gl.drawArrays(gl.TRIANGLES,0,3);const rgba=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);const expected=table.sample(weights);if(expected.some((v,i)=>Math.abs(v*255-rgba[i])>2))throw Error('GPU table mismatch '+n+' '+weights+': '+rgba+' / '+expected);}
 }
 if(gl.getError())throw Error('WebGL error in paint table sampler');gl.deleteTexture(texture);gl.deleteVertexArray(vao);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
 // The exported table also works through the existing native palette/LUT path.
 const table=P.bakeTable({paints,size:9}),coords=table.coordinates([1,2,3,4]),packed=coords.map(v=>Math.round(v*255)),hex=(packed[0]<<16)|(packed[1]<<8)|packed[2],B=makeBuilder(1,[0,hex]);B.disc(0,0,0,[0,0,1],.8,.01,B.P[1],3);const W=B.finish();W.cam={target:[0,0,0],dist:6,yaw:0,pitch:0};W.radius=4;W.look={pixelSize:1};
 const target=document.createElement('canvas'),renderer=createRenderer(target,{toolkit:{KIT,PixelLook,RenderStages}});renderer.render(W,{width:80,height:80,damp:false,dither:0,edges:false,colorLut:table.asLUT()});const context=target.getContext('webgl2'),rgba=new Uint8Array(4);context.readPixels(40,40,1,1,context.RGBA,context.UNSIGNED_BYTE,rgba);const expected=ColorLUT.prepare(table.asLUT()).sample(packed.map(v=>v/255));if(expected.some((v,i)=>Math.abs(v*255-rgba[i])>3))throw Error('Native LUT did not apply baked paint mixture');if(context.getError())throw Error('Native LUT WebGL error');renderer.dispose();return 'PASS';
}
test('baked paint tables match CPU sampling on the GPU and integrate with native LUT rendering',{skip:!process.env.INK_TEST_CHROME},()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-native-'));
 try{fs.writeFileSync(path.join(tmp,'bundle.js'),core.bundle());fs.writeFileSync(path.join(tmp,'index.html'),`<!doctype html><canvas></canvas><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import {createRenderer} from ${JSON.stringify(pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href)};
try{(${paintBrowserProbe.toString()})(createRenderer);document.querySelector('#result').textContent='PASS';}catch(e){document.querySelector('#result').textContent=e.stack;}</script>`);
 const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking','--allow-file-access-from-files','--enable-unsafe-swiftshader','--use-angle=swiftshader','--user-data-dir='+path.join(tmp,'profile'),'--dump-dom',pathToFileURL(path.join(tmp,'index.html')).href],{timeout:90000,encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']});assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
module.exports=paintBrowserProbe;
