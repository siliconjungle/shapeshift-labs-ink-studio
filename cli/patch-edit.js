const fs = require('node:fs');
const path = require('node:path');
const { createGraphProject } = require('./graph-project.js');
const io = require('./asset-files.js');
const id = value => typeof value==='string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
  !['constructor','prototype','__proto__'].includes(value);
const plain = value => value && Object.getPrototypeOf(value)===Object.prototype;
const expectId = (value,label) => {
  if (!id(value)) throw new TypeError('Invalid '+label+' '+value);
  return value;
};
const root = file => JSON.parse(fs.readFileSync(file,'utf8'));
const empty = () => ({format:'ink-studio/graph-project',version:1,inputs:{},nodes:{},outputs:{}});

function endpoint(value) {
  if (typeof value!=='string') throw new TypeError('Expected a patch endpoint');
  if (value.startsWith('@')) return {input:expectId(value.slice(1),'graph input')};
  if (value.startsWith('$')) return {output:expectId(value.slice(1),'graph output')};
  const [node,port='value',extra]=value.split(':');
  if (extra!==undefined || !node.split('/').every(id) || !id(port))
    throw new TypeError('Expected node[:port], @input or $output, received '+value);
  return {node,port};
}

function setInput(graph,to,value) {
  const target=endpoint(to);
  if (target.output) { graph.outputs[target.output]=value; return; }
  if (!target.node || !id(target.node) || !Object.hasOwn(graph.nodes,target.node) || !to.includes(':'))
    throw new TypeError('Patch destination must be an existing node:input or $output');
  const node=graph.nodes[target.node];
  (node.inputs??={})[target.port]=value;
}

function fromPort(from) {
  const link=endpoint(from);
  if (link.output || link.node?.includes('/')) throw new TypeError('Wires originate at @input or a top-level node:port');
  return link;
}

function lock(file, action) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const lease=file+'.ink-edit-lock';
  let handle;
  try { handle=fs.openSync(lease,'wx'); }
  catch (error) {
    if (error.code==='EEXIST') throw new Error('Patch is already locked for editing: '+file);
    throw error;
  }
  try { return action(); }
  finally { fs.closeSync(handle); fs.unlinkSync(lease); }
}

function init(file) {
  const full=path.resolve(file);
  return lock(full,()=>{
    if (fs.existsSync(full)) throw new Error('Patch already exists: '+full);
    io.json(full,empty());
    return {file:full};
  });
}

function apply(file, edits, { out=file, settings }={}) {
  const source=path.resolve(file), target=path.resolve(out);
  if (!Array.isArray(edits) || !edits.length || edits.length>2000)
    throw new TypeError('Patch edits need an array of 1 to 2,000 operations');
  return lock(target,()=>{
    if (source!==target && fs.existsSync(target)) throw new Error('Patch output already exists: '+target);
    const graph=root(source);
    if (graph?.format!=='ink-studio/graph-project' || graph.version!==1 || !plain(graph.nodes) || !plain(graph.outputs))
      throw new TypeError('Patch edits require an editable graph-project version 1 file');
    graph.inputs??={};
    for (const edit of edits) {
      if (!plain(edit)) throw new TypeError('Expected a patch edit object');
      const {op,id:name,to,from,value}=edit;
      switch (op) {
        case 'add': {
          expectId(name,'node ID');
          if (Object.hasOwn(graph.nodes,name) || !plain(edit.node)) throw new TypeError('Invalid or duplicate patch node '+name);
          graph.nodes[name]=structuredClone(edit.node);
          break;
        }
        case 'remove':
          expectId(name,'node ID');
          if (!Object.hasOwn(graph.nodes,name)) throw new Error('Unknown patch node '+name);
          delete graph.nodes[name];
          break;
        case 'input':
          expectId(name,'input ID');
          if (!plain(edit.socket)) throw new TypeError('Input edits need a typed socket record');
          graph.inputs[name]=structuredClone(edit.socket);
          break;
        case 'wire':
          setInput(graph,to,fromPort(from));
          break;
        case 'set':
          if (!Object.hasOwn(edit,'value')) throw new TypeError('A set edit needs a value');
          setInput(graph,to,{value:structuredClone(value)});
          break;
        case 'bind': {
          expectId(name,'mapping ID');
          if (Object.hasOwn(graph.nodes,name)) throw new Error('Mapping node already exists: '+name);
          const { source, range }=edit;
          if (![source,range].every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(Number.isFinite)) ||
              source[1]<=source[0]) throw new RangeError('Bindings need an ascending source range and a finite output range');
          graph.nodes[name]={ op:'patch.map', inputs:{
            value:fromPort(from),sourceMin:source[0],sourceMax:source[1],min:range[0],max:range[1]
          } };
          setInput(graph,to,{node:name,port:'value'});
          break;
        }
        case 'disconnect': {
          const sink=endpoint(to);
          if (sink.output) delete graph.outputs[sink.output];
          else {
            if (!sink.node || !id(sink.node) || !Object.hasOwn(graph.nodes,sink.node) || !to.includes(':'))
              throw new TypeError('Patch destination must be a node:input or $output');
            delete graph.nodes[sink.node].inputs?.[sink.port];
            delete graph.nodes[sink.node].params?.[sink.port];
          }
          break;
        }
        default: throw new TypeError('Unknown patch edit '+op);
      }
    }
    const project=createGraphProject(graph,{...settings,baseDir:path.dirname(target),sourceFile:target,planAssets:true});
    const report=project.validate();
    io.json(target,graph);
    return {...report,file:target,edits:edits.length};
  });
}

function wiring(plan) {
  const ref = source => source.kind==='node' ? source.id+':'+source.port :
    source.kind==='input' ? '@'+source.id : source.kind==='track' ? 'keyframes' : 'literal/default';
  return [
    ...Object.entries(plan.inputs).map(([name,socket])=>'@'+name+'  ['+socket.type+']'),
    ...plan.nodes.flatMap(node=>[node.id+'  '+node.op,...Object.entries(node.inputs)
      .map(([key,input])=>'  '+key+' ['+input.type+'] <- '+ref(input.source))]),
    ...Object.entries(plan.outputs).map(([name,source])=>'$'+name+' ['+source.type+'] <- '+ref(source))
  ].join('\n');
}

function dot(plan) {
  const esc=JSON.stringify, types=Object.entries(plan.inputs), sources=Object.entries(plan.outputs);
  const origin=source=>source.kind==='input' ? '@'+source.id : source.kind==='node' ? source.id : null;
  function edge(source,target,label) {
    const id=origin(source);
    return id ? ['  '+esc(id)+' -> '+esc(target)+' [label='+esc(label)+'];'] : [];
  }
  return [
    'digraph ink_patch {','  rankdir=LR;',
    ...types.map(([name,socket])=>'  '+esc('@'+name)+' [shape=oval,label='+esc('@'+name+' ['+socket.type+']')+'];'),
    ...plan.nodes.map(node=>'  '+esc(node.id)+' [shape=box,label='+esc(node.id+'\n'+node.op)+'];'),
    ...sources.map(([name,source])=>'  '+esc('$'+name)+' [shape=oval,label='+esc('$'+name+' ['+source.type+']')+'];'),
    ...plan.nodes.flatMap(node=>Object.entries(node.inputs).flatMap(([name,{source,type}])=>
      edge(source,node.id,(source.port ? source.port+' → ' : '')+name+' ['+type+']'))),
    ...sources.flatMap(([name,source])=>edge(source,'$'+name,source.port??source.type)),
    '}'
  ].join('\n');
}
module.exports={apply,init,root,endpoint,wiring,dot};
