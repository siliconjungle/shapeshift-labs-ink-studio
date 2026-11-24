// Polygon classification for closed, consistently oriented mesh solids.
const meshBooleanBsp = (function(K) {
  const { V }=K;
  const reverse=poly=>({ ...poly, points:poly.points.slice().reverse(),
    normal:V.mul(poly.normal,-1),offset:-poly.offset,flipped:!poly.flipped });
  const mix=(a,b,t)=>({ p:V.lerp(a.p,b.p,t),weights:V.lerp(a.weights,b.weights,t) });

  function solve(a,b,operation,tolerance,maxWork) {
    let work=0;
    function charge(n) {
      work+=n;
      if (work>maxWork) throw new RangeError('Mesh Boolean polygon work exceeded its budget');
    }
    function split(plane,poly,aligned,opposed,front,back) {
      charge(poly.points.length);
      const distances=poly.points.map(({p})=>V.dot(plane.normal,p)-plane.offset);
      const sides=distances.map(n=>n>tolerance ? 1 : n < -tolerance ? -1 : 0);
      const positive=sides.includes(1),negative=sides.includes(-1);
      if (!positive && !negative) {
        (V.dot(plane.normal,poly.normal)>0 ? aligned : opposed).push(poly);
      } else if (!negative || !positive) {
        (positive ? front : back).push(poly);
      } else {
        const f=[],r=[];
        for (const [i,point] of poly.points.entries()) {
          const j=(i+1)%poly.points.length;
          if (sides[i]>=0) f.push(point);
          if (sides[i]<=0) r.push(point);
          if (sides[i]*sides[j]<0) {
            const cross=mix(point,poly.points[j],distances[i]/(distances[i]-distances[j]));
            f.push(cross); r.push(cross);
          }
        }
        front.push({...poly,points:f});
        back.push({...poly,points:r});
      }
    }
    function build(polys,depth=0,node={polys:[]}) {
      if (!polys.length) return node;
      if (depth>160) throw new RangeError('Mesh Boolean plane tree exceeded its depth budget');
      const front=[],back=[];
      node.plane ??= polys[0];
      for (const poly of polys) split(node.plane,poly,node.polys,node.polys,front,back);
      if (front.length) node.front=build(front,depth+1,node.front);
      if (back.length) node.back=build(back,depth+1,node.back);
      return node;
    }
    function invert(node) {
      node.polys=node.polys.map(reverse);
      if (node.plane) node.plane=reverse(node.plane);
      if (node.front) invert(node.front);
      if (node.back) invert(node.back);
      [node.front,node.back]=[node.back,node.front];
    }
    function clip(node,polys) {
      if (!node.plane) return polys;
      const front=[],back=[];
      for (const poly of polys) split(node.plane,poly,front,back,front,back);
      return [...(node.front ? clip(node.front,front) : front),...(node.back ? clip(node.back,back) : [])];
    }
    function trim(target,solid) {
      target.polys=clip(solid,target.polys);
      if (target.front) trim(target.front,solid);
      if (target.back) trim(target.back,solid);
    }
    function gather(node,out=[]) {
      for (const poly of node.polys) out.push(poly);
      if (node.front) gather(node.front,out);
      if (node.back) gather(node.back,out);
      return out;
    }

    const left=build(a),right=build(b);
    if (operation==='intersection') {
      invert(left);
      trim(right,left);
      invert(right);
      trim(left,right);
      trim(right,left);
      build(gather(right),0,left);
      invert(left);
    } else {
      if (operation==='difference') invert(left);
      trim(left,right);
      trim(right,left);
      invert(right);
      trim(right,left);
      invert(right);
      build(gather(right),0,left);
      if (operation==='difference') invert(left);
    }
    return {polys:gather(left),work};
  }

  return {solve,mix};
})(KIT);
