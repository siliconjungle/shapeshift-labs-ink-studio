const { fields, record, localName, range, vector, rad } = require('./character-rig-assembly.js');

const requestFormat='ink-studio/character-ik', poseFormat='ink-studio/character-pose';
const axes=[[1,0,0],[0,1,0],[0,0,1]], zero=[0,0,0];
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const degrees=n=>n/rad;

function settings(source, rig, V) {
  if (!fields(source,['format','version','targets','root','initial','iterations','damping']) ||
      source.format!==requestFormat || source.version!==1 || !Array.isArray(source.targets) || source.targets.length>16)
    throw new TypeError('Use a version 1 character IK request with up to 16 targets');
  const {root={},initial={},iterations=72,damping=.065}=source;
  if (!fields(root,['min','max']) || !vector(root.min ?? zero) || !vector(root.max ?? zero) ||
      (root.min ?? zero).some((lo,i)=>lo>0 || (root.max ?? zero)[i]<0) ||
      !range(iterations,1,120) || !Number.isSafeInteger(iterations) || !range(damping,.001,1))
    throw new RangeError('Use root bounds containing zero, 1–120 iterations, and positive damping');
  const names=new Set();
  const targets=source.targets.map(row=>{
    if (!fields(row,['id','joint','at','offset','weight','tolerance','direction']) || !localName(row.id) ||
        names.has(row.id) || !rig.indices.has(row.joint) || row.at===undefined && row.direction===undefined ||
        row.at!==undefined && !vector(row.at) || row.offset!==undefined && (row.at===undefined || !vector(row.offset)) ||
        !range(row.weight ?? 1,.001,1000) || !range(row.tolerance ?? .012,1e-5,10))
      throw new TypeError('Invalid or duplicate character IK target');
    const joint=rig.indices.get(row.joint);
    let direction;
    if (row.direction!==undefined) {
      const d=row.direction;
      if (!fields(d,['local','at','weight','tolerance']) || !vector(d.local) || !vector(d.at) ||
          V.len(d.local)<1e-7 || V.len(d.at)<1e-7 ||
          !range(d.weight ?? 1,.001,1000) || !range(d.tolerance ?? 2,.01,180))
        throw new TypeError('An orientation target needs two nonzero directions and bounded weight and tolerance');
      direction={ local:V.norm(d.local),at:V.norm(d.at),weight:d.weight ?? 1,tolerance:d.tolerance ?? 2 };
    }
    names.add(row.id);
    return {id:row.id,joint,at:row.at,offset:row.offset ?? zero,weight:row.weight ?? 1,tolerance:row.tolerance ?? .012,direction};
  });
  return {targets,initial,iterations,damping,root:{min:root.min ?? zero,max:root.max ?? zero}};
}

function start(rig, initial, bounds) {
  if (!fields(initial,['angles','root']) || !record(initial.angles ?? {}) || !vector(initial.root ?? zero))
    throw new TypeError('Initial pose needs named joint angles and an optional root translation');
  const values=new Float64Array(rig.parameters.length+3), angles=initial.angles ?? {};
  for (const [id,row] of Object.entries(angles)) {
    const joint=rig.joints[rig.indices.get(id)];
    if (!joint || !vector(row,joint.dofs.length,-180,180))
      throw new RangeError('Invalid initial joint angles for '+id);
    for (const [i,slot] of joint.dofs.entries()) {
      const {min,max}=rig.parameters[slot], angle=row[i]*rad;
      if (!range(angle,min-1e-12,max+1e-12)) throw new RangeError('Initial angle outside joint limit at '+id);
      values[slot]=clamp(angle,min,max);
    }
  }
  const root=initial.root ?? zero;
  for (let i=0;i<3;i++) if (bounds && !range(root[i],bounds.min[i],bounds.max[i]))
    throw new RangeError('Initial root translation is outside the requested limits');
  values.set(root,rig.parameters.length);
  return values;
}

function forward(rig, values, { V, M }) {
  const positions=[], rotations=[], worldAxes=[];
  const root=Array.from(values.subarray(rig.parameters.length));
  for (const joint of rig.joints) {
    const parent=joint.parent, base=parent<0 ? M.id() : rotations[parent];
    const position=parent<0 ? V.add(joint.at,root) : V.add(positions[parent],M.app(base,joint.offset));
    let rotation=base;
    for (const slot of joint.dofs) {
      const {axis}=rig.parameters[slot];
      worldAxes[slot]=M.app(rotation,axis);
      rotation=M.mul(rotation,M.rot(axis,values[slot]));
    }
    positions.push(position);
    rotations.push(rotation);
  }
  return {positions,rotations,worldAxes,root};
}

