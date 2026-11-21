/* Screen drawing reuses Ink's compositing paths, scan conversion, and bitmap glyphs. */
(function (K) {
  const P = K.procedural, R = P.raster;
  const finite = Number.isFinite, maxPoints = 2048;
  const tuple = (value, n, valid = finite) => Array.isArray(value) && value.length === n && Array.from(value).every(valid);
  const point = value => tuple(value, 2, n => finite(n) && Math.abs(n) <= 1e9);
  const solid = color => DrawingPrimitives.color(color);
  const record = P.graphTypes.validator('record');

  function pathSource(source) {
    const points = Array.isArray(source) ? source : source?.points;
    const closed = source?.closed ?? false;
    if (!Array.isArray(points) || points.length < (closed ? 3 : 2) || points.length > maxPoints ||
        !Array.from(points).every(point) || typeof closed !== 'boolean')
      throw new TypeError('Drawing needs a bounded 2D path');
    return {points, closed};
  }

  const arity = {M:2,L:2,H:1,V:1,Q:4,C:6,A:7,Z:0};
  function contours(d, steps = 12) {
    if (typeof d !== 'string' || d.length > 24000 || !Number.isSafeInteger(steps) || steps < 1 || steps > 64)
      throw new RangeError('Invalid drawing path text or curve steps');
    const tokenPattern = /[MLHVQCAZmlhvqcaz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
    const tokens = [];
    let end = 0;
    for (const match of d.matchAll(tokenPattern)) {
      if (!/^[\s,]*$/.test(d.slice(end, match.index))) throw new SyntaxError('Invalid drawing path token');
      end = match.index + match[0].length;
      tokens.push(match[0]);
    }
    if (!/^[\s,]*$/.test(d.slice(end))) throw new SyntaxError('Invalid drawing path token');
    if (!/^[Mm]$/.test(tokens[0])) throw new SyntaxError('A drawing path must start with M or m');
    const normalized = [], closed = [];
    let command, visits = 0;
    for (let i = 0; i < tokens.length;) {
      if (/^[A-Za-z]$/.test(tokens[i])) command = tokens[i++];
      if (!command) throw new SyntaxError('Expected a drawing path command');
      const type = command.toUpperCase(), n = arity[type];
      const args = tokens.slice(i, i + n).map(Number);
      if (args.length !== n || !args.every(value => finite(value) && Math.abs(value) <= 1e9))
        throw new SyntaxError('Wrong arguments for drawing path command ' + command);
      i += n;
      if (type !== 'M' && closed.at(-1)) throw new SyntaxError('A closed contour must be followed by a move command');
      if (type === 'M') closed.push(false);
      if (type === 'Z') closed[closed.length - 1] = true;
      if (type === 'A' && (!args.slice(3,5).every(flag => flag === 0 || flag === 1)))
        throw new SyntaxError('Arc flags must be zero or one');
      visits += type === 'A' ? steps * 2 : type === 'C' || type === 'Q' ? steps : 1;
      if (visits > maxPoints) throw new RangeError('Drawing path exceeds its point budget');
      const straightArc = type === 'A' && (!args[0] || !args[1]);
      normalized.push(straightArc ? (command === 'a' ? 'l' : 'L') : command, ...(straightArc ? args.slice(5) : args));
      if (type === 'M') command = command === 'm' ? 'l' : 'L';
      if (type === 'Z') command = undefined;
    }
    return K.svgPath(normalized.join(' '), steps).map((points,i) => pathSource({points, closed:closed[i]}));
  }

  function path(d, {steps} = {}) {
    const result = contours(d, steps);
    if (result.length !== 1) throw new TypeError('A typed path needs one contour');
    return result[0];
  }

  function ribbon(source, {width = 1, miterLimit = 3, fill = '#ffffff', stroke, strokeWidth} = {}) {
    const {points, closed} = pathSource(source), count = points.length;
    const widths = Array.isArray(width) ? width : points.map(() => width);
    if (!tuple(widths, count, n => finite(n) && n >= 0 && n <= 16384) || !widths.some(n => n > 0) ||
        !finite(miterLimit) || miterLimit < 1 || miterLimit > 32)
      throw new RangeError('Ribbon needs a nonzero width and a finite miter limit');
    const normals = points.slice(0, closed ? count : count - 1).map(([x,y],i) => {
      const [u,v] = points[(i + 1) % count], dx = u - x, dy = v - y, len = Math.hypot(dx,dy);
      if (len < 1e-8) throw new RangeError('Ribbon points must have distinct consecutive positions');
      return [-dy / len, dx / len];
    });
    const left = [], right = [];
    for (let i = 0; i < count; i++) {
      const after = normals[i] ?? normals.at(-1), before = normals[i - 1] ?? (closed ? normals.at(-1) : after);
      const x = before[0] + after[0], y = before[1] + after[1], len = Math.hypot(x,y);
      const [nx,ny] = len < 1e-8 ? after : [x / len,y / len];
      const scale = widths[i] / 2 / Math.max(1/miterLimit,nx*after[0]+ny*after[1]);
      const [px,py] = points[i];
      left.push([px+nx*scale,py+ny*scale]);
      right.push([px-nx*scale,py-ny*scale]);
    }
    const rings = closed ? [left,right] : [[...left,...right.reverse()]];
    return {type:'polygon',rings,fill,...(stroke !== undefined && {stroke}),...(strokeWidth !== undefined && {width:strokeWidth})};
  }

  let glyphs;
  function text(value, {scale = 1, tracking = 0, leading = 0, align = 'left', columns, color = '#ffffff', customGlyphs, kerning = {}} = {}) {
    if (typeof value !== 'string' || value.length > 4096 || ![scale,tracking,leading].every(Number.isSafeInteger) ||
        scale < 1 || scale > 32 || tracking < 0 || tracking > 256 || leading < 0 || leading > 256 ||
        !['left','center','right'].includes(align) || columns !== undefined && (!Number.isSafeInteger(columns) || columns < 1))
      throw new RangeError('Invalid bitmap text or layout options');
    glyphs ??= TargetInspection.font(K.ascii.atlas());
    if (customGlyphs !== undefined && (!P.graphTypes.validator('record')(customGlyphs) || Object.keys(customGlyphs).length > 256))
      throw new TypeError('Bitmap custom glyphs need a bounded character map');
    const font = customGlyphs === undefined ? glyphs : TargetInspection.font(K.ascii.atlas(),customGlyphs);
    const rows = value.replace(/\r\n?/g,'\n').split('\n').flatMap(line => {
      const chars = Array.from(line);
      if (!columns || chars.length <= columns) return [chars];
      return Array.from({length:Math.ceil(chars.length/columns)},(_,i)=>chars.slice(i*columns,(i+1)*columns));
    });
    const rgba = solid(color), cell = 6*scale + tracking, step = 8*scale + leading;
    if (!record(kerning) || Object.keys(kerning).length > 4096 ||
        Object.entries(kerning).some(([pair, shift]) => [...pair].length !== 2 ||
          !Number.isSafeInteger(shift) || shift < -cell || shift > 256))
      throw new RangeError('Bitmap kerning needs character pairs and bounded pixel adjustments');
    const runs = rows.map(row => {
      let x = 0;
      return row.map((char, i) => {
        const pair = i && row[i - 1] + char;
        if (i) x += cell + (Object.hasOwn(kerning, pair) ? kerning[pair] : 0);
        return {char, x};
      });
    });
    const rowWidth = row => row.length ? row.at(-1).x + 6*scale : 0;
    const width = Math.max(1,...runs.map(rowWidth)), height = rows.length*step-leading;
    if (width*height > 4e6) throw new RangeError('Bitmap text exceeds its pixel budget');
    const result = R.canvas({width,height}), anchors = {};
    const anchor = align === 'left' ? 0 : align === 'center' ? .5 : 1;
    for (let line = 0; line < runs.length; line++) {
      const run = runs[line], x = Math.floor((width-rowWidth(run))*anchor), y = line*step;
      const baseline = y + 7*scale;
      anchors['line:' + line] = [x, baseline];
      run.forEach(({char, x: advance},index) => {
        const gx = x + advance, glyph = font.get(char) ?? font.get('?');
        anchors['glyph:' + line + ':' + index] = [gx, baseline];
        if (!glyph) return;
        for (let v=0; v<8; v++) for (let u=0; u<6; u++) if (glyph[v*6+u])
          for (let dy=0; dy<scale; dy++) for (let dx=0; dx<scale; dx++) {
            const at = ((y+v*scale+dy)*width + gx+u*scale+dx)*4;
            result.data.set(rgba,at);
          }
      });
    }
    return {value:result,metrics:{width,height,lines:rows.length,scale},anchors};
  }

  function shape(draw) {
    const {type, rect, radius = 0, color, stroke, fill = color ?? '#ffffff', width, falloff, fillFalloff, strokeFalloff} = draw;
    if (!tuple(rect, 4) || rect[2] <= 0 || rect[3] <= 0 || !finite(radius) || radius < 0)
      throw new RangeError('Shape needs a positive rectangle and a nonnegative radius');
    const [x,y,w,h] = rect;
    if (type === 'rect' && !radius && stroke === undefined && fill !== false && strokeFalloff === undefined)
      return {type:'rect',rect,color:fill,falloff:fillFalloff === undefined ? falloff : fillFalloff};
    const r = Math.min(radius,w/2,h/2);
    let points;
    if (type === 'ellipse') {
      const count = Math.min(128,Math.max(24,Math.ceil(Math.PI*Math.sqrt(Math.max(w,h)))));
      points = Array.from({length:count},(_,i)=>{
        const angle = i/count * Math.PI*2;
        return [x+w*(1+Math.cos(angle))/2,y+h*(1+Math.sin(angle))/2];
      });
    } else if (r) {
      const centers = [[x+w-r,y+r],[x+w-r,y+h-r],[x+r,y+h-r],[x+r,y+r]];
      const segments = Math.min(16,Math.max(4,Math.ceil(Math.sqrt(r))));
      points = centers.flatMap(([cx,cy],j)=>Array.from({length:segments+1},(_,i)=>{
        const angle = (j-1+i/segments)*Math.PI/2;
        return [cx+r*Math.cos(angle),cy+r*Math.sin(angle)];
      }));
    } else points = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    return {type:'polygon',points,fill,falloff,fillFalloff,strokeFalloff,
      ...(stroke!==undefined && {stroke}),...(width!==undefined && {width})};
  }

  function drawingPath(draw) {
    const {source, d, points, closed, fill, color, stroke, width, steps, falloff, fillFalloff, strokeFalloff} = draw;
    const vertices = source === undefined ? points : Array.isArray(source) ? source : source?.points;
    const paths = d === undefined ? [pathSource({points:vertices,closed:closed ?? source?.closed})] : contours(d,steps);
    const lines = stroke ?? (fill ? false : color ?? '#ffffff');
    const size = width === undefined ? {} : {width};
    const output = [];
    if (fill) {
      if (!paths.every(p => p.closed)) throw new TypeError('A filled path needs closed contours');
      output.push({type:'polygon',rings:paths.map(p=>p.points),fill,falloff:fillFalloff === undefined ? falloff : fillFalloff,...size});
    }
    if (lines) for (const p of paths) output.push({type:'path',...p,color:lines,falloff:strokeFalloff === undefined ? falloff : strokeFalloff,...size});
    return output;
  }

  function translate(draw, [x, y]) {
    const at = value => {
      if (!point(value)) throw new TypeError('Drawing translation needs screen-space XY coordinates');
      return [value[0] + x, value[1] + y];
    };
    const result = { ...draw };
    if (draw.rect) {
      const [u, v, w, h] = draw.rect;
      result.rect = [u + x, v + y, w, h];
    }
    if (draw.points) result.points = draw.points.map(at);
    if (draw.rings) result.rings = draw.rings.map(ring => ring.map(at));
    if (draw.from) result.from = at(draw.from);
    if (draw.to) result.to = at(draw.to);
    if (draw.origin) result.origin = at(draw.origin);
    for (const key of ['falloff','fillFalloff','strokeFalloff','uFalloff','vFalloff']) {
      const fade = draw[key];
      if (fade && (fade.type === undefined || fade.type === 'linear'))
        result[key] = { ...fade, from: at(fade.from), to: at(fade.to) };
      if (fade?.type === 'radial') result[key] = { ...fade, center: at(fade.center) };
    }
    if (draw.type === 'text') {
      const origin = draw.at ?? [0, 0];
      if (!point(origin) || !origin.every(Number.isSafeInteger)) throw new TypeError('Bitmap text needs an integer XY anchor');
      result.at = at(origin).map(Math.round);
    }
    return result;
  }

  function render({width, height, commands, edges = 'smooth'} = {}) {
    if (!Array.isArray(commands) || commands.length > 8192) throw new RangeError('Expected a bounded drawing command array');
    function compile(draw) {
      if (!draw || draw.space !== undefined && draw.space !== 'screen') throw new TypeError('Expected a screen drawing command');
      if (draw.type === 'ellipse' || draw.type === 'rect') return [shape(draw)];
      if (draw.type === 'path') return drawingPath(draw);
      if (draw.type === 'ribbon') return [ribbon(draw.source ?? {points:draw.points,closed:draw.closed},draw)];
      return [draw];
    }
    const shapes = [];
    let vertices = 0;
    for (const draw of commands) {
      const { translate: offset, ...source } = draw ?? {};
      if (offset !== undefined && !point(offset)) throw new TypeError('Drawing translation needs a finite XY offset');
      for (const shape of compile(offset === undefined ? draw : source)) {
        vertices += shape.points?.length ?? 0;
        if (Array.isArray(shape.rings)) for (const ring of shape.rings) vertices += ring?.length ?? 0;
        if (vertices > 262144 || shapes.length >= 8192) throw new RangeError('Drawing exceeds its geometry budget');
        shapes.push(offset === undefined ? shape : translate(shape, offset));
      }
    }
    return FrameComposite.screenDrawing(width,height,shapes,{edges,bitmap(draw) {
      const {at = [0,0], color = '#ffffff'} = draw;
      if (!point(at) || !at.every(Number.isSafeInteger)) throw new TypeError('Bitmap text needs an integer XY anchor');
      const {value} = text(draw.text,draw);
      return {type:'bitmapStamp',at,stamp:{...value,color:solid(color)}};
    }});
  }

  P.drawing2d = {path, ribbon, text, render};
})(KIT);
