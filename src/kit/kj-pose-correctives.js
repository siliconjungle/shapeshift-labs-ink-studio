/* Local sculpt offsets driven by the relative rotation of named puppet joints. */
(function (K) {
  const { M,V }=K, rigs=new WeakMap();
  const identity=[1,0,0,0,1,0,0,0,1], format='ink-studio/pose-corrective';
  const maxRows=4096, maxLayers=32, maxBones=65535;
  const record=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
  const name=value=>typeof value==='string'&&value.trim().length>0&&value.length<=128;
  const vector=(value,n)=>Array.isArray(value)&&value.length===n&&Array.from(value).every(Number.isFinite);
  const invertible=A=>Math.abs(M.det(A))>1e-9;
  function check(condition,message) {
    if (!condition) throw new RangeError('Pose corrective: '+message);
  }
  function angle(a,b) {
    let dot=0;
    for (let i=0;i<9;i++) dot+=a[i]*b[i];
    return Math.acos(K.clamp((dot-1)*.5,-1,1));
  }
  function rotation(value) {
    if (!vector(value,9) || Math.abs(M.det(value)-1)>.001) return false;
    const gram=M.mul(M.tr(value),value);
    return gram.every((n,i)=>Math.abs(n-identity[i])<.001);
  }
  function driver(part) {
    return M.polar(part.rotation);
  }
  const scaleFor=degrees=>degrees*Math.PI/180;
  function weight(joints, motions) {
    let distance2=0;
    for (const {part,at,radius} of joints) distance2+=(angle(motions.get(part),at)/scaleFor(radius))**2;
    const t=1-Math.min(1,Math.sqrt(distance2));
    return t*t*(3-2*t);
  }
  function brush(strokes) {
    check(Array.isArray(strokes)&&strokes.length>0&&strokes.length<=64,'provide 1–64 posed sculpt strokes');
    return Array.from(strokes,row=>{
      check(record(row)&&vector(row.at,3)&&vector(row.move,3)&&Number.isFinite(row.radius)&&
        row.radius>=.0001&&row.radius<=100&&V.len(row.move)<=row.radius,'brush needs at, move and a radius; move must fit inside it');
      return {at:row.at.slice(),move:row.move.slice(),radius:row.radius};
    });
  }
  function sculpt(point,strokes) {
    const delta=[0,0,0], change=Array(9).fill(0);
    let touched=false;
    for (const {at,move,radius} of strokes) {
      const d=V.sub(point,at), r2=radius*radius, inside=1-V.dot(d,d)/r2;
      if (inside<=0 || !move.some(Boolean)) continue;
      touched=true;
      const amount=inside*inside, slope=-4*inside/r2;
      for (let i=0;i<3;i++) {
        delta[i]+=move[i]*amount;
        for (let j=0;j<3;j++) change[3*i+j]+=move[i]*slope*d[j];
      }
    }
    return touched ? {delta,change} : null;
  }

  function bind(world,puppet,data) {
    let layers=[], rows=new Map(), buffer, base=puppet.bones, weights=[], driverNames=[];
    const meshBindings=new Map();
    function mapping(joints, slots) {
      check(Array.isArray(joints)&&joints.every(joint=>puppet.names.includes(joint)||Object.hasOwn(slots??{},joint)),
        'mesh joints need a named puppet part or an explicit bone slot');
      const order=joints.map(joint=>Object.hasOwn(slots??{},joint)?slots[joint]:puppet.parts[joint].first);
      check(order.every(i=>Number.isSafeInteger(i)&&i>=0&&i<puppet.bones.length/12),'invalid mesh bone slot');
      return order;
    }
    const sampleRotations=()=>Object.fromEntries(puppet.names.map(name=>[name,driver(puppet.parts[name])]));
    const meshMatrices=(bones,order)=>order.flatMap(i=>Array.from(bones.subarray(i*12,i*12+12)));
    function meshPose(joints,{bones}={}) {
      return {matrices:meshMatrices(puppet.bones,mapping(joints,bones)),rotations:sampleRotations()};
    }
    function attachMesh(binding,{bones}={}) {
      check(binding?.mesh&&Array.isArray(binding.drivers)&&Array.isArray(binding.joints)&&typeof binding.pose==='function'&&
        binding.drivers.every(name=>puppet.names.includes(name))&&![...meshBindings.keys()].some(row=>row.mesh===binding.mesh),
        'attach a distinct mesh shape-key binding driven by named puppet parts');
      const order=mapping(binding.joints,bones);
      binding.pose(meshMatrices(puppet.bones,order),{rotations:sampleRotations()});
      meshBindings.set(binding,order);
      return ()=>meshBindings.delete(binding);
    }
    const currentKind=i=>Math.round(data[i*16+11])%16;
    const skin=i=>currentKind(i)===12||currentKind(i)===13;
    function rest(i) {
      const q=i*16;
      return rows.get(i)?.rest ?? [data[q],data[q+1],data[q+2],data[q+12],data[q+13],data[q+14]];
    }
    function column(bones,i) {
      const at=i*12;
      return { A:bones.subarray(at,at+9),t:bones.subarray(at+9,at+12) };
    }
    function position(bones,[x,y,z,bone,second,blend]) {
      const p=[x,y,z], a=column(bones,bone), b=blend&&column(bones,second);
      const first=V.add(M.app(a.A,p),a.t);
      return blend ? V.lerp(first,V.add(M.app(b.A,p),b.t),blend) : first;
    }
    function joints(authored,capturing) {
      const known=new Set();
      check(Array.isArray(authored)&&authored.length>0&&authored.length<=8,'provide 1–8 driving joints');
      return Array.from(authored,row=>{
        check(record(row)&&name(row.part)&&puppet.names.includes(row.part)&&!known.has(row.part)&&
          Number.isFinite(row.radius)&&row.radius>0&&row.radius<=180,'drivers need distinct part names and radii in degrees');
        known.add(row.part);
        const at=capturing?driver(puppet.parts[row.part]):row.at;
        check(rotation(at),'invalid captured joint rotation');
        return { part:row.part,radius:row.radius,at:Array.from(at) };
      });
    }
    function capture(definition={}) {
      check(record(definition)&&name(definition.id),'capture needs a corrective name');
      const {id,drivers:authored,select,strokes:paint}=definition;
      const selector=select===undefined ? null : TargetSelectors.prepare(select);
      const strokes=brush(paint), labels=selector&&TargetSelectors.index(world), edits=[];
      puppet.flush();
      const jointPose=joints(authored,true);
      for (const i of puppet.anim.boned) {
        if (!skin(i)||puppet.anim.physicsOwned?.[i]||selector&&!TargetSelectors.matches(selector,labels.row(i))) continue;
        const original=rest(i), field=sculpt(position(puppet.bones,original),strokes);
        if (!field) continue;
        const {A}=column(puppet.bones,original[3]);
        check(invertible(A),'the selected shape needs an invertible bone at the target pose');
        const J=identity.map((n,k)=>n+field.change[k]);
        check(M.det(J)>1e-4,'the sculpt folds geometry over; increase the brush radius or reduce its move');
        const inverse=M.inv(A);
        edits.push({ index:i,rest:original.slice(),delta:M.app(inverse,field.delta),
          gradient:M.mul(inverse,M.mul(field.change,A)) });
        check(edits.length<=maxRows,'a corrective can affect up to '+maxRows+' splats');
      }
      check(edits.length,'the sculpt did not reach a selected skinned splat');
      return { format,version:1,id,joints:jointPose,rows:edits,sculpt:{ ...(selector&&{select:{...selector}}),strokes } };
    }

    function set(authored) {
      check(Array.isArray(authored)&&authored.length<=maxLayers,'provide up to '+maxLayers+' correction layers');
      for (const {index,first,second} of rows.values())
        check(skin(index)&&!puppet.anim.physicsOwned?.[index]&&data[index*16+12]===first&&data[index*16+13]===second,
          'restore detached or re-bound splats before replacing their correction layers');
      const known=new Set(), editable=new Set(puppet.anim.boned), next=new Map();
      let index=puppet.bones.length/12;
      const compiled=Array.from(authored,(asset,slot)=>{
        check(record(asset)&&asset.format===format&&asset.version===1&&name(asset.id)&&!known.has(asset.id),
          'invalid or duplicate correction asset');
        known.add(asset.id);
        const jointPose=joints(asset.joints,false), seen=new Set();
        check(Array.isArray(asset.rows)&&asset.rows.length>0&&asset.rows.length<=maxRows,'invalid correction rows');
        for (const row of asset.rows) {
          check(record(row)&&Number.isSafeInteger(row.index)&&editable.has(row.index)&&skin(row.index)&&
            !puppet.anim.physicsOwned?.[row.index]&&!seen.has(row.index)&&vector(row.rest,6)&&
            vector(row.delta,3)&&vector(row.gradient,9)&&row.delta.every(n=>Math.abs(n)<=1000)&&
            row.gradient.every(n=>Math.abs(n)<=1000),'invalid or unavailable skinned correction row');
          const i=row.index, original=rest(i);
          check(original.every((v,k)=>v===row.rest[k]),'the saved sculpt belongs to a different bake or skin binding at row '+i);
          seen.add(i);
          if (!next.has(i)) {
            const first=index++,second=original[5] ? index++ : 0;
            next.set(i,{index:i,rest:original,first,second,edits:[]});
          }
          next.get(i).edits.push({ slot,delta:row.delta.slice(),gradient:row.gradient.slice() });
        }
        return {...structuredClone(asset),joints:jointPose};
      });
      check(next.size<=maxRows&&index<=maxBones,'combined corrective skin exceeds its row or bone budget');
      const table=next.size ? new Float32Array(index*12) : undefined;
      function retag(i,a,b) {
        data[i*16+12]=a;
        data[i*16+13]=b;
        puppet.anim.rows[i>>9]=1;
      }
      for (const {index:i,rest:original} of rows.values()) retag(i,original[3],original[4]);
      for (const row of next.values()) retag(row.index,row.first,row.second);
      [layers,rows,buffer]=[compiled,next,table];
      driverNames=[...new Set(layers.flatMap(layer=>layer.joints.map(joint=>joint.part)))];
      refresh(base);
      return editor;
    }

    function writeBone(output,i,A,t) {
      output.set(A,i*12);
      output.set(t,i*12+9);
    }
    function apply(bones,output) {
      output.set(bones);
      for (const row of rows.values()) {
        const [x,y,z,bone,secondary,blend]=row.rest, p=[x,y,z];
        const {A,t}=column(bones,bone), b=blend&&column(bones,secondary);
        const delta=[0,0,0], change=Array(9).fill(0);
        let total=0;
        if (!puppet.anim.physicsOwned?.[row.index]) for (const edit of row.edits) {
          const w=weights[edit.slot];
          if (!w) continue;
          total+=w;
          for (let c=0;c<3;c++) delta[c]+=w*edit.delta[c];
          for (let c=0;c<9;c++) change[c]+=w*edit.gradient[c];
        }
        if (!total || !invertible(A)) {
          writeBone(output,row.first,A,t);
          if (blend) writeBone(output,row.second,b.A,b.t);
          continue;
        }
        const gain=1/Math.max(1,total);
        const move=V.mul(delta,gain);
        let J=identity.map((n,i)=>n+gain*change[i]);
        if (M.det(J)<=1e-4) J=identity;
        const first=M.mul(A,J), shift=M.app(A,move);
        writeBone(output,row.first,first,V.sub(V.add(V.add(t,shift),M.app(A,p)),M.app(first,p)));
        if (blend) {
          const second=M.mul(M.mul(first,M.inv(A)),b.A);
          writeBone(output,row.second,second,V.sub(V.add(V.add(b.t,shift),M.app(b.A,p)),M.app(second,p)));
        }
      }
      return output;
    }
    function frame(bones) {
      base=bones;
      if (meshBindings.size) {
        const rotations=sampleRotations();
        for (const [binding,order] of meshBindings) binding.pose(meshMatrices(bones,order),{rotations});
      }
      if (!buffer) { weights=[]; return bones; }
      const snapshots=new Map(driverNames.map(part=>[part,driver(puppet.parts[part])]));
      weights=layers.map(layer=>weight(layer.joints,snapshots));
      return apply(bones,buffer);
    }
    function viewFrame(bones) {
      return buffer ? apply(bones,new Float32Array(buffer.length)) : bones;
    }
    function refresh(bones) {
      puppet.anim.bones=frame(bones);
      if (world.rest===data&&world.data!==data)
        world.data=world.posedBuf=K.bones.posed({ data,anim:puppet.anim,posedBuf:world.posedBuf });
    }
    const editor=Object.freeze({
      capture,set,meshPose,attachMesh,
      get size() { return layers.length; },
      assets:()=>structuredClone(layers),
      state:()=>layers.map(({id,rows},i)=>({id,rows:rows.length,weight:weights[i]??0}))
    });
    rigs.set(world,editor);
    return {editor,frame,refresh,viewFrame,hasMeshes:()=>meshBindings.size>0};
  }

  K.poseCorrectives=Object.freeze({ bind, forWorld:world=>rigs.get(world),
    kernel:Object.freeze({rotation,weight,brush,sculpt}) });
})(KIT);