function evaluate(rig, pose, targets, K, jacobian) {
  const {V,M}=K, {positions,rotations,worldAxes}=pose, count=rig.parameters.length;
  const rows=[], errors=[], receipts=[];
  let score=0;
  function add(error, mass, joint, pivot, direction=false) {
    const weight=Math.sqrt(mass);
    score+=V.dot(error,error)*mass;
    if (!jacobian) return;
    const block=axes.map(()=>new Float64Array(count+3));
    for (let i=joint;i>=0;i=rig.joints[i].parent) for (const slot of rig.joints[i].dofs) {
      const lever=direction?pivot:V.sub(pivot,positions[i]), deriv=V.cross(worldAxes[slot],lever);
      for (let c=0;c<3;c++) block[c][slot]=deriv[c]*weight;
    }
    if (!direction) for (let c=0;c<3;c++) block[c][count+c]=weight;
    rows.push(...block);
    errors.push(...error.map(n=>n*weight));
  }
  for (const target of targets) {
    const {id,joint,at,offset,weight,tolerance,direction}=target, R=rotations[joint];
    const row={id,joint:rig.joints[joint].id,passed:true};
    if (at) {
      const point=V.add(positions[joint],M.app(R,offset)), error=V.sub(at,point), residual=V.len(error);
      row.position={at,actual:point,residual,tolerance,weight};
      row.passed&&=residual<=tolerance;
      add(error,weight,joint,point);
    }
    if (direction) {
      const from=M.app(R,direction.local), to=direction.at, turn=V.cross(from,to);
      const angle=Math.atan2(V.len(turn),clamp(V.dot(from,to),-1,1));
      const axis=V.norm(turn,V.perp(from)), tangent=V.mul(V.cross(axis,from),angle);
      row.direction={at:to,actual:from,residualDegrees:degrees(angle),toleranceDegrees:direction.tolerance,weight:direction.weight};
      row.passed&&=row.direction.residualDegrees<=direction.tolerance;
      add(tangent,direction.weight,joint,from,true);
    }
    receipts.push(row);
  }
  return {score,rows,errors,targets:receipts,passed:receipts.every(row=>row.passed)};
}

function dampedStep(rows, errors, free, damping) {
  const n=rows.length, lower=Array.from({length:n},()=>new Float64Array(n));
  // Cholesky factor of the damped task-space normal matrix.
  for (let i=0;i<n;i++) for (let j=0;j<=i;j++) {
    let sum=i===j ? damping*damping : 0;
    for (const k of free) sum+=rows[i][k]*rows[j][k];
    for (let k=0;k<j;k++) sum-=lower[i][k]*lower[j][k];
    lower[i][j]=i===j?Math.sqrt(Math.max(sum,1e-16)):sum/lower[j][j];
  }
  const effort=Float64Array.from(errors);
  for (let i=0;i<n;i++) {
    for (let j=0;j<i;j++) effort[i]-=lower[i][j]*effort[j];
    effort[i]/=lower[i][i];
  }
  for (let i=n-1;i>=0;i--) {
    for (let j=i+1;j<n;j++) effort[i]-=lower[j][i]*effort[j];
    effort[i]/=lower[i][i];
  }
  const step=new Float64Array(rows[0]?.length ?? 0);
  for (const k of free) for (let i=0;i<n;i++) step[k]+=rows[i][k]*effort[i];
  return step;
}

function bendSeed(rig, values, result, available, limits, targets, K) {
  const candidates=available.filter(i=>i<rig.parameters.length && result.rows.some(row=>Math.abs(row[i])>1e-7)).slice(-24);
  let best;
  // A straight chain can have no first-order shortening direction.
  for(const i of candidates) for(const angle of [.105,-.105]) {
    const next=values.slice(), {min,max}=limits[i];
    next[i]=clamp(next[i]+angle,min,max);
    if(Math.abs(next[i]-values[i])<1e-8)continue;
    const pose=forward(rig,next,K), score=evaluate(rig,pose,targets,K,false).score;
    if(!best||score<best.score)best={values:next,pose,score};
  }
  return best && best.score<=result.score+Math.max(.03,.05*result.score) ? best : undefined;
}

