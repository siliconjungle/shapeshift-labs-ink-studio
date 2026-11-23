import { createGaussianSplatRenderer } from '../../webgpu.mjs';

const $ = id => document.getElementById(id);
const n = count => count.toLocaleString('en-US');
async function fetchAsset(name, method) {
  const response = await fetch('pack/'+name);
  if(!response.ok)throw new Error('Demo assets missing. Run node examples/prism-lock/prepare.mjs.');
  return response[method]();
}

async function start() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('Open the demo in a WebGPU browser on localhost.');
  const [scene,points,depth,device] = await Promise.all([
    fetchAsset('shot.json','json'),fetchAsset('splats.bin','arrayBuffer'),
    fetchAsset('opaque.bin','arrayBuffer'),adapter.requestDevice()
  ]);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const renderer = await createGaussianSplatRenderer(device,{format});
  const {width,height} = scene;
  renderer.setWorld({...scene,data:new Float32Array(points)});
  const opaqueSurface = device.createTexture({size:[width,height],format:'rgba32float',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  device.queue.writeTexture({texture:opaqueSurface},depth,{bytesPerRow:width*16},[width,height]);
  const contexts = ['center','selective'].map(id=>{
    const context=$(id).getContext('webgpu');
    context.configure({device,format,alphaMode:'opaque'});
    return context;
  });
  const overlay = $('tiles').getContext('2d');
  const settings={splatOrder:'selective',opaqueSurface};
  renderer.render(contexts[0].getCurrentTexture(),{...settings,selectiveTransparency:{colorDelta:1}});
  let report, busy=false, dirty=true;
  function drawTiles() {
    overlay.clearRect(0,0,width,height);
    if(!report||!$('diagnostics').checked)return;
    for(const tile of report.tiles){
      const overflow=tile.layerBudgetPixels+tile.pixelBudgetPixels;
      if(!overflow&&!tile.sortedPixels)continue;
      overlay.fillStyle=overflow?'rgba(240,116,181,.48)':'rgba(98,239,224,.36)';
      overlay.fillRect(tile.x,tile.y,tile.width,tile.height);
    }
  }
  async function draw(){
    if(busy||!dirty)return;
    busy=true;
    dirty=false;
    try{
      const layers=Number($('layers').value);
      $('count').value=layers;
      const result=await renderer.render(contexts[1].getCurrentTexture(),{
        ...settings,selectiveTransparency:{layers},profile:true
      });
      report=result.transparencyReport;
      $('status').textContent=n(report.sortedPixels)+' pixels reordered · '+n(report.culledFragments)+
        ' hidden fragments rejected · '+n(report.layerBudgetPixels+report.pixelBudgetPixels)+' budget fallbacks';
      $('report').disabled=false;
      drawTiles();
    } catch(error) { $('status').textContent=error.message; }
    finally{
      busy=false;
      if(dirty)requestAnimationFrame(draw);
    }
  }
  $('layers').oninput=()=>{dirty=true;requestAnimationFrame(draw);};
  $('diagnostics').onchange=drawTiles;
  $('report').onclick=()=>{
    if(!report)return;
    const href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
    Object.assign(document.createElement('a'),{href,download:'prism-lock-transparency.json'}).click();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
  };
  requestAnimationFrame(draw);
}
start().catch(error=>{$('status').textContent=error.message;});
