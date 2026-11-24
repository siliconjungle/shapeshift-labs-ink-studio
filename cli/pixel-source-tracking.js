'use strict';

const Provenance = require('../src/splat-provenance.js');

const meshKey = (source,triangle = source.triangle)=>JSON.stringify(['mesh',source.object,source.part,
  source.asset,source.chart,source.stageSlot,source.primitive,triangle]);

function capture(world,meshes,fields,frames,{ X,Y,Z,AL,rayAt,V,W,H,focal,ortho,near,far }) {
  const poses = new Map();
  let ids;
  function splat(id) {
    if (!poses.has(id)) {
      ids ??= Provenance.identities(world);
      const i = ids.rowOf(id);
      if (i < 0 || !(AL[i] > 0)) poses.set(id,null);
      else poses.set(id,{ center:[X[i],Y[i],Z[i]],frame:frames(i) });
    }
    return poses.get(id);
  }
  function project([x,y,z]) {
    const depth = -(V[2]*x+V[6]*y+V[10]*z+V[14]);
    if (depth < near || depth > far) return null;
    const scale = focal/(ortho ? 1 : depth);
    return [W/2+(V[0]*x+V[4]*y+V[8]*z+V[12])*scale,
      H/2-(V[1]*x+V[5]*y+V[9]*z+V[13])*scale,depth];
  }
  return {
    localSplat(source,x,y) {
      const pose = splat(source.id);
      if (!pose || !Number.isFinite(source.depth)) return null;
      const { origin,direction,axial } = rayAt(x+.5,H-y-.5);
      const offset = origin.map((n,i)=>n+direction[i]*source.depth/axial-pose.center[i]);
      return pose.frame.localOffset(...offset);
    },
    projectSplat(id,local) {
      const pose = splat(id);
      if (!pose) return null;
      const { anchor } = pose.frame.basis();
      return project(pose.center.map((n,i)=>n+local.reduce((sum,value,j)=>sum+anchor[i*3+j]*value,0)));
    },
    meshSignature:key=>meshes.get(key)?.signature,
    projectMesh(key,weights,signature) {
      const mesh = meshes.get(key);
      return mesh && mesh.signature === signature ? mesh.project(weights) : null;
    },
    projectSdf(field,rest) {
      const point = fields.get(JSON.stringify(field))?.(rest);
      return point ? project(point) : null;
    }
  };
}

module.exports = { capture,meshKey };