function formatted(rig, values, pose, K, bounds) {
  const { V, M }=K, angles={}, joints={};
  let maxBoneDrift=0;
  for (const [i,joint] of rig.joints.entries()) {
    const position=pose.positions[i], R=pose.rotations[i], parent=joint.parent;
    const length=parent<0?0:V.dist(position,pose.positions[parent]);
    maxBoneDrift=Math.max(maxBoneDrift,Math.abs(length-joint.length));
    angles[joint.id]=joint.dofs.map(slot=>degrees(values[slot]));
    joints[joint.id]={position,rest:joint.at,parent:parent<0?null:rig.joints[parent].id,restLength:joint.length,length,
      matrix:[...R,...V.sub(position,M.app(R,joint.at))], limit:joint.limit,
      angles:joint.dofs.map(slot=>{
        const { min,max }=rig.parameters[slot], angle=values[slot];
        return {degrees:degrees(angle),min:degrees(min),max:degrees(max),
          atMin:Math.abs(angle-min)<1e-7,atMax:Math.abs(angle-max)<1e-7};
      })};
  }
  return {format:poseFormat,version:1,rig:rig.id,rigHash:rig.hash,rootTranslation:pose.root,
    ...(bounds&&{rootBounds:bounds}),angles,joints,maxBoneDrift};
}

function solvePlan(rig, plan, K) {
  const {targets,root,damping}=plan, count=rig.parameters.length, started=start(rig,plan.initial,root);
  const limits=[...rig.parameters,...axes.map((_,i)=>({min:root.min[i],max:root.max[i]}))];
  const available=limits.flatMap(({min,max},i)=>max-min>1e-10?[i]:[]);
  let values=started, pose=forward(rig,values,K), result=evaluate(rig,pose,targets,K,true), iterations=0, reseeds=0;
  let best={values,pose,result};
  const initialError=result.score;
  while (!result.passed && iterations<plan.iterations && available.length) {
    let step=dampedStep(result.rows,result.errors,available,damping);
    const free=available.filter(i=>!(values[i]<=limits[i].min+1e-8&&step[i]<0 ||
      values[i]>=limits[i].max-1e-8&&step[i]>0));
    if (free.length!==available.length) step=dampedStep(result.rows,result.errors,free,damping);
    const stepRatio=Math.max(1,...step.map((n,i)=>Math.abs(n)/(i < count ? .31 : .24)));
    let accepted=false;
    for (let scale=1;scale>=1/128;scale*=.5) {
      const next=values.map((n,i)=>clamp(n+scale*step[i]/stepRatio,limits[i].min,limits[i].max));
      const trial=forward(rig,next,K), measured=evaluate(rig,trial,targets,K,false);
      if (measured.score>=result.score-1e-14) continue;
      values=next;
      pose=trial;
      result=evaluate(rig,pose,targets,K,true);
      accepted=true;
      break;
    }
    iterations++;
    if (!accepted) {
      const seed=reseeds<2 && bendSeed(rig,values,result,available,limits,targets,K);
      if(!seed)break;
      ({values,pose}=seed);
      result=evaluate(rig,pose,targets,K,true);
      reseeds++;
    }
    if(result.score<best.result.score)best={values,pose,result};
  }
  if(!result.passed && best.result.score<result.score)({values,pose,result}=best);
  return {...formatted(rig,values,pose,K,root),solve:{passed:result.passed,iterations,reseeds,initialError,error:result.score,
    status:result.passed?'converged':'unmet-targets',targets:result.targets}};
}

function solve(rig, request, K) {
  return solvePlan(rig,settings(request,rig,K.V),K);
}

function solveMotion(rig, targets, initial, allowance, K) {
  const plan=settings({format:requestFormat,version:1,targets,initial},rig,K.V);
  plan.root={
    min:initial.root.map((n,i)=>Math.max(-10000,n-allowance[i])),
    max:initial.root.map((n,i)=>Math.min(10000,n+allowance[i]))
  };
  return solvePlan(rig,plan,K);
}

function openPose(rig, source, K) {
  if (!source || source.format!==poseFormat || source.version!==1 || source.rigHash!==rig.hash)
    throw new RangeError('Character pose does not match the assembled rig revision');
  if (!record(source.angles) || !vector(source.rootTranslation) ||
      Object.keys(source.angles).length!==rig.joints.length)
    throw new RangeError('Saved character pose needs every joint angle and a root translation');
  const values=start(rig,{angles:source.angles,root:source.rootTranslation});
  return formatted(rig,values,forward(rig,values,K),K);
}

module.exports={solve,solveMotion,openPose};
