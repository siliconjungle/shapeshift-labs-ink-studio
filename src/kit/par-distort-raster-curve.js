/* Screen-space strip coordinates with deterministic ownership at crossings. */
(function (P) {
  const {size,tuple,int,bounded,clamp,raster} = P.rasterWarpSupport;
  const maxPixels = 1048576;
  const maxVisits = 48000000;
  const maxSegments = 4096;

  function segmentList(source, strokeWidth) {
    const points = Array.isArray(source) ? source : source?.points;
    const closed = source?.closed ?? false;
    const axes = points?.[0]?.length;
    if (typeof closed !== 'boolean' || !Array.isArray(points) ||
        !int(points.length,closed?3:2,maxSegments+1) || ![2,3].includes(axes) ||
        !Array.from(points).every(point=>tuple(point,axes,bounded)))
      throw new TypeError('Curve map needs a bounded path in art pixel XY coordinates');
    const widthOK = value => Number.isFinite(value) && value>=0 && value<=16384;
    const widths = Array.isArray(strokeWidth) ? strokeWidth : points.map(()=>strokeWidth);
    if (!tuple(widths,points.length,widthOK) || !widths.some(value=>value>0))
      throw new RangeError('Curve map needs a positive full width or one nonnegative width per point');

    const segments = [];
    let length = 0;
    for (let i=0;i<(closed?points.length:points.length-1);i++) {
      const next=(i+1)%points.length;
      const [ax,ay]=points[i], [bx,by]=points[next];
      const dx=bx-ax, dy=by-ay, span=Math.hypot(dx,dy);
      const start=widths[i]/2, end=widths[next]/2;
      if (span===0) {
        if (start!==end) throw new RangeError('Coincident curve map vertices need matching widths');
        continue;
      }
      segments.push({id:i,ax,ay,bx,by,tx:dx/span,ty:dy/span,span,start,end,along:length});
      length+=span;
    }
    if (!int(segments.length,closed?3:1,maxSegments) || !segments.some(s=>s.start>0 || s.end>0))
      throw new RangeError('Curve map needs nonzero segments and a nonzero strip');
    return {segments,length,closed};
  }

  function measure(segment, before, roundStart, roundEnd, x, y, feather, hit) {
    const {ax,ay,tx,ty,span,start,end}=segment;
    const dx=x-ax, dy=y-ay;
    const foot=dx*tx+dy*ty;
    let station=foot;
    if (foot<0) {
      // Only the outgoing span owns a rounded join, where both adjacent
      // perpendicular projections fall beyond their respective endpoints.
      if (before ? dx*before.tx+dy*before.ty<0 : !roundStart) return false;
      station=0;
    } else if (foot>span) {
      if (!roundEnd) return false;
      station=span;
    }
    const across=dy*tx-dx*ty;
    const radius=start+(end-start)*(station/span);
    if (radius===0) return false;
    const beyond=foot-station;
    const square=across*across+beyond*beyond;
    const reach=radius+feather*.5;
    if (square>reach*reach) return false;
    const coverage=feather===0 ? 1 : clamp(.5+(radius-Math.sqrt(square))/feather);
    if (!coverage) return false;
    hit.station=station;
    hit.across=across;
    hit.square=square;
    hit.radius=radius;
    hit.coverage=coverage;
    hit.core=Number(square<=radius*radius);
    return true;
  }

  function curveMap(source, {width,height,strokeWidth=8,feather=0,caps='round',overlap='nearest'} = {}) {
    size(width,height);
    if (width*height>maxPixels || !Number.isFinite(feather) || feather<0 || feather>16 ||
        !['round','butt'].includes(caps) || !['nearest','first','last'].includes(overlap))
      throw new RangeError('Invalid curve map grid, feather, cap style, or overlap rule');
    const {segments,length,closed}=segmentList(source,strokeWidth);
    // Preflight the number of pixel/segment candidates, including offscreen clipping.
    let visits=0;
    const bounds=segments.map(({ax,ay,bx,by,start,end})=>{
      const pad=Math.max(start,end)+feather*.5;
      const x0=Math.max(0,Math.ceil(Math.min(ax,bx)-pad-.5));
      const y0=Math.max(0,Math.ceil(Math.min(ay,by)-pad-.5));
      const x1=Math.min(width-1,Math.floor(Math.max(ax,bx)+pad-.5));
      const y1=Math.min(height-1,Math.floor(Math.max(ay,by)+pad-.5));
      visits+=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);
      return {x0,y0,x1,y1};
    });
    if (visits>maxVisits) throw new RangeError('Curve map exceeds its pixel/segment work budget');

    const count=width*height;
    const uv=new Float32Array(count*3), along=new Float64Array(count);
    const across=new Float32Array(count), tangent=new Float32Array(count*2);
    const coverage=new Float32Array(count), segmentIds=new Int32Array(count).fill(-1);
    const core=new Uint8Array(count);
    const scores=overlap==='nearest' ? new Float64Array(count).fill(Infinity) : null;
    const hit={};
    for (const [i,segment] of segments.entries()) {
      const {x0,y0,x1,y1}=bounds[i];
      if (x1<x0 || y1<y0) continue;
      const before=segments[i-1] ?? (closed ? segments.at(-1) : null);
      const roundStart=!closed && caps==='round' && i===0;
      const roundEnd=!closed && caps==='round' && i===segments.length-1;
      for (let y=y0;y<=y1;y++) for (let x=x0,p=y*width+x0;x<=x1;x++,p++) {
        if (!measure(segment,before,roundStart,roundEnd,x+.5,y+.5,feather,hit)) continue;
        // Feather samples cannot steal the address of an interior span.
        // Keep the strip's coverage continuous when one span crosses another.
        if (hit.coverage>coverage[p]) coverage[p]=uv[3*p+2]=hit.coverage;
        if (hit.core<core[p]) continue;
        const distance=segment.along+hit.station;
        if (hit.core===core[p] && segmentIds[p]>=0) {
          if (overlap==='first') continue;
          if (scores) {
            const difference=hit.square-scores[p], tied=Math.abs(difference)<=1e-10;
            if (tied ? distance>=along[p] : difference>0) continue;
          }
        }
        if (scores) scores[p]=hit.square;
        core[p]=hit.core;
        segmentIds[p]=segment.id;
        along[p]=distance;
        across[p]=hit.across;
        tangent[2*p]=segment.tx;
        tangent[2*p+1]=segment.ty;
        uv[3*p]=clamp(distance/length);
        uv[3*p+1]=clamp(.5+.5*(hit.across/hit.radius));
      }
    }

    return {
      value:raster(width,height,3,uv),
      along:raster(width,height,1,along),
      across:raster(width,height,1,across),
      tangent:raster(width,height,2,tangent),
      coverage:raster(width,height,1,coverage),
      segment:raster(width,height,1,segmentIds),
      length
    };
  }

  P.rasterWarp.curveMap=curveMap;
})(KIT.procedural);
