/* Orthographic directional shadow maps shared by live sun and PBR materials. */
const DirectionalShadowMap = (() => {
  let curves;
  try { curves=CurveSplat; } catch { curves=require('./curve-splat.js'); }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = v => {
    const length = Math.hypot(...v);
    return v.map(n => n / length);
  };
  const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];

  function covariance(data, i, a, b) {
    const xx=data[i<0?0:i+4], xy=data[i<0?1:i+5], xz=data[i<0?2:i+6],
      yy=data[i<0?3:i+8], yz=data[i<0?4:i+9], zz=data[i<0?5:i+10];
    return a[0] * (xx*b[0] + xy*b[1] + xz*b[2]) +
      a[1] * (xy*b[0] + yy*b[1] + yz*b[2]) +
      a[2] * (xz*b[0] + yz*b[1] + zz*b[2]);
  }

  function build(sun, world, {x,y,z,alpha,scale}, normalAt, casts,
    {curveAt,drawCurves,triangles:sourceTriangles=[],shells:sourceShells=[],covarianceAt,DepthArray=Float64Array}={}) {
    const data=world.data;
    const light = sun.direction;
    const right = unit(cross(Math.abs(light[1]) > .94 ? [0,0,1] : [0,1,0], light));
    const up = cross(light, right);
    const casters = [], strands = new Map();
    const curveCamera = curveAt && { ortho: true, width: 0, height: 0, focal: 1, near: -Infinity,
      view: [0,1,2].flatMap(i => [right[i], up[i], light[i], 0]).concat(0,0,0,1) };
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < alpha.length; i++) {
      const q = i * 16;
      if (y[i] < -30 || casts && !casts(i)) continue;
      const curve = curveAt?.(i, curveCamera);
      if (curve) {
        minU = Math.min(minU, curve.bounds[0]);
        minV = Math.min(minV, curve.bounds[1]);
        maxU = Math.max(maxU, curve.bounds[2]);
        maxV = Math.max(maxV, curve.bounds[3]);
        strands.set(i,curve);
        continue;
      }
      // Opaque surface samples cast. Glass, backdrop art and outline-free particles are excluded.
      if (!(alpha[i]>=1 && Number.isFinite(alpha[i])) || (Math.round(data[q + 11]) & (16 | 64 | 256))) continue;
      const row = covarianceAt?.(i) ?? data, at = row === data ? q : -1;
      const point = [x[i], y[i], z[i]], u = dot(right, point), v = dot(up, point), depth = dot(light, point);
      const s2 = scale[i] ** 2;
      const a = s2 * covariance(row, at, right, right), b = s2 * covariance(row, at, right, up),
        c = s2 * covariance(row, at, up, up);
      if (![u,v,depth,a,b,c].every(Number.isFinite) || a < 0 || c < 0) continue;
      const extent = 2 * Math.log(alpha[i] / .5);
      const du = Math.sqrt(a * extent), dv = Math.sqrt(c * extent);
      minU = Math.min(minU, u - du);
      maxU = Math.max(maxU, u + du);
      minV = Math.min(minV, v - dv);
      maxV = Math.max(maxV, v + dv);
      casters.push({ i, u, v, depth, a, b, c, extent, reach: 2*Math.sqrt(Math.max(0, s2 * covariance(row, at, light, light))) });
    }
    const project = source => {
      const points = source.points.map(point => [dot(right,point),dot(up,point),dot(light,point)]);
      for (const [u,v] of points) {
        minU=Math.min(minU,u);
        minV=Math.min(minV,v);
        maxU=Math.max(maxU,u);
        maxV=Math.max(maxV,v);
      }
      return {...source,points};
    };
    const triangles=sourceTriangles.map(project), shells=sourceShells.map(project);
    if (!casters.length && !strands.size && !triangles.length && !shells.length) return null;
    const guard = sun.filter + 2;
    const texel = Math.max(maxU - minU, maxV - minV, 1e-6) / (sun.mapSize - 2 * guard - 1);
    const width = Math.ceil((maxU - minU) / texel) + 2 * guard;
    const height = Math.ceil((maxV - minV) / texel) + 2 * guard;
    minU -= guard * texel;
    minV -= guard * texel;
    const map = new DepthArray(width * height).fill(-Infinity);
    const minimumVariance = .15 * texel ** 2;

    for (const { i, u, v, depth, a, b, c, extent, reach } of casters) {
      const A = a + minimumVariance, C = c + minimumVariance;
      const det = A * C - b * b;
      if (!(det > 0)) continue;
      const radiusU = Math.sqrt(A * extent), radiusV = Math.sqrt(C * extent);
      const x0 = Math.max(0, Math.ceil((u - radiusU - minU) / texel - .5)),
        x1 = Math.min(width - 1, Math.floor((u + radiusU - minU) / texel - .5)),
        y0 = Math.max(0, Math.ceil((v - radiusV - minV) / texel - .5)),
        y1 = Math.min(height - 1, Math.floor((v + radiusV - minV) / texel - .5));
      const normal = normalAt(i), facing = normal && dot(normal, light);
      const slopeU = Math.abs(facing) >= .09 ? -dot(normal, right) / facing : 0;
      const slopeV = Math.abs(facing) >= .09 ? -dot(normal, up) / facing : 0;
      for (let j = y0; j <= y1; j++) {
        const dv = minV + (j + .5) * texel - v;
        for (let k = x0; k <= x1; k++) {
          const du = minU + (k + .5) * texel - u;
          if ((C*du*du - 2*b*du*dv + A*dv*dv) / det > extent) continue;
          const offset = Math.max(-reach, Math.min(reach, slopeU * du + slopeV * dv));
          const index = j * width + k;
          map[index] = Math.max(map[index], depth + offset);
        }
      }
    }
    const frame={map,right,up,light,minU,minV,width,height,texel,filter:sun.filter,bias:sun.bias+texel*.25};
    for (const triangle of triangles) rasterTriangle(frame,triangle);
    for (const shell of shells) rasterShell(frame,shell);
    if (curveAt) frame.curveDepth=drawCurves?.(frame,strands,curveCamera);
    return frame;
  }

  function rasterShell({map,right,up,light,minU,minV,texel,width,height},{points,depth}) {
    const low=axis=>Math.min(...points.map(point=>point[axis]));
    const high=axis=>Math.max(...points.map(point=>point[axis]));
    const x0=Math.max(0,Math.ceil((low(0)-minU)/texel-.5)), x1=Math.min(width-1,Math.floor((high(0)-minU)/texel-.5));
    const y0=Math.max(0,Math.ceil((low(1)-minV)/texel-.5)), y1=Math.min(height-1,Math.floor((high(1)-minV)/texel-.5));
    const front=high(2)+texel, stop=front-low(2)+texel, direction=light.map(n=>-n);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const u=minU+(x+.5)*texel,v=minV+(y+.5)*texel;
      const origin=[0,1,2].map(k=>right[k]*u+up[k]*v+light[k]*front);
      const at=y*width+x;
      map[at]=Math.max(map[at],front-depth(origin,direction,stop));
    }
  }

  function rasterTriangle({map,minU,minV,texel,width,height},{points,uv,sample}) {
    const [a,b,c] = points;
    const edge = (p,q,x,y)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);
    const area=edge(a,b,c[0],c[1]);
    if (Math.abs(area)<1e-12) return;
    const low=(axis,origin)=>Math.max(0,Math.ceil((Math.min(a[axis],b[axis],c[axis])-origin)/texel-.5));
    const high=(axis,origin,size)=>Math.min(size-1,Math.floor((Math.max(a[axis],b[axis],c[axis])-origin)/texel-.5));
    const x0=low(0,minU),x1=high(0,minU,width),y0=low(1,minV),y1=high(1,minV,height);
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
      const u=minU+(x+.5)*texel,v=minV+(y+.5)*texel;
      const w0=edge(b,c,u,v)/area,w1=edge(c,a,u,v)/area,w2=1-w0-w1;
      if (Math.min(w0,w1,w2)<-1e-7) continue;
      const i=y*width+x, depth=a[2]*w0+b[2]*w1+c[2]*w2;
      if (depth<=map[i]) continue;
      if (sample(uv[0][0]*w0+uv[1][0]*w1+uv[2][0]*w2,uv[0][1]*w0+uv[1][1]*w1+uv[2][1]*w2)) map[i]=depth;
    }
  }

  function visibility(frame,x,y,z,normal,facing) {
    const {map,right,up,light,minU,minV,width,height,texel,filter,bias,curveDepth}=frame;
    const u = (x*right[0] + y*right[1] + z*right[2] - minU) / texel;
    const v = (x*up[0] + y*up[1] + z*up[2] - minV) / texel;
    const depth = x*light[0] + y*light[1] + z*light[2];
    const i = Math.floor(u), j = Math.floor(v), denominator = Math.max(.10, facing);
    const slopeU = -dot(normal, right) * texel / denominator;
    const slopeV = -dot(normal, up) * texel / denominator;
    let clear = 0, count = 0;
    for (let dy = -filter; dy <= filter; dy++) {
      const row = j + dy;
      for (let dx = -filter; dx <= filter; dx++) {
        const col = i + dx;
        const expected = depth + (col + .5 - u)*slopeU + (row + .5 - v)*slopeV;
        if (row < 0 || row >= height || col < 0 || col >= width) clear++;
        else {
          const index = row * width + col, cutoff = expected + bias;
          if (map[index] <= cutoff) {
            let through = 1;
            const layers = curveDepth?.get(index);
            if (layers) for (const layer of layers) if (layer.range[1] > cutoff) through *= 1 - layer.opacity;
            clear += through;
          }
        }
        count++;
      }
    }
    return clear / count;
  }

  function curveLayer(layers, range, opacity, group) {
    let i=layers.length-1;
    while (i>=0 && group) {
      const layer = layers[i];
      if (layer.group !== group || !curves.overlapsDepth(layer.range, range)) {
        i--;
        continue;
      }
      if (layer.range[1] > range[1]) opacity = layer.opacity;
      else if (layer.range[1] === range[1]) opacity = Math.max(opacity,layer.opacity);
      range[0] = Math.min(range[0], layer.range[0]);
      range[1] = Math.max(range[1], layer.range[1]);
      layers.splice(i, 1);
      i=layers.length-1;
    }
    layers.push({ range, opacity, group });
  }

  function rasterCurves(casters, map, axes, { minU, minV, width, height, texel }, { maxLayers }, stats) {
    const [right, up, light] = axes, layers = new Map();
    const ray = { origin: [0, 0, 0], direction: light.map(value => -value), axial: 1 };
    const rayAt = () => ray;
    let fragments = 0, rayTests=0;
    for (const strand of casters) {
      const [umin, vmin, umax, vmax] = strand.bounds;
      const eye = dot(strand.from, light) + Math.max(0, strand.length * dot(strand.axis, light)) + 6 * strand.radius + 1e-4;
      const partial = strand.opacity < 1 || strand.pattern?.dash?.offOpacity > 0;
      const x0 = Math.max(0, Math.ceil((umin - minU) / texel - .5)),
        x1 = Math.min(width - 1, Math.floor((umax - minU) / texel - .5)),
        y0 = Math.max(0, Math.ceil((vmin - minV) / texel - .5)),
        y1 = Math.min(height - 1, Math.floor((vmax - minV) / texel - .5));
      rayTests+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);
      for (let y = y0; y <= y1; y++) {
        const v = minV + (y + .5) * texel;
        for (let x = x0; x <= x1; x++) {
          const u = minU + (x + .5) * texel;
          for (let i = 0; i < 3; i++) ray.origin[i] = u * right[i] + v * up[i] + eye * light[i];
          const hit = curves.sampleAt(strand, rayAt, u, v, 0, false, false, !!strand.group && partial);
          if (!hit) continue;
          const index = y * width + x, depth = eye - hit.depth;
          if (hit.alpha >= 1) map[index] = Math.max(map[index], depth);
          else if (depth > map[index]) {
            if (++fragments > 2e6) throw new RangeError('Curve shadows exceeded the translucent shadow fragment budget');
            if (!layers.has(index)) layers.set(index, []);
            curveLayer(layers.get(index), [eye - (hit.exitDepth ?? hit.depth), depth], hit.alpha, strand.group);
          }
        }
      }
    }
    let peakLayers=0, compactedLayers=0;
    for (const [index,stack] of layers) {
      let remaining=0;
      for (const layer of stack) if (layer.range[1]>map[index]) stack[remaining++]=layer;
      stack.length=remaining;
      if (!remaining) { layers.delete(index); continue; }
      if (remaining>maxLayers) {
        stack.sort((a,b)=>b.range[1]-a.range[1]);
        const tail=stack[maxLayers-1];
        let transmission=1-tail.opacity;
        for (let i=maxLayers;i<remaining;i++) transmission*=1-stack[i].opacity;
        compactedLayers+=remaining-maxLayers;
        stack.length=maxLayers;
        tail.opacity=1-transmission;
      }
      peakLayers=Math.max(peakLayers,stack.length);
    }
    Object.assign(stats,{rayTests,translucentHits:fragments,peakLayers,compactedLayers});
    return layers;
  }

  return Object.freeze({build,visibility,rasterCurves});
})();
if (typeof module !== 'undefined') module.exports = DirectionalShadowMap;
