'use strict';

const zUp = [1,0,0, 0,0,-1, 0,1,0];

function carry(output, {degree, up, sh}, rotation, row, matrix, M) {
  // Stretch changes covariance and normals. Rotate the directional lobe
  // by the rigid part so its angular width and base color are preserved.
  const balance = Math.sqrt(Math.hypot(...matrix)/Math.hypot(...M.inv(matrix)));
  const inverse = M.tr(M.polar(M.polar(matrix.map(v=>v/balance))));
  const frame = up==='z' ? M.mul(M.mul(zUp,inverse),M.tr(zUp)) : inverse;
  const weights = rotation([frame.slice(0,3),frame.slice(3,6),frame.slice(6,9)],degree);
  if (!weights) return;
  const at = row*weights.length*3;
  for (let l=1;l<=degree;l++) {
    const first=l*l-1, end=(l+1)**2-1;
    for (let i=first;i<end;i++) for (let c=0;c<3;c++) {
      let sum=0;
      for (let j=first;j<end;j++) sum+=weights[i][j]*sh[at+j*3+c];
      output[at+i*3+c]=sum;
    }
  }
}

function transport(world, affected, M) {
  const scan = world.gaussianHarmonics;
  if (!scan || (!scan.degree && !scan.normals)) return {};
  const rows = [...affected.keys()].filter(i=>!scan.available || scan.available[i]);
  if (!rows.length) return {};
  const { gaussianHarmonicRotation: rotation } = world;
  if (scan.degree && (!rotation || scan.degree>4))
    throw new RangeError('Splat groups need supported live Gaussian coefficients to carry directional color');
  const normals = scan.normals?.slice(), sh = scan.degree ? scan.sh.slice() : scan.sh;
  for (const row of rows) {
    const matrix = affected.get(row).matrix;
    if (scan.degree) carry(sh,scan,rotation,row,matrix,M);
    if (!normals) continue;
    const at = row*3, original = scan.normals.subarray(at,at+3);
    const size = Math.hypot(...original), turned = M.app(M.tr(M.inv(matrix)),original);
    const length = Math.hypot(...turned);
    if (length) normals.set(turned.map(n=>Math.max(-127,Math.min(127,Math.round(n*size/length)))),at);
  }
  return {harmonics:{...scan,sh,...(normals && {normals})}, directionalRows:scan.degree ? rows.length : 0};
}

module.exports = {transport};
