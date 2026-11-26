const { area2 } = require('./glb-uv.js');

const dimensions = size => typeof size==='number'?{width:size,height:size}:size;
const rasterGrid = settings => settings.grid??settings.size;
const count = size => {const {width,height}=dimensions(size);return width*height;};

function triangle(uv, size) {
  const {width,height}=dimensions(size);
  const points = uv.map(([u,v])=>[u*width,v*height]);
  const det = area2(...points);
  if (Math.abs(det) < 1e-16) throw new Error('Cannot bake a degenerate UV triangle');
  return { points, det };
}

function samples({ points: [a, b, c], det }, size, visit) {
  const {width,height}=dimensions(size);
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const x1 = Math.min(width, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y1 = Math.min(height, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const q = [x + .5, y + .5], u = area2(a, q, c) / det, v = area2(a, b, q) / det;
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
    visit(x + y * width, u, v, Math.min(u, v, 1 - u - v) > 1e-7, x, y);
  }
}

function neighbors(i,width,length,visit) {
  if (i % width > 0) visit(i-1);
  if (i % width < width - 1) visit(i+1);
  if (i >= width) visit(i-width);
  if (i < length - width) visit(i+width);
}

function gutters(covered, size, padding, eligible, copy) {
  if (!padding) return;
  const {width}=dimensions(size), {length}=covered;
  let front = [];
  for (let i = 0; i < length; i++) if (covered[i] && eligible(i) &&
    ((i % width > 0 && !covered[i - 1]) || (i % width < width - 1 && !covered[i + 1]) ||
    (i >= width && !covered[i - width]) || (i < length - width && !covered[i + width]))) front.push(i);
  for (let step = 0; step < padding && front.length; step++) {
    const next = [];
    for (const i of front) neighbors(i,width,length,j=>copy(i,j,next,step+1));
    front = next;
  }
}

module.exports = { dimensions,rasterGrid,count,triangle,samples,neighbors,gutters };
