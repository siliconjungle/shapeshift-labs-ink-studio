const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

function command([action, input, request, ...extra], opt, {KIT}) {
  const editing=action==='edit', compiling=action==='compile';
  const names=editing ? ['out','mesh','out-mesh','out-patch','report'] : ['out'];
  if ((!editing && !compiling && action!=='inspect') || !input ||
      (editing ? !request : request!==undefined) || extra.length ||
      Object.entries(opt).some(([key,value])=>!names.includes(key) || typeof value!=='string') ||
      (compiling && !opt.out))
    throw new TypeError('Use mesh-topology sections inspect|compile|edit with a retained section mesh source');
  const inputs=[input,request,opt.mesh].filter(Boolean).map(file=>path.resolve(file));
  const outputs=[opt.out,opt['out-mesh'],opt['out-patch'],opt.report].filter(Boolean).map(file=>path.resolve(file));
  if (new Set(outputs).size!==outputs.length || outputs.some(file=>inputs.includes(file)))
    throw new RangeError('Choose separate paths for source, editable mesh, patch, and report outputs');
  const read=file=>JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
  const save=(file,value)=>{if(file) files.json(path.resolve(file),value);};
  const api=KIT.procedural.sectionMeshes, source=read(input);
  const result=editing ? api.plan(source,read(request),{mesh:opt.mesh && read(opt.mesh)}) : api.compile(source);
  if (editing) {
    save(opt.out,result.source);
    save(opt['out-mesh'],result.mesh);
    save(opt['out-patch'],result.patch);
    save(opt.report,result.report);
  } else save(opt.out,compiling ? result.mesh : result.report);
  if (!opt.out || editing) process.stdout.write(JSON.stringify(result.report,null,2)+'\n');
}

module.exports = { command };
