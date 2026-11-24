/* Native-grid pixel art metrics and navigable craft findings. */
const PixelCraft = (() => {
  const lumOf = (rgb, i) => (rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114) / 255;
  const colOf = (rgb, i) => (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];

  // the background: pixels of the given colour (or very dark) joined to the picture's edge
  function backgroundMask(img, bg) {
    const { w, h, rgb } = img,
      N = w * h,
      out = new Uint8Array(N),
      isBg = i => (bg !== undefined ? colOf(rgb, i) === bg : false) || lumOf(rgb, i) < 0.06,
      stack = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (isBg(y * w + x)) stack.push(y * w + x);
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (isBg(y * w + x)) stack.push(y * w + x);
    while (stack.length) {
      const i = stack.pop();
      if (out[i]) continue;
      out[i] = 1;
      const x = i % w,
        y = (i / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const X = x + dx,
          Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X;
        if (!out[j] && isBg(j)) stack.push(j);
      }
    }
    return out;
  }

  function lint(img, o = {}) {
    const { w, h, rgb } = img,
      N = w * h,
      bgm = o.background ?? backgroundMask(img, o.bg),
      C = new Int32Array(N),
      L = new Float32Array(N);
    for (let i = 0; i < N; i++) ((C[i] = colOf(rgb, i)), (L[i] = lumOf(rgb, i)));
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x),
      same = (i, j) => j >= 0 && (!o.craft || !bgm[j]) && C[i] === C[j],
      mark = { orphan: new Uint8Array(N), double: new Uint8Array(N), jaggy: new Uint8Array(N), band: new Uint8Array(N) };
    let content = 0;
    for (let i = 0; i < N; i++) if (!bgm[i]) content++;

    // orphans
    let orphans = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bgm[i]) continue;
        let any = false;
        for (let dy = -1; dy <= 1 && !any; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && same(i, at(x + dx, y + dy))) any = true;
        if (!any) (orphans++, (mark.orphan[i] = 1));
      }

    // lines: thin dark strokes. A pixel is on one when it is darker than every other colour round it (background aside), it is in
    // no 2x2 block of its colour, and its colour runs on (eight-connected) for six pixels or more
    const block = i => {
      const x = i % w,
        y = (i / w) | 0;
      for (const [ax, ay] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1]
      ]) {
        const a = at(x + ax, y + ay),
          b = at(x + ax + 1, y + ay),
          c = at(x + ax, y + ay + 1),
          d = at(x + ax + 1, y + ay + 1);
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0 && same(i, a) && same(i, b) && same(i, c) && same(i, d)) return true;
      }
      return false;
    };
    const dark = new Uint8Array(N);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bgm[i] || block(i)) continue;
        let ok = true,
          n = 0;
        for (let dy = -1; dy <= 1 && ok; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = at(x + dx, y + dy);
            if (j < 0 || (!dx && !dy) || same(i, j) || bgm[j]) continue;
            n++;
            if (L[j] - L[i] < 0.06) ok = false;
          }
        if (ok && (n >= 2 || o.craft)) dark[i] = 1;
      }
    const line = new Uint8Array(N),
      seenL = new Uint8Array(N);
    for (let i0 = 0; i0 < N; i0++) {
      if (!dark[i0] || seenL[i0]) continue;
      const comp = [i0];
      seenL[i0] = 1;
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k],
          x = i % w,
          y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = at(x + dx, y + dy);
            if (j >= 0 && dark[j] && !seenL[j] && C[j] === C[i]) ((seenL[j] = 1), comp.push(j));
          }
      }
      if (comp.length >= 6) for (const i of comp) line[i] = 1;
    }
    // doubles: on a line, a pixel at the inside corner of a step, with the line going on from both arms (so the corner of a box,
    // where the line turns and stops, is left alone)
    let lineN = 0,
      doubles = 0;
    const onLine = j => j >= 0 && line[j];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!line[i]) continue;
        lineN++;
        for (const [ax, ay] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1]
        ]) {
          const hx = at(x + ax, y),
            vy = at(x, y + ay);
          if (!(onLine(hx) && onLine(vy) && same(i, hx) && same(i, vy))) continue;
          // (the arms go on: past the horizontal one along x or diagonally, past the vertical one along y or diagonally)
          const goH = onLine(at(x + 2 * ax, y)) || onLine(at(x + 2 * ax, y - ay)),
            goV = onLine(at(x, y + 2 * ay)) || onLine(at(x - ax, y + 2 * ay));
          const keepsStepping = onLine(at(x+2*ax,y-ay)) || onLine(at(x-ax,y+2*ay));
          if (goH && goV && (!o.craft || keepsStepping) && !onLine(at(x - ax, y)) && !onLine(at(x, y - ay))) {
            doubles++;
            mark.double[i] = 1;
            break;
          }
        }
      }

    /* jaggies: along an edge between two colours (or a colour and the background), the staircase it makes, row by row: the runs of
       edge on each row, each starting just past where the one on the row before ended. Along a staircase of four runs or more, a run
       two or more pixels longer or shorter than the next is a jaggy; so are its columns, for steep edges */
    let steps = 0,
      jaggies = 0;
    const stairs = horiz => {
      const A = horiz ? h : w,
        Bn = horiz ? w : h,
        idx = (a, b) => (horiz ? a * w + b : b * w + a);
      for (const side of [1, -1]) {
        // runs on each line a of pixels whose neighbour across (a + side) is another colour
        const runs = [];
        for (let a = 0; a < A; a++) {
          const row = [];
          let st = -1;
          for (let b = 0; b <= Bn; b++) {
            let e = false;
            if (b < Bn) {
              const i = idx(a, b),
                a2 = a + side;
              e = !bgm[i] && (a2 < 0 || a2 >= A || o.craft && bgm[idx(a2,b)] || C[idx(a2, b)] !== C[i]);
            }
            const colorBreak = o.craft && e && st >= 0 && C[idx(a,b)] !== C[idx(a,st)];
            if ((!e || colorBreak) && st >= 0) {
              row.push({ s: st, e: b - 1, c: C[idx(a, st)], next: null, prev: false });
              st = -1;
            }
            if (e && st < 0) st = b;
          }
          runs.push(row);
        }
        // link a run to one on the next line that carries on the staircase: it begins one past this one's end, or ends one before
        // its start, and is the same colour
        for (let a = 0; a + 1 < A; a++) {
          const starts = new Map(), ends = new Map();
          for (const q of runs[a+1]) {
            starts.set(q.s,q);
            ends.set(q.e,q);
          }
          for (const r of runs[a]) {
            const left = ends.get(r.s-1), right = starts.get(r.e+1);
            const next = left?.c === r.c ? left : right?.c === r.c ? right : null;
            if (next) {
              r.next = next;
              next.prev = true;
            }
          }
        }
        for (let a = 0; a < A; a++)
          for (const r of runs[a]) {
            if (r.prev) continue;
            const chain = [];
            let a2 = a;
            for (let q = r; q; q = q.next, a2++) chain.push([q, a2]);
            if (chain.length < 4) continue;
            // (the ends of a staircase are cut where it meets something else, so they are not judged)
            for (let k = 1; k + 2 < chain.length; k++) {
              const [r0] = chain[k],
                [r1, a1] = chain[k + 1],
                l0 = r0.e - r0.s + 1,
                l1 = r1.e - r1.s + 1;
              steps++;
              if (Math.abs(l0 - l1) >= 2) {
                jaggies++;
                for (let b = r1.s; b <= r1.e; b++) mark.jaggy[idx(a1, b)] = 1;
              }
            }
          }
      }
    };
    stairs(true);
    stairs(false);

    // banding: a middle tone one pixel wide between a darker and a lighter, kept up along the strip for three pixels or more
    let bandN = 0;
    const bandAt = (x, y, dx, dy) => {
      const i = at(x, y),
        a = at(x - dx, y - dy),
        b = at(x + dx, y + dy);
      if (i < 0 || a < 0 || b < 0 || bgm[i] || bgm[a] || bgm[b] || same(i, a) || same(i, b) || C[a] === C[b])
        return false;
      return (L[a] < L[i] && L[i] < L[b]) || (L[a] > L[i] && L[i] > L[b]);
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        for (const [dx, dy, px, py] of [
          [1, 0, 0, 1],
          [0, 1, 1, 0]
        ]) {
          if (!bandAt(x, y, dx, dy)) continue;
          let run = 1;
          for (const sg of [-1, 1]) for (let k = 1; k < 4 && bandAt(x + sg * k * px, y + sg * k * py, dx, dy); k++) run++;
          if (run >= 3) {
            bandN++;
            mark.band[y * w + x] = 1;
            break;
          }
        }
      }

    // pillow: each pixel at the rim of a shape (beside the background) against the mean of the shape's middle, by which way the
    // rim faces (eight ways); dark on every side is pillow shading
    const dist = new Float32Array(N).fill(1e9),
      q = [];
    for (let i = 0; i < N; i++) if (bgm[i]) ((dist[i] = 0), q.push(i));
    for (let k = 0; k < q.length; k++) {
      const i = q[k],
        x = i % w,
        y = (i / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const j = at(x + dx, y + dy);
        if (j >= 0 && dist[j] > dist[i] + 1) ((dist[j] = dist[i] + 1), q.push(j));
      }
    }
    let mid = 0,
      midN = 0;
    const rim = Array.from({ length: 8 }, () => [0, 0]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bgm[i]) continue;
        if (dist[i] >= 4) ((mid += L[i]), midN++);
        else if (dist[i] === 1) {
          // (which way the rim faces: away from the inside, down the slope of the distance)
          let gx = 0,
            gy = 0;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
          ]) {
            const j = at(x + dx, y + dy);
            if (j >= 0) ((gx -= dx * dist[j]), (gy -= dy * dist[j]));
          }
          if (!gx && !gy) continue;
          const k = (Math.round((Math.atan2(gy, gx) / (2 * Math.PI)) * 8) + 8) % 8;
          rim[k][0] += L[i];
          rim[k][1]++;
        }
      }
    const midL = midN ? mid / midN : 0,
      rimDark = rim.filter(r => r[1] > 4).map(r => Math.max(0, midL - r[0] / r[1]));
    const pillow = rimDark.length >= 4 && Math.max(...rimDark) > 0.02 ? Math.min(...rimDark) / Math.max(...rimDark) : 0;

    // noise: clusters of three or fewer pixels of one colour (four-connected)
    const seen = new Uint8Array(N);
    let noisy = 0;
    for (let i0 = 0; i0 < N; i0++) {
      if (seen[i0] || bgm[i0]) continue;
      const comp = [i0];
      seen[i0] = 1;
      for (let k = 0; k < comp.length && comp.length <= 4; k++) {
        const i = comp[k],
          x = i % w,
          y = (i / w) | 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const j = at(x + dx, y + dy);
          if (j >= 0 && !seen[j] && !bgm[j] && C[j] === C[i]) ((seen[j] = 1), comp.push(j));
        }
      }
      if (comp.length <= 3) noisy += comp.length;
    }
    const cols = new Set();
    for (let i = 0; i < N; i++) if (!bgm[i]) cols.add(C[i]);
    if (o.craft) Object.assign(mark,topology(w,h,C,bgm,o.owners));
    const per = v => (content ? v / content : 0);
    return {
      content,
      orphans: per(orphans),
      doubles: lineN ? doubles / lineN : 0,
      jaggies: steps ? jaggies / steps : 0,
      banding: per(bandN),
      pillow,
      noise: per(noisy),
      colours: cols.size,
      mark,
      bg: bgm
    };
  }

  // where each mistake is, over the picture dimmed
  function lintMap(img, res) {
    const { w, h, rgb } = img,
      out = new Uint8Array(w * h * 3),
      m = res.mark;
    for (let i = 0; i < w * h; i++) {
      let c = [rgb[i * 3] * 0.35, rgb[i * 3 + 1] * 0.35, rgb[i * 3 + 2] * 0.35];
      if (m.hole?.[i]) c = [110, 172, 255];
      if (m.tangent?.[i]) c = [92, 235, 139];
      if (m.band[i]) c = [40, 220, 230];
      if (m.jaggy[i]) c = [250, 220, 40];
      if (m.double[i]) c = [240, 60, 220];
      if (m.orphan[i]) c = [255, 50, 40];
      out.set(c.map(Math.round), i * 3);
    }
    return { w, h, rgb: out };
  }

  const kinds = Object.freeze({
    orphan:Object.freeze({ label:'Isolated pixels',hint:'Check whether the single pixel reads as an accent at 1×.' }),
    double:Object.freeze({ label:'Doubles',hint:'Check whether removing the inside corner keeps the thin stroke connected.' }),
    jaggy:Object.freeze({ label:'Uneven stairs',hint:'Compare this run with its neighbor and check the rhythm of the edge.' }),
    band:Object.freeze({ label:'Banding',hint:'Check whether the middle strip can join a larger cluster or break away from the edge.' }),
    tangent:Object.freeze({ label:'Tangent contacts',hint:'Check whether the shapes should have a clear gap or a stronger overlap.' }),
    hole:Object.freeze({ label:'Small enclosed holes',hint:'Check whether the transparent pocket is needed for the silhouette.' })
  });

  const xy = (p,w)=>[p%w,Math.floor(p/w)];
  const contacts = [[1,0],[0,1],[1,1],[-1,1]];
  const cardinal = [[-1,0],[1,0],[0,-1],[0,1]];
  const surrounding = [...cardinal,[-1,-1],[1,-1],[-1,1],[1,1]];
  function inside(x,y,w,h) { return x >= 0 && y >= 0 && x < w && y < h; }

  // Evaluate point contacts and enclosed alpha pockets only on the authored grid.
  function topology(w,h,colors,bg,owners) {
    const tangent = new Uint8Array(w*h), hole = new Uint8Array(w*h);
    const paint = (x,y)=>inside(x,y,w,h) && !bg[y*w+x];
    const alike = (a,b)=>colors[a] === colors[b] && owners?.[a] === owners?.[b];
    const support = (x,y)=>cardinal.reduce((count,[dx,dy])=>
      count+Number(paint(x+dx,y+dy) && alike(y*w+x,(y+dy)*w+x+dx)),0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = y*w+x;
      if (bg[a]) continue;
      for (const [dx,dy] of contacts) {
        const u = x+dx, v = y+dy, b = v*w+u;
        if (!paint(u,v)) continue;
        if (dx && dy) {
          if (paint(u,y) || paint(x,v)) continue;
        } else {
          if (alike(a,b)) continue;
          const sharedEdge = [-1,1].some(s=>paint(x-dy*s,y+dx*s) && paint(u-dy*s,v+dx*s));
          if (sharedEdge) continue;
        }
        if (support(x,y) < 2 || support(u,v) < 2) continue;
        tangent[a] = tangent[b] = 1;
      }
    }
    const seen = new Uint8Array(w*h);
    for (let p = 0; p < bg.length; p++) {
      if (!bg[p] || seen[p]) continue;
      const pocket = [p];
      let external = false;
      seen[p] = 1;
      for (let i = 0; i < pocket.length; i++) {
        const [x,y] = xy(pocket[i],w);
        if (x === 0 || y === 0 || x === w-1 || y === h-1) external = true;
        for (const [dx,dy] of surrounding) {
          const u = x+dx, v = y+dy, q = v*w+u;
          if (!inside(u,v,w,h) || !bg[q] || seen[q]) continue;
          seen[q] = 1;
          pocket.push(q);
        }
      }
      if (!external && pocket.length <= 9) for (const i of pocket) hole[i] = 1;
    }
    return { tangent,hole };
  }

  function rows(pixels,w) {
    const runs = [];
    for (const p of pixels) {
      const [x,y] = xy(p,w), tail = runs.at(-1);
      if (tail && tail[0] === y && tail[1]+tail[2] === x) tail[2]++;
      else runs.push([y,x,1]);
    }
    return runs;
  }

  function regions(mark,w,h,locks,owners,layerIds) {
    const results = [];
    for (const [kind,flags] of Object.entries(mark)) {
      const seen = new Uint8Array(flags.length);
      for (let p = 0; p < flags.length; p++) {
        if (!flags[p] || seen[p]) continue;
        const pixels = [p], editable = [], layers = new Set();
        let left = p%w, right = left, top = Math.floor(p/w), bottom = top;
        seen[p] = 1;
        for (let i = 0; i < pixels.length; i++) {
          const cell = pixels[i], [x,y] = xy(cell,w);
          const layer = layerIds?.[owners?.[cell]];
          if (layer) layers.add(layer);
          left = Math.min(left,x);
          right = Math.max(right,x);
          bottom = Math.max(bottom,y);
          if (!locks?.[cell]) editable.push(cell);
          for (const [dx,dy] of surrounding) {
            const u = x+dx, v = y+dy, q = v*w+u;
            if (!inside(u,v,w,h) || !flags[q] || seen[q]) continue;
            seen[q] = 1;
            pixels.push(q);
          }
        }
        pixels.sort((a,b)=>a-b);
        editable.sort((a,b)=>a-b);
        const [x,y] = xy(p,w), protectedCount = pixels.length-editable.length;
        results.push({ id:`${kind}-${x}-${y}`,kind,at:xy(editable[0] ?? p,w),
          bounds:[left,top,right-left+1,bottom-top+1],pixelCount:pixels.length,protectedCount,
          layers:[...layers],runs:rows(pixels,w),...(protectedCount && { editableRuns:rows(editable,w) }) });
      }
    }
    return results;
  }

  function analyze({ width:w,height:h,slots,opacity,colors,mixedColors,owners,layerIds,locks }) {
    const rgb = new Uint8Array(w*h*3), background = new Uint8Array(w*h);
    for (let p = 0; p < slots.length; p++) {
      const slot = slots[p];
      if (slot == null || slot < 0 || opacity?.[p] === 0) { background[p] = 1; continue; }
      const color = mixedColors?.[p] ?? colors[slot];
      rgb[p*3] = color>>>16;
      rgb[p*3+1] = (color>>>8)&255;
      rgb[p*3+2] = color&255;
    }
    const image = { w,h,rgb }, result = lint(image,{ background,owners,craft:true });
    return { image,result,diagnostics:regions(result.mark,w,h,locks,owners,layerIds) };
  }

  return Object.freeze({ lint,lintMap,backgroundMask,colOf,analyze,kinds });
})();
if (typeof module !== 'undefined') module.exports = PixelCraft;
