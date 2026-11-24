/* Native pixel alignment shared by document tools and the browser canvas. */
const PixelGuides = (() => {
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const coordinate = n => typeof n === 'number' && Number.isSafeInteger(n * 2) && Math.abs(n) <= 8192;
  const pair = (value, check) => Array.isArray(value) && value.length === 2 && Array.from(value).every(check);
  const signatures = { grid:['step'], axis:['axis'], pivot:[], registration:[] };
  const limit = (value,min,max) => Math.max(min,Math.min(max,value));

  function prepare(guides = [], frames) {
    if (!Array.isArray(guides) || guides.length > 256)
      throw new TypeError('Pixel guides need a list of at most 256 entries');
    const names = new Set();
    for (const guide of guides) {
      if (!record(guide) || !Object.hasOwn(signatures,guide.kind) || !id(guide.id) || names.has(guide.id) ||
          guide.frame !== undefined && !frames?.has(guide.frame) ||
          guide.label !== undefined && (typeof guide.label !== 'string' || !guide.label.trim()) ||
          !Object.keys(guide).every(key => ['id','kind','frame','label','at',...signatures[guide.kind]].includes(key)))
        throw new TypeError('Pixel guides need unique IDs, known kinds, and an optional known frame');
      if (guide.kind === 'axis') {
        if (!['x','y'].includes(guide.axis) || !coordinate(guide.at))
          throw new TypeError('An axis guide needs x or y and a native coordinate');
      } else if (guide.kind === 'grid') {
        if (!pair(guide.at,n => coordinate(n) && Number.isInteger(n)) ||
            !pair(guide.step,n => Number.isSafeInteger(n) && n >= 1 && n <= 8192))
          throw new TypeError('A grid guide needs an integer origin and positive integer steps');
      } else if (!pair(guide.at,coordinate)) {
        throw new TypeError('Pivots and registration guides need a pair of native coordinates');
      }
      names.add(guide.id);
    }
    return guides;
  }

  function active(guides = [], frame) {
    return guides.filter(guide => guide.frame === undefined || guide.frame === frame)
      .map(({ frame,...guide }) => guide);
  }

  function closest(candidate, before) {
    if (!before || candidate.distance < before.distance) return candidate;
    if (candidate.distance !== before.distance) return before;
    if (candidate.priority !== before.priority) return candidate.priority < before.priority ? candidate : before;
    if (candidate.id !== before.id) return candidate.id < before.id ? candidate : before;
    return candidate.value < before.value ? candidate : before;
  }

  function snap(guides, point, { width,height,radius = 1 } = {}) {
    if (![width,height].every(n => Number.isSafeInteger(n) && n > 0) ||
        !pair(point,Number.isFinite) || !Number.isFinite(radius) || radius < 0 || radius > 32)
      throw new TypeError('Snap needs native dimensions, a finite point and a radius from 0 to 32 pixels');
    const size = [width,height], position = point.slice(), axes = [];
    let anchor;
    const inside = (value,index) => value >= 0 && value <= size[index]-1;

    function consider(index,value,id,priority) {
      const distance = Math.abs(value-point[index]);
      if (distance <= radius && inside(value,index))
        axes[index] = closest({ value,id,priority,distance },axes[index]);
    }
    for (const guide of guides) {
      if (guide.kind === 'axis') {
        consider(guide.axis === 'x' ? 0 : 1,guide.at,guide.id,0);
      } else if (guide.kind === 'grid') {
        for (const i of [0,1]) {
          const origin = guide.at[i], step = guide.step[i], offset = Math.floor((point[i]-origin)/step);
          const min = Math.ceil(-origin/step), max = Math.floor((size[i]-1-origin)/step);
          if (min > max) continue;
          consider(i,origin+limit(offset,min,max)*step,guide.id,1);
          consider(i,origin+limit(offset+1,min,max)*step,guide.id,1);
        }
      } else {
        const distance = Math.hypot(guide.at[0]-point[0],guide.at[1]-point[1]);
        if (distance <= radius && guide.at.every(inside))
          anchor = closest({ value:guide.at,id:guide.id,priority:0,distance },anchor);
      }
    }
    const hits = {};
    if (anchor) {
      hits.point = anchor.id;
      position.splice(0,2,...anchor.value);
    } else {
      for (const [i,hit] of axes.entries()) {
        if (!hit) continue;
        position[i] = hit.value;
        hits[i === 0 ? 'x' : 'y'] = hit.id;
      }
    }
    const at = position.map((value,i) => limit(Math.round(value),0,size[i]-1));
    return { at,position,hits };
  }

  return Object.freeze({ prepare,active,snap });
})();

if (typeof module !== 'undefined') module.exports = PixelGuides;
