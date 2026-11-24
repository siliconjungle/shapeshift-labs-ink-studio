'use strict';

const Meshes = require('../src/scene-meshes.js');

function source(world,{mesh,material},binding) {
  const selected=world.meshes?.find(row=>row.id===mesh && row.objectId===binding.object &&
    (binding.part===undefined || row.partId===binding.part));
  if (!selected) throw new RangeError('Registered scan mesh is outside the bound object or part: '+mesh);
  return Meshes.scanMaterial(selected,material);
}

const record=(value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).every(key=>keys.includes(key));

function apply(world,destination,info,operation,pigment) {
  if (!record(operation,['texels']) || !Array.isArray(operation.texels) || !operation.texels.length ||
      operation.texels.length>4096)
    throw new TypeError('Scan material paint needs 1–4096 explicit texels');
  const {mesh,material}=destination, {width,height,registration}=info;
  const previous=world.look?.scanPaint;
  Meshes.paintMeshes(world.meshes,previous);
  const edits=previous?.edits?.slice()??[];
  const slot=edits.findIndex(row=>row.mesh===mesh && row.material===material);
  const key=at=>at[1]*width+at[0];
  const saved=new Map(edits[slot]?.texels.map(row=>[key(row.at),row]));
  const touched=new Set(), hits=[];
  for (const change of operation.texels) {
    if (!record(change,['at','pigment','roughness','normal']))
      throw new TypeError('Invalid scan material edit');
    const {at}=change, channels=['pigment','roughness','normal'].filter(name=>change[name]!==undefined);
    if (!Array.isArray(at) || at.length!==2 || !Array.from(at).every((n,i)=>Number.isInteger(n) && n>=0 && n<[width,height][i]) ||
        !channels.length || touched.has(key(at)))
      throw new RangeError('Scan paint needs unique in-bounds texels and at least one material channel');
    const index=key(at), values={...saved.get(index),at};
    touched.add(index);
    for (const name of channels) {
      const value=change[name];
      if (value===null) delete values[name];
      else values[name]=name==='pigment' ? pigment(value) : value;
    }
    if (Object.keys(values).length>1) saved.set(index,values);
    else saved.delete(index);
    hits.push({at,channels});
  }
  const texels=Array.from(saved.values()).sort((a,b)=>key(a.at)-key(b.at));
  if (slot>=0) edits.splice(slot,1);
  if (texels.length) edits.splice(slot<0 ? edits.length : slot,0,{mesh,material,registration,texels});
  const asset={format:'ink-studio/scan-paint',version:1,edits};
  Meshes.paintMeshes(world.meshes,asset);
  return {asset,hits};
}

module.exports={source,apply};
