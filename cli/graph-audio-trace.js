/* Follow the actual graph bindings feeding a tap, including group scopes. */
const {createHash}=require('node:crypto');

function compact(value) {
  const json=JSON.stringify(value);
  if (json.length<=16000) return value;
  return {sha256:createHash('sha256').update(json).digest('hex'),jsonBytes:Buffer.byteLength(json)};
}

function audioTrace(snapshot,target) {
  const root={scope:snapshot.graph,path:''}, inputs={}, assets={}, chain=[];
  const seen=new Set(), emitted=new Set();
  function descend(ctx,name,node,alias=node.groupPath) {
    const scope=snapshot.groups[alias];
    if (!scope) throw new RangeError('Unknown graph group at '+ctx.path+name);
    const bindings=node.groupPaths && node.inputs.initial ? {...node.inputs,state:node.inputs.initial} : node.inputs;
    return {scope,path:ctx.path+name+'/',parent:ctx,bindings};
  }
  function follow(ctx,source) {
    if (!source) throw new RangeError('Unknown graph tap binding');
    if (source.kind==='node') visit(ctx,source.id,source.port);
    if (source.kind!=='input') return;
    if (ctx.parent && ctx.bindings[source.id]) follow(ctx.parent,ctx.bindings[source.id].source);
    else if (!ctx.parent) {
      const socket=ctx.scope.inputs[source.id];
      if (socket && Object.hasOwn(socket,'default')) inputs[source.id]=compact(socket.default);
    }
  }
  function visit(ctx,name,port) {
    const node=ctx.scope.nodes[name], full=ctx.path+name;
    if (!node || !Object.hasOwn(node.outputs,port)) throw new RangeError('Unknown graph tap '+full+'.'+port);
    const key=JSON.stringify([full,port]);
    if (seen.has(key)) return;
    seen.add(key);
    if (node.groupPaths) {
      for (const binding of Object.values(node.inputs)) follow(ctx,binding.source);
      for (const alias of node.groupPaths) {
        const nested=descend(ctx,name+'/'+alias,node,alias);
        follow(nested,nested.scope.outputs.result);
      }
    } else if (node.groupPath) {
      const nested=descend(ctx,name,node);
      follow(nested,nested.scope.outputs[port]);
    } else for (const binding of Object.values(node.inputs)) follow(ctx,binding.source);
    if (emitted.has(full)) return;
    emitted.add(full);
    const sources=Object.fromEntries(Object.entries(node.inputs).map(([key,{source}])=>[key,compact(source)]));
    if (['audioAsset','jsonAsset','inputAsset','rasterAsset','pngAsset','indexedPngAsset'].includes(node.op)) {
      const ref=node.inputs.name?.source;
      if (ref?.kind==='value' && Object.hasOwn(snapshot.assets,ref.value)) assets[ref.value]=snapshot.assets[ref.value];
      else Object.assign(assets,snapshot.assets);
    }
    chain.push({node:full,op:node.op,inputs:sources,
      ...(node.type!==undefined && {type:node.type}),...(node.seed!==undefined && {seed:node.seed}),
      ...(node.groupPaths ? {groups:node.groupPaths} : node.groupPath && {group:node.groupPath})});
  }
  if (target.output!==undefined) follow(root,root.scope.outputs[target.output]);
  else {
    const parts=target.node.split('/'), name=parts.pop();
    const ctx=parts.reduce((parent,group)=>descend(parent,group,parent.scope.nodes[group] ?? {}),root);
    visit(ctx,name,target.port ?? 'value');
  }
  return {target,chain,inputs,assets};
}
module.exports = {audioTrace};
