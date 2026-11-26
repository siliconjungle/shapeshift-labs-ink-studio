function build(rows, { V, procedural:{spatial} }) {
  const lookup=spatial.pointIndex(rows);
  return function nearest(origin,direction,range,epsilon,accept,count,tolerance=0) {
    let hit, distance=range;
    const candidates=tolerance>0?[]:null;
    lookup.ray(origin,direction,range,row=>{
      if(!accept(row))return;
      count();
      const h=V.cross(direction,row.ac), det=V.dot(row.ab,h);
      if(Math.abs(det)<=row.epsilon)return;
      const offset=V.sub(origin,row.a), u=V.dot(offset,h)/det;
      if(u < -1e-8 || u > 1+1e-8)return;
      const q=V.cross(offset,row.ab), v=V.dot(direction,q)/det;
      if(v < -1e-8 || u+v > 1+1e-8)return;
      const t=V.dot(row.ac,q)/det;
      if(t<=epsilon||t>range||t>distance+tolerance)return;
      if(candidates&&(t<distance-tolerance))candidates.length=0;
      if(candidates)candidates.push({row,distance:t});
      if(t<distance||t===distance&&(!hit||row.face<hit.face)) {
        distance=t;
        hit=row;
      }
    });
    return hit&&{row:hit,distance,...(candidates&&{ties:candidates.filter(candidate=>candidate.distance<=distance+tolerance)})};
  };
}

module.exports={build};
