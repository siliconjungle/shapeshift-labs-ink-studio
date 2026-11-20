const test=require('node:test'),assert=require('node:assert/strict'),core=require('..');
function paletteBrowserProbe(createRenderer) {
 const kit={KIT,PixelLook,RenderStages},a=KIT.palette.duotone('#4caaa7','#edaa67'),b=KIT.palette.duotone('#a57fd3','#c7c864');
 const program=KIT.palette.animate({keys:[{time:0,recipe:a},{time:4,recipe:b}],playback:'pingpong'}),B=makeBuilder(1,a.palette);
 B.disc(0,0,0,[0,0,1],.8,.01,B.P[a.roles.primary[3]],3);const W=B.finish();W.cam={target:[0,0,0],dist:6,yaw:0,pitch:0};W.radius=4;W.look={pixelSize:1};W.paletteRoles=a.roles;
 const binding=KIT.palette.bind(W,program),canvas=document.querySelector('canvas'),renderer=createRenderer(canvas,{toolkit:kit}),gl=canvas.getContext('webgl2');
 function draw(t){renderer.render(binding.update(t),{width:80,height:80,time:t,damp:false,dither:0,edges:false,changedRows:[]});const rgba=new Uint8Array(4);gl.readPixels(40,40,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);if(gl.getError())throw Error('WebGL error');return [...rgba];}
 const before=draw(0);draw(0);let uploads=0;
 const image=gl.texImage2D.bind(gl),sub=gl.texSubImage2D.bind(gl);gl.texImage2D=(...args)=>{uploads++;return image(...args);};gl.texSubImage2D=(...args)=>{uploads++;return sub(...args);};
 const after=draw(4);if(before.every((v,i)=>Math.abs(v-after[i])<2))throw Error('Palette did not change the rendered splat');
 if(uploads)throw Error('Palette-only animation uploaded scene textures: '+uploads);
 const again=draw(8);if(before.some((v,i)=>Math.abs(v-again[i])>1))throw Error('Seeking did not restore the exact palette');
 renderer.dispose();return {before,after,uploads};
}
test('native palette animation recolors splats, seeks exactly and avoids geometry texture uploads',{skip:!process.env.INK_TEST_CHROME},()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-native-'));
 try{
 fs.writeFileSync(path.join(tmp,'bundle.js'),core.bundle());fs.writeFileSync(path.join(tmp,'index.html'),`<!doctype html><canvas></canvas><pre id="result">PENDING</pre><script src="bundle.js"></script><script type="module">
import {createRenderer} from ${JSON.stringify(pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href)};
try{window.samples=(${paletteBrowserProbe.toString()})(createRenderer);document.querySelector('#result').textContent='PASS';}catch(e){document.querySelector('#result').textContent=e.stack;}</script>`);
 const html=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking','--allow-file-access-from-files','--enable-unsafe-swiftshader','--use-angle=swiftshader','--user-data-dir='+path.join(tmp,'profile'),'--dump-dom',pathToFileURL(path.join(tmp,'index.html')).href],{timeout:90000,encoding:'utf8',maxBuffer:4e6,stdio:['ignore','pipe','ignore']});assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
module.exports=paletteBrowserProbe;
