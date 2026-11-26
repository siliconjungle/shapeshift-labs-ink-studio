/* Editable SVG path data, independent of curve sampling and rasterization. */
const VectorPaths = (() => {
  const arity = Object.freeze({ M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0 });
  const canonical = ['M','L','C','Q','A','Z'];
  const finite = n => Number.isFinite(n) && Math.abs(n) <= 1e9;
  const maxSegments = 16000, maxData = 750000;
  const numberPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy;
  const zero = n => n === 0 ? 0 : n;
  function skip(cursor) {
    while (/[\t\r\n ]/.test(cursor.text[cursor.at] ?? '')) cursor.at++;
  }
  function number(cursor, comma, flag = false) {
    skip(cursor);
    if (comma && cursor.text[cursor.at] === ',') { cursor.at++; skip(cursor); }
    if (flag) {
      const digit = cursor.text[cursor.at];
      if (digit !== '0' && digit !== '1') throw new SyntaxError('Invalid SVG arc flag at ' + cursor.at);
      cursor.at++;
      return Number(digit);
    }
    numberPattern.lastIndex = cursor.at;
    const match = numberPattern.exec(cursor.text);
    const value = match && Number(match[0]);
    if (!match || !finite(value)) throw new SyntaxError('Invalid SVG number at ' + cursor.at);
    cursor.at = numberPattern.lastIndex;
    return zero(value);
  }
  function numbers(text) {
    if (typeof text !== 'string' || text.length > maxData) throw new RangeError('SVG numeric list exceeds its text budget');
    const cursor = { text, at:0 }, values = [];
    skip(cursor);
    while (cursor.at < text.length) {
      if (values.length >= maxSegments * 2) throw new RangeError('SVG numeric list exceeds its count budget');
      values.push(number(cursor, values.length > 0));
      skip(cursor);
    }
    return values;
  }

  function validate(segments) {
    if (!Array.isArray(segments) || segments.length > maxSegments || segments.length && segments[0]?.[0] !== 'M')
      throw new TypeError('SVG path needs a bounded segment list starting with a moveto');
    for (const segment of segments) {
      const kind = segment?.[0];
      if (!Array.isArray(segment) || !canonical.includes(kind) ||
          segment.length !== arity[kind] + 1 || !Array.from(segment.slice(1)).every(finite) ||
          kind === 'A' && (segment[1] < 0 || segment[2] < 0 || ![segment[4],segment[5]].every(n=>n===0 || n===1)))
        throw new TypeError('Invalid editable SVG segment ' + kind);
    }
    return segments;
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > maxData) throw new RangeError('SVG path exceeds its text budget');
    const cursor = { text, at:0 }, segments = [];
    let command, point = [0,0], start = point, previous;
    while (true) {
      skip(cursor);
      if (cursor.at === text.length) break;
      const symbol = text[cursor.at], explicit = /[a-z]/i.test(symbol);
      if (explicit) { command = symbol; cursor.at++; }
      const kind = command?.toUpperCase();
      if (!Object.hasOwn(arity,kind) || !segments.length && kind !== 'M')
        throw new SyntaxError('Expected an SVG path command at ' + (cursor.at - Number(explicit)));
      if (segments.length >= maxSegments) throw new RangeError('SVG path exceeds its segment budget');
      const value = Array.from({ length:arity[kind] },(_,i)=>number(cursor,i>0 || !explicit,kind==='A'&&(i===3 || i===4)));
      const to = (a,b) => command === kind ? [a,b] : [point[0]+a,point[1]+b];
      const reflect = offset => [2*point[0]-previous[offset],2*point[1]-previous[offset+1]];
      let segment;
      switch (kind) {
        case 'H': segment = ['L',to(value[0],0)[0],point[1]]; break;
        case 'V': segment = ['L',point[0],to(0,value[0])[1]]; break;
        case 'C': segment = ['C',...to(...value.slice(0,2)),...to(...value.slice(2,4)),...to(...value.slice(4))]; break;
        case 'S': segment = ['C',...(previous?.[0]==='C' ? reflect(3) : point),
          ...to(...value.slice(0,2)),...to(...value.slice(2))]; break;
        case 'Q': segment = ['Q',...to(...value.slice(0,2)),...to(...value.slice(2))]; break;
        case 'T': segment = ['Q',...(previous?.[0]==='Q' ? reflect(1) : point),...to(...value)]; break;
        case 'A': segment = ['A',...value.slice(0,5),...to(...value.slice(5))]; break;
        case 'Z': segment = ['Z']; break;
        default: segment = [kind,...to(...value)]; break;
      }
      point = kind === 'Z' ? start : segment.slice(-2);
      if (kind === 'M') {
        start = point;
        command = command === kind ? 'L' : 'l';
      } else if (kind === 'Z') command = undefined;
      segments.push(segment);
      previous = segment;
    }
    return validate(segments);
  }
  const encode = segments => validate(segments).map(row=>row.join(' ')).join(' ');
  const same = (a,b) => a[0]===b[0] && a[1]===b[1];
  function handles(segments) {
    let point, start;
    return validate(segments).map((row,index)=>{
      const [cmd] = row;
      const before = point;
      if (cmd === 'M') start = row.slice(1);
      point = cmd === 'Z' ? start : row.slice(-2);
      return { index, cmd, ...(before && cmd!=='M' && { start:before.slice() }), end:point.slice(),
        ...(cmd==='C' && { c1:row.slice(1,3),c2:row.slice(3,5) }),
        ...(cmd==='Q' && { control:row.slice(1,3) }) };
    });
  }

  function editPoint(segments,index,handle,at,{ tangent='free', translateHandles=true }={}) {
    if (!Array.isArray(at) || at.length!==2 || !Array.from(at).every(finite) ||
        !Number.isSafeInteger(index) || !['end','c1','c2','control'].includes(handle) ||
        !['free','aligned','mirrored'].includes(tangent) || typeof translateHandles!=='boolean')
      throw new TypeError('A vector point edit needs a segment, handle and finite XY');
    const rows = segments.map(row=>row.slice()), info = handles(rows), selected = info[index];
    if (!selected || selected.cmd==='Z' || !selected[handle])
      throw new RangeError('Selected SVG segment has no ' + handle + ' handle');
    const write = (i,offset,value) => rows[i].splice(offset,2,...value.map(zero));
    const inPair = before => (before?.cmd==='C' ? [before.index,3] : null);
    const outPair = after => (after?.cmd==='C' ? [after.index,1] : null);
    function loopEnd(begin) {
      if (info[begin]?.cmd!=='M') return -1;
      let i=begin+1;
      while (info[i] && !['M','Z'].includes(info[i].cmd)) i++;
      return info[i]?.cmd==='Z' && i>begin+1 && same(info[i-1].end,info[begin].end) ? i-1 : -1;
    }
    function loopStart(end) {
      if (info[end+1]?.cmd!=='Z') return -1;
      let i=end-1;
      while (i>=0 && !['M','Z'].includes(info[i].cmd)) i--;
      return info[i]?.cmd==='M' && same(info[i].end,info[end].end) ? i : -1;
    }
    if (handle==='end') {
      const delta = at.map((n,i)=>n-selected.end[i]);
      const moves = new Set([index]);
      const twin = selected.cmd==='M' ? loopEnd(index) : loopStart(index);
      if (twin>=0) moves.add(twin);
      for (const i of moves) {
        write(i,rows[i].length-2,at);
        if (translateHandles) for (const pair of [inPair(info[i]),outPair(info[i+1])]) {
          if (pair) {
            const [segment,offset]=pair;
            write(segment,offset,rows[segment].slice(offset,offset+2).map((n,c)=>n+delta[c]));
          }
        }
      }
    } else {
      write(index,handle==='c2' ? 3 : 1,at);
      if (tangent!=='free') {
        if (handle==='control') throw new TypeError('Tangent pairing requires a cubic handle');
        const first = loopStart(index);
        const other = handle==='c1' ? inPair(info[index-1]) ?? inPair(info[loopEnd(index-1)]) :
          outPair(info[index+1]) ?? (first>=0 ? outPair(info[first+1]) : null);
        if (other) {
          const anchor = handle==='c1' ? selected.start : selected.end;
          const delta = at.map((n,i)=>anchor[i]-n);
          const [segment,offset] = other, prior = rows[segment].slice(offset,offset+2);
          const magnitude = Math.hypot(...delta);
          if (tangent === 'mirrored' || magnitude > 0) {
            const scale = tangent==='mirrored' ? 1 : Math.hypot(prior[0]-anchor[0],prior[1]-anchor[1])/magnitude;
            write(segment,offset,anchor.map((n,i)=>n+delta[i]*scale));
          }
        }
      }
    }
    return validate(rows);
  }

  // Endpoint-to-center conversion follows W3C SVG 2 Appendix B.
  function arc(point,row) {
    let [,rx,ry,angle,large,sweep,x,y]=row;
    const end = [x,y];
    if (same(point,end) || !rx || !ry) return;
    const turn = angle*Math.PI/180, c=Math.cos(turn), s=Math.sin(turn);
    const dx=(point[0]-x)/2, dy=(point[1]-y)/2;
    const u=c*dx+s*dy, v=-s*dx+c*dy;
    const scale=Math.hypot(u/rx,v/ry);
    if (scale>1) { rx*=scale; ry*=scale; }
    const up=u/rx, vp=v/ry, q=up*up+vp*vp;
    const gain=(large===sweep?-1:1)*Math.sqrt(Math.max(0,1/q-1));
    const cx=gain*vp*rx, cy=-gain*up*ry;
    const center=[c*cx-s*cy+(point[0]+x)/2,s*cx+c*cy+(point[1]+y)/2];
    const first=Math.atan2((v-cy)/ry,(u-cx)/rx);
    let delta=Math.atan2((-v-cy)/ry,(-u-cx)/rx)-first;
    if (sweep && delta<0) delta+=2*Math.PI;
    if (!sweep && delta>0) delta-=2*Math.PI;
    return { center, u:[rx*c,rx*s],v:[-ry*s,ry*c],first,delta };
  }

  function flatten(segments, map=p=>p.slice(), { tolerance=.125, maxPoints=16000 }={}) {
    if (!Number.isFinite(tolerance) || tolerance<1e-6 || !Number.isSafeInteger(maxPoints) || maxPoints<1 || maxPoints>65536)
      throw new RangeError('Invalid SVG contour tolerance or point budget');
    const contours=[];
    let path, point, start, count=0;
    const checked = point => {
      const p=map(point);
      if (!p.every(Number.isFinite) || p.some(n=>Math.abs(n)>1e12)) throw new RangeError('SVG mapped coordinate exceeds its range');
      return p;
    };
    function push(p) {
      if (path.points.length && same(path.points.at(-1),p)) return;
      if (++count>maxPoints) throw new RangeError('SVG flattening exceeds its point budget');
      path.points.push(p);
    }
    function begin(p) {
      path={points:[],closed:false};
      contours.push(path);
      push(checked(p));
    }
    function distance(p,a,b) {
      const dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
      const t=len ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)) : 0;
      return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
    }
    function bezier(points,depth) {
      const end=points.at(-1);
      if (points.slice(1,-1).every(p=>distance(p,points[0],end)<=tolerance)) return push(end);
      if (depth===20) throw new RangeError('SVG curve exceeds its subdivision budget');
      const left=[points[0]],right=[end];
      while (points.length>1) {
        points=points.slice(1).map((p,i)=>[(p[0]+points[i][0])/2,(p[1]+points[i][1])/2]);
        left.push(points[0]);right.push(points.at(-1));
      }
      bezier(left,depth+1); bezier(right.reverse(),depth+1);
    }
    for (const row of validate(segments)) {
      const [cmd]=row;
      if (cmd==='M') {
        point=start=row.slice(1);begin(point);continue;
      }
      if (cmd==='Z') {
        path.closed=true;
        if (path.points.length>1 && same(path.points[0],path.points.at(-1))) path.points.pop();
        point=start;continue;
      }
      if (path.closed) begin(point);
      const end=row.slice(-2);
      if (cmd==='C' || cmd==='Q') {
        const control=[checked(point)];
        for (let i=1;i<row.length;i+=2) control.push(checked(row.slice(i,i+2)));
        bezier(control,0);
      } else if (cmd==='A') {
        const ellipse=arc(point,row);
        if (ellipse) {
          const {center,u,v,first,delta}=ellipse, base=checked(center);
          const reach=axis=>{
            const mapped=checked(center.map((n,i)=>n+axis[i]));
            return Math.hypot(mapped[0]-base[0],mapped[1]-base[1]);
          };
          const steps=Math.max(1,Math.ceil(Math.abs(delta)*Math.sqrt((reach(u)+reach(v))/(8*tolerance))));
          if (!Number.isFinite(steps) || steps+count>maxPoints) throw new RangeError('SVG arc exceeds its point budget');
          for (let i=1;i<steps;i++) {
            const a=first+delta*i/steps;
            push(checked(center.map((n,j)=>n+u[j]*Math.cos(a)+v[j]*Math.sin(a))));
          }
        }
        push(checked(end));
      } else push(checked(end));
      point=end;
    }
    return contours;
  }
  return Object.freeze({ parse, validate, encode, handles, editPoint, numbers, flatten, maxSegments });
})();
if (typeof module !== 'undefined') module.exports = VectorPaths;
