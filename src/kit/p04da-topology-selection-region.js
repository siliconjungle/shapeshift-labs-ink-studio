/* Native-grid footprints shared by visible and through component picks. */
const MeshSelectionRegion = (() => {
  function read(region, w, h) {
    if (!region || Object.getPrototypeOf(region) !== Object.prototype ||
        ![w, h].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1024))
      throw new TypeError('A mesh selection region needs a native view up to 1024 × 1024');
    const { type, rect, points, radius } = region;
    if (type === 'marquee' && Object.keys(region).every(key => ['type', 'rect'].includes(key))) {
      if (!Array.isArray(rect) || rect.length !== 4 || !Array.from(rect).every(Number.isSafeInteger))
        throw new TypeError('A marquee needs an integer [x, y, width, height] rectangle');
      const [x, y, width, height] = rect;
      if (x < 0 || y < 0 || width < 1 || height < 1 || width > w - x || height > h - y)
        throw new RangeError('A marquee must fit inside the native view');
      return { type, rect: [x, y, width, height] };
    }
    if (type !== 'brush' || Object.keys(region).some(key => !['type', 'points', 'radius'].includes(key)) ||
        !Array.isArray(points) || !points.length || points.length > 4096 ||
        !Array.from(points).every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h) ||
        !Number.isFinite(radius) || radius <= 0 || radius > Math.max(w, h))
      throw new RangeError('A brush needs 1–4096 view points and a positive radius in native pixels');
    return { type, points: points.map(([x, y]) => [x || 0, y || 0]), radius };
  }

  function prepare(region, w, h) {
    const query = read(region, w, h), mask = new Uint8Array(w * h), stride = w + 1;
    if (query.type === 'marquee') {
      const [x, y, width, height] = query.rect;
      for (let row = y; row < y + height; row++) mask.fill(1, row * w + x, row * w + x + width);
    } else {
      const { points, radius } = query;
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const path = points.filter(([x,y], i) => !i || points[i-1][0] !== x || points[i-1][1] !== y);
      const distance = SweptDisc.compile(path, path.map(() => radius));
      const left = Math.max(0, Math.ceil(Math.min(...xs) - radius - .5));
      const right = Math.min(w - 1, Math.floor(Math.max(...xs) + radius - .5));
      const top = Math.max(0, Math.ceil(Math.min(...ys) - radius - .5));
      const bottom = Math.min(h - 1, Math.floor(Math.max(...ys) + radius - .5));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++)
        mask[y * w + x] = Number(distance(x + .5, y + .5) <= 0);
    }
    const sums = new Uint16Array(stride * h);
    for (let y = 0; y < h; y++) for (let x = 0, row = y * stride; x < w; x++)
      sums[row + x + 1] = sums[row + x] + mask[y * w + x];

    function span(row, left, right) {
      const a = Math.max(0, Math.ceil(left - .5)), b = Math.min(w - 1, Math.floor(right - .5));
      return a <= b && sums[row * stride + a] < sums[row * stride + b + 1];
    }

    function rows(top, bottom, hit) {
      const last = Math.min(h - 1, Math.floor(bottom - .5));
      for (let row = Math.max(0, Math.ceil(top - .5)); row <= last; row++) if (hit(row, row + .5)) return true;
      return false;
    }

    function face(polygon) {
      const ys = polygon.map(p => p[1]);
      return rows(Math.min(...ys), Math.max(...ys), (row, y) => {
        let left = Infinity, right = -Infinity;
        for (let i = 0; i < polygon.length; i++) {
          const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length];
          if (y < Math.min(ay, by) || y > Math.max(ay, by)) continue;
          const x = ay === by ? ax : ax + (bx - ax) * (y - ay) / (by - ay);
          left = Math.min(left, x);
          right = Math.max(right, ay === by ? Math.max(ax, bx) : x);
          if (ay === by) left = Math.min(left, bx);
        }
        return span(row, left, right);
      });
    }

    function edge(line) {
      const [[ax, ay], [bx, by]] = line[0][1] <= line[1][1] ? line : [line[1], line[0]];
      const distance = SweptDisc.compile(line, [1, 1]);
      return rows(ay - 1, by + 1, (row, y) => {
        const xAt = v => ax + (bx - ax) * Math.max(0, Math.min(1, (v - ay) / (by - ay)));
        const [a, b] = ay === by ? [ax, bx] : [xAt(y - 1), xAt(y + 1)];
        const left = Math.min(a, b) - 1, right = Math.max(a, b) + 1;
        if (!span(row, left, right)) return false;
        for (let i = Math.max(0, Math.ceil(left - .5)); i <= Math.min(w - 1, Math.floor(right - .5)); i++)
          if (mask[row * w + i] && distance(i + .5, y) <= 0) return true;
        return false;
      });
    }

    const vertex = ([x, y]) => rows(y - 1, y + 1, row => span(row, x - 1, x + 1));
    return { query, mask, face, edge, vertex };
  }

  return Object.freeze({ read, prepare });
})();
