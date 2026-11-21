/* Integrate a projected art-pixel footprint without emitting new swatches. */
const PaletteResampling = (() => {
  const maxColors = 32, maxProtected = 4, strips = 4, epsilon = 1e-4;
  const fields = ['palette', 'protect', 'protectCoverage', 'alphaCoverage', 'tieTolerance'];
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  function color(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return parseInt(value.slice(1), 16);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffff)
      throw new TypeError('Palette sampling needs RGB24 swatches');
    return value;
  }

  function settings(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.keys(value).some(key => !fields.includes(key))) throw new TypeError('Invalid palette sampling settings');
    const { palette, protect = [], protectCoverage = .10, alphaCoverage = .5, tieTolerance = .004 } = value;
    if (palette !== undefined && (!Array.isArray(palette) || palette.length < 1 || palette.length > maxColors) ||
        !Array.isArray(protect) || protect.length > maxProtected ||
        ![protectCoverage, alphaCoverage, tieTolerance].every(unit) || protectCoverage === 0 || alphaCoverage === 0)
      throw new RangeError('Palette sampling supports 1–32 swatches, up to four protected swatches, and bounded coverage and tolerance');
    const colors = palette === undefined ? undefined : Array.from(palette, color);
    const protectedColors = Array.from(protect, color);
    if (colors && (new Set(colors).size !== colors.length || protectedColors.some(ink => !colors.includes(ink))) ||
        new Set(protectedColors).size !== protectedColors.length) throw new RangeError('Sampling swatches must be distinct and protected swatches must belong to an explicit palette');
    return { ...(colors && { palette: colors }), protect: protectedColors, protectCoverage, alphaCoverage, tieTolerance };
  }

  function channels(colors) {
    return Float32Array.from(colors.flatMap(ink => [ink >>> 16, (ink >>> 8) & 255, ink & 255]), n => n / 255);
  }

  function compile(atlas, rect, rule) {
    const { x, y, width, height } = rect;
    const columns = width + 1, rows = height + 1;
    const totals = new Uint32Array(columns * rows * 4), accents = rule.protect.length ? new Uint32Array(totals.length) : null;
    const found = rule.palette ? null : new Set(), data = atlas.pixels;
    for (let j = 1; j <= height; j++) {
      const row = [0, 0, 0, 0], marks = [0, 0, 0, 0];
      for (let i = 1; i <= width; i++) {
        const p = ((y + j - 1) * atlas.width + x + i - 1) * 4;
        if (data[p + 3] >= 128) {
          const packed = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
          found?.add(packed);
          if (found?.size > maxColors) throw new RangeError('A sampled region with over 32 colors needs an explicit palette');
          const index = rule.protect.indexOf(packed);
          if (index >= 0) marks[index]++;
          row[0] += data[p];
          row[1] += data[p + 1];
          row[2] += data[p + 2];
          row[3]++;
        }
        const at = (j * columns + i) * 4, above = at - columns * 4;
        for (let c = 0; c < 4; c++) {
          totals[at + c] = totals[above + c] + row[c];
          if (accents) accents[at + c] = accents[above + c] + marks[c];
        }
      }
    }
    const colors = rule.palette ?? [...found].sort((a, b) => a - b);
    return { rect, totals, accents, colors, swatches: channels(colors), highlights: channels(rule.protect), rule };
  }

  function cuts(lo, hi, out) {
    const a = Math.floor(lo), b = Math.ceil(hi);
    out[0] = a;
    out[1] = Math.min(a + 1, b);
    out[2] = Math.max(out[1], Math.floor(hi));
    out[3] = b;
  }

  function sampler(filter) {
    const { rect, rule, colors, swatches, totals, accents } = filter;
    const { width, height } = rect, columns = width + 1;
    const sum = new Float64Array(4), marks = new Float64Array(4), scores = new Float64Array(colors.length);
    const xs = new Int32Array(4), ys = new Int32Array(4);
    function sample(u, v, ux, vx, uy, vy) {
      const dx = ux * ux + vx * vx, dy = uy * uy + vy * vy;
      const skew = ux * uy + vx * vy;
      if (.5 * (dx + dy + Math.hypot(dx - dy, 2 * skew)) <= 1) return undefined;
      u -= rect.x;
      v -= rect.y;
      const aligned = Math.abs(ux * vx) <= 1e-7 && Math.abs(uy * vy) <= 1e-7;
      const count = aligned ? 1 : strips;
      const mx = dx >= dy ? ux : uy, my = dx >= dy ? vx : vy;
      const nx = dx >= dy ? uy : ux, ny = dx >= dy ? vy : vx;
      const hx = Math.max(epsilon, (Math.abs(mx) / count + Math.abs(nx)) * .5);
      const hy = Math.max(epsilon, (Math.abs(my) / count + Math.abs(ny)) * .5);
      let area = 0;
      sum.fill(0);
      marks.fill(0);
      for (let i = 0; i < count; i++) {
        const phase = (i + .5) / count - .5;
        const x = u + mx * phase, y = v + my * phase;
        const left = Math.max(0, x - hx), right = Math.min(width, x + hx);
        const top = Math.max(0, y - hy), bottom = Math.min(height, y + hy);
        if (right <= left || bottom <= top) continue;
        area += (right - left) * (bottom - top);
        cuts(left, right, xs);
        cuts(top, bottom, ys);
        for (let j = 0; j < 3; j++) {
          const y0 = ys[j], y1 = ys[j + 1];
          if (y0 === y1) continue;
          const yw = (Math.min(bottom, y1) - Math.max(top, y0)) / (y1 - y0);
          for (let k = 0; k < 3; k++) {
            const x0 = xs[k], x1 = xs[k + 1];
            if (x0 === x1) continue;
            const weight = yw * (Math.min(right, x1) - Math.max(left, x0)) / (x1 - x0);
            const a = (y0 * columns + x0) * 4, b = (y0 * columns + x1) * 4;
            const c = (y1 * columns + x0) * 4, d = (y1 * columns + x1) * 4;
            for (let n = 0; n < 4; n++) {
              sum[n] += weight * (totals[d + n] - totals[c + n] - totals[b + n] + totals[a + n]);
              if (accents) marks[n] += weight * (accents[d + n] - accents[c + n] - accents[b + n] + accents[a + n]);
            }
          }
        }
      }
      if (!(sum[3] > 0) || sum[3] < area * rule.alphaCoverage) return null;
      let winning = -1;
      for (let i = 0; i < rule.protect.length; i++)
        if (marks[i] >= sum[3] * rule.protectCoverage && (winning < 0 || marks[i] > marks[winning])) winning = i;
      if (winning >= 0) return rule.protect[winning];
      let best = Infinity;
      const r = sum[0] / (255 * sum[3]), g = sum[1] / (255 * sum[3]), b = sum[2] / (255 * sum[3]);
      for (let i = 0; i < colors.length; i++) {
        const c = i * 3;
        scores[i] = (r - swatches[c]) ** 2 + (g - swatches[c + 1]) ** 2 + (b - swatches[c + 2]) ** 2;
        best = Math.min(best, scores[i]);
      }
      for (let i = 0; i < colors.length; i++) if (scores[i] <= best + rule.tieTolerance) return colors[i];
      return null;
    }
    return sample;
  }

  const glsl = `
uniform bool u_paletteSampling;
uniform highp usampler2D u_sampleTotals, u_sampleAccents;
uniform vec4 u_sampleRegion;
uniform vec3 u_sampleRule;
uniform vec3 u_sampleSwatches[${maxColors}], u_sampleProtected[${maxProtected}];
uniform int u_sampleCount, u_protectCount;
ivec4 prefixCuts(float lo,float hi){
  int a=int(floor(lo)),b=int(ceil(hi)),c=min(a+1,b);
  return ivec4(a,c,max(c,int(floor(hi))),b);
}
vec4 prefixBox(highp usampler2D table,ivec4 xs,ivec4 ys,vec2 lo,vec2 hi){
  vec4 sum=vec4(0.0);
  for(int j=0;j<3;j++){
    int y0=ys[j],y1=ys[j+1];
    if(y0==y1)continue;
    float yw=(min(hi.y,float(y1))-max(lo.y,float(y0)))/float(y1-y0);
    for(int i=0;i<3;i++){
      int x0=xs[i],x1=xs[i+1];
      if(x0==x1)continue;
      float w=yw*(min(hi.x,float(x1))-max(lo.x,float(x0)))/float(x1-x0);
      highp uvec4 a=texelFetch(table,ivec2(x0,y0),0),b=texelFetch(table,ivec2(x1,y0),0);
      highp uvec4 c=texelFetch(table,ivec2(x0,y1),0),d=texelFetch(table,ivec2(x1,y1),0);
      sum+=w*vec4((d-c)-(b-a));
    }
  }
  return sum;
}
vec4 samplePalette(vec2 center,vec2 dx,vec2 dy,vec4 nearest){
  float lx=dot(dx,dx),ly=dot(dy,dy);
  if(.5*(lx+ly+length(vec2(lx-ly,2.0*dot(dx,dy))))<=1.0)return nearest;
  int count=abs(dx.x*dx.y)<=1e-7&&abs(dy.x*dy.y)<=1e-7?1:${strips};
  vec2 major=lx>=ly?dx:dy,minor=lx>=ly?dy:dx;
  vec2 halfSize=max(vec2(${epsilon}),(abs(major)/float(count)+abs(minor))*.5);
  center-=u_sampleRegion.xy;
  vec4 sum=vec4(0.0),marks=vec4(0.0);
  float area=0.0;
  for(int i=0;i<${strips};i++){
    if(i>=count)break;
    vec2 at=center+major*((float(i)+.5)/float(count)-.5);
    vec2 lo=max(vec2(0.0),at-halfSize),hi=min(u_sampleRegion.zw,at+halfSize);
    if(any(lessThanEqual(hi,lo)))continue;
    area+=(hi.x-lo.x)*(hi.y-lo.y);
    ivec4 xs=prefixCuts(lo.x,hi.x),ys=prefixCuts(lo.y,hi.y);
    sum+=prefixBox(u_sampleTotals,xs,ys,lo,hi);
    if(u_protectCount>0)marks+=prefixBox(u_sampleAccents,xs,ys,lo,hi);
  }
  if(sum.a<=0.0||sum.a<area*u_sampleRule.x)return vec4(0.0);
  int win=-1;
  float mass=-1.0;
  for(int i=0;i<${maxProtected};i++){
    if(i>=u_protectCount)break;
    if(marks[i]>=sum.a*u_sampleRule.y&&marks[i]>mass){win=i;mass=marks[i];}
  }
  if(win>=0)return vec4(u_sampleProtected[win],1.0);
  vec3 rgb=sum.rgb/(255.0*sum.a);
  float scores[${maxColors}],best=1e6;
  for(int i=0;i<${maxColors};i++){
    if(i>=u_sampleCount)break;
    vec3 d=rgb-u_sampleSwatches[i];scores[i]=dot(d,d);best=min(best,scores[i]);
  }
  for(int i=0;i<${maxColors};i++){
    if(i>=u_sampleCount)break;
    if(scores[i]<=best+u_sampleRule.z)return vec4(u_sampleSwatches[i],1.0);
  }
  return vec4(0.0);
}
`;
  return Object.freeze({ settings, compile, sampler, glsl });
})();
if (typeof module !== 'undefined') module.exports = PaletteResampling;
