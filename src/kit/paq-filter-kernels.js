/* Gaussian and box kernels shared by byte and typed material filters. */
const RasterFilterKernels = (() => {
  function weights(radius,kind='gaussian',sigma=Math.max(.5,radius/2)) {
    if (!Number.isSafeInteger(radius) || radius < 0 || radius > 64 || !['box','gaussian'].includes(kind) || !Number.isFinite(sigma) || sigma<=0)
      throw new RangeError('Blur needs a radius from 0 to 64 and a positive sigma');
    const values=Array.from({length:2*radius+1},(_,i) => kind==='box' || i===radius ? 1 :
      Math.exp(-.5*((i-radius)/sigma)**2));
    const sum=values.reduce((a,b)=>a+b);
    return values.map(value=>value/sum);
  }
  return Object.freeze({ weights });
})();
