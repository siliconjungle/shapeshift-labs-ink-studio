import { createWebGPUGraph } from './graph.mjs';

/** Create a WebGPU executor for a Pixel Processor compiled by the Ink toolkit. */
export function createWebGPUPixelProcessor(device, program) {
  if(typeof program?.prepare!=='function'||typeof program.wgsl!=='string')
    throw new TypeError('Compile a Pixel Processor with the Ink toolkit first');
  const names=['source','metadata','result'];
  const bindings=names.map((resource,i)=>({resource,mode:i===2?'write-buffer':'read-buffer'}));
  let graph, signature, running=false, disposed=false;

  async function dispatch(packet) {
    if(disposed)throw new Error('WebGPU Pixel Processor is disposed');
    if(running)throw new Error('A WebGPU Pixel Processor dispatch is already running');
    const {width,height,inputs,meta,count}=packet, sizes=[inputs.byteLength,meta.byteLength,count*4];
    const next=[width,height,...sizes].join('/');
    const limit=device?.limits?.maxStorageBufferBindingSize;
    if(limit!==undefined&&sizes.some(size=>size>limit))
      throw new RangeError('Pixel Processor buffer exceeds the WebGPU storage binding limit');
    running=true;
    try{
      if(next!==signature){
        const candidate=await createWebGPUGraph(device,{
          resources:Object.fromEntries(names.map((name,i)=>[name,{type:'buffer',size:sizes[i]}])),
          nodes:[{id:'pixel-processor',shader:program.wgsl,bindings,workgroups:[Math.ceil(width/8),Math.ceil(height/8)]}]
        });
        if(disposed){candidate.dispose();throw new Error('WebGPU Pixel Processor is disposed');}
        graph?.dispose();
        graph=candidate;
        signature=next;
      }
      graph.writeBuffer('source',inputs);
      graph.writeBuffer('metadata',meta);
      graph.run(['result']);
      const bytes=await graph.readBuffer('result');
      return new Float32Array(bytes.buffer,bytes.byteOffset,count);
    }finally{
      running=false;
      if(disposed)graph?.dispose();
    }
  }

  return Object.freeze({
    async run(request){
      const packet=program.prepare(request);
      return packet.resolve(await dispatch(packet));
    },
    async compare(request,tolerance){
      const packet=program.prepare(request), cpu=packet.executeCPU(), gpu=await dispatch(packet);
      return packet.compare(cpu,gpu,tolerance);
    },
    dispose(){
      disposed=true;
      if(!running)graph?.dispose();
    }
  });
}
