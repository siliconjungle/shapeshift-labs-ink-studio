/* A photographed curve silhouette lifted into indexed, UV-mapped depth strips. */
const CurveRibbons = (() => {
  const atlasAPI = typeof AtlasSprites === 'undefined' ? require('./atlas-sprites.js') : AtlasSprites;
  const meshes = typeof SceneMeshes === 'undefined' ? require('./scene-meshes.js') : SceneMeshes;
  const format = 'ink-studio/curve-bake';
  const dot = atlasAPI.dot;
  const unit = v => { const size = Math.hypot(...v); return v.map(n=>n/size); };
  const cross = (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const byte = n => Math.max(1,Math.min(255,128+Math.round(n*127)));

  function ribbon(atlas, options = {}) {
    const { metadata,images } = atlasAPI.compile(atlas).snapshot();
    const bake = metadata.curveBake;
    if (bake?.format !== format || bake.version !== 1 || !images.depth)
      throw new TypeError('A curve ribbon needs a version 1 curve-bake atlas with depth');
    const { view = 0, axis = 'auto', alphaCutoff = .5, depthTolerance = .02, at = metadata.pivot,
      object = bake.object, part = bake.part, material = bake.material,
      id = [object,part,'ribbon'].filter(Boolean).join('/') } = { ...bake.ribbon, ...options };
    if (!Number.isSafeInteger(view) || !metadata.frames[view] || !['auto','x','y'].includes(axis) ||
        !Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff > 1 ||
        !Number.isFinite(depthTolerance) || depthTolerance < 0)
      throw new RangeError('Curve ribbons need a baked view, an axis, a coverage cutoff in [0, 1], and nonnegative depth tolerance');
    const anchor = atlasAPI.vector(at,'Curve ribbon anchor');
    const frame = metadata.frames[view], { rect:tile, pivot, unitsPerPixel:units, depthOrigin } = frame;
    const { width,height } = tile, size = width*height;
    const { right,up,normal } = atlasAPI.basis(frame.yaw,frame.pitch);
    const [near,far] = metadata.encodings.depth.range;
    const color = new Uint8Array(size*4), normals = images.normal && new Uint8Array(size*4);
    const field = new Float32Array(size).fill(Infinity);
    let left = width, top = height, rightmost = -1, bottom = -1, covered = 0;
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
      const src = ((tile.y+y)*metadata.width+tile.x+x)*4, dst = y*width+x;
      color.set(images.color.subarray(src,src+4),dst*4);
      const alpha = images.color[src+3], depth = images.depth;
      if (!alpha || alpha/255 < alphaCutoff || !depth[src+3]) continue;
      const encoded = metadata.depthFormat === 'gray' ? depth[src]/255 :
        (depth[src]*65536+depth[src+1]*256+depth[src+2])/0xffffff;
      field[dst] = near+(far-near)*encoded-depthOrigin;
      left=Math.min(left,x); rightmost=Math.max(rightmost,x);
      top=Math.min(top,y); bottom=Math.max(bottom,y);
      covered++;
    }
    if (!covered) throw new RangeError('The selected curve ribbon view has no texels at its coverage cutoff');
    const alongX = axis === 'auto' ? rightmost-left >= bottom-top : axis === 'x';
    const length = alongX ? width : height, lanes = alongX ? height : width;
    const texel = (along, lane) => alongX ? lane*width+along : along*width+lane;
    const positions = [], uvs = [], indices = [];
    let maxDepthError = 0;

    function point(x,y,z) {
      const u = (x-pivot.x)*units, v = (pivot.y-y)*units;
      positions.push(...anchor.map((n,i)=>n+u*right[i]+v*up[i]-z*normal[i]));
      uvs.push(x/width,y/height);
    }
    function strip(first,last,lane,depth,slope) {
      if (indices.length >= 750000) throw new RangeError('Curve ribbon exceeds the indexed mesh triangle budget');
      const start = positions.length/3, front = depth(first)-slope*.5, back = depth(last)+slope*.5;
      if (alongX) {
        point(first,lane,front); point(last+1,lane,back);
        point(first,lane+1,front); point(last+1,lane+1,back);
      } else {
        point(lane,first,front); point(lane+1,first,front);
        point(lane,last+1,back); point(lane+1,last+1,back);
      }
      indices.push(start,start+2,start+1,start+2,start+3,start+1);
      if (!normals) return;
      const tangent = alongX ? unit([units,0,-slope]) : [1,0,0];
      const bitangent = alongX ? [0,1,0] : unit([0,units,slope]);
      const face = cross(tangent,bitangent);
      for (let p=first; p<=last; p++) {
        const x = alongX ? p : lane, y = alongX ? lane : p;
        const n = ((tile.y+y)*metadata.width+tile.x+x)*4, dst = (y*width+x)*4;
        if (!images.normal[n+3]) continue;
        const sample = Array.from(images.normal.subarray(n,n+3),v=>v/127.5-1);
        const viewNormal = metadata.normalSpace === 'asset' ? [dot(sample,right),dot(sample,up),dot(sample,normal)] : sample;
        normals.set([byte(dot(viewNormal,tangent)),byte(dot(viewNormal,bitangent)),byte(dot(viewNormal,face)),255],dst);
      }
    }

    for (let lane=0; lane<lanes; lane++) {
      const depth = p => field[texel(p,lane)];
      function visit(first,last) {
        const slope = first===last ? 0 : (depth(last)-depth(first))/(last-first);
        let error = 0;
        for (let p=first+1; p<last; p++)
          error = Math.max(error,Math.abs(depth(p)-depth(first)-(p-first)*slope));
        if (error > depthTolerance) {
          const middle = (first+last)>>1;
          visit(first,middle);
          visit(middle+1,last);
        } else {
          maxDepthError = Math.max(maxDepthError,error);
          strip(first,last,lane,depth,slope);
        }
      }
      for (let first=0; first<length;) {
        if (!Number.isFinite(depth(first))) { first++; continue; }
        let last = first;
        // A discontinuity is a break between ribbons, not a ramp connecting two strands.
        while (last+1<length && Number.isFinite(depth(last+1)) &&
            Math.abs(depth(last+1)-depth(last)) <= Math.max(2*depthTolerance,units)) last++;
        visit(first,last);
        first = last+1;
      }
    }
    const mesh = meshes.create({ id,objectId:object,partId:part,positions,uvs,indices,
      materials:[{ id:material,texture:{width,height,pixels:color},normal:normals,alphaCutoff:Math.max(1/255,alphaCutoff) }] });
    return { mesh, strips:indices.length/6, covered, maxDepthError, view, axis:alongX ? 'x' : 'y' };
  }

  return Object.freeze({ format, ribbon });
})();
if (typeof module !== 'undefined') module.exports = CurveRibbons;
