/* Low-integer interval comparison and a partial-based sensory roughness model. */
(function (P) {
  const bounded = (n,lo,hi) => Number.isFinite(n) && n >= lo && n <= hi;
  function interval(a,b,{ maxTerm = 12 } = {}) {
    if (![a,b].every(v => bounded(v,1e-6,1e6)) || !Number.isSafeInteger(maxTerm) || !bounded(maxTerm,2,32))
      throw new RangeError('Expected positive frequencies and a ratio term limit of 2 to 32');
    const from = Math.min(a,b), to = Math.max(a,b), ratio = to/from;
    let error = Infinity, numerator = 1, denominator = 1, cents = 0;
    for (let d = 1; d <= maxTerm; d++) {
      const n = Math.max(d,Math.min(maxTerm,Math.round(ratio*d)));
      const difference = 1200*Math.log2(ratio/(n/d)), magnitude = Math.abs(difference);
      if (magnitude < error-1e-10) {
        error = magnitude;
        numerator = n;
        denominator = d;
        cents = difference;
      }
    }
    const aligned = error < 1e-7;
    return { ratio,numerator,denominator,cents,aligned,period: aligned ? denominator/from : null,
      partialBeat: Math.abs(to*denominator-from*numerator) };
  }

  // Based on Sethares' parametrization of the Plomp–Levelt pair curve.
  const peakAt = Math.log(5.75/3.5)/(5.75-3.5);
  const peak = Math.exp(-3.5*peakAt)-Math.exp(-5.75*peakAt);
  function roughness(spectra) {
    if (!Array.isArray(spectra) || spectra.length > 16 ||
      !Array.from(spectra).every(row => Array.isArray(row) && row.length <= 40 &&
      Array.from(row).every(p => Array.isArray(p) && p.length === 2 && bounded(p[0],1e-6,1e6) && bounded(p[1],0,32))))
      throw new RangeError('Roughness expects bounded spectra of frequency and amplitude pairs');
    let weighted = 0, energy = 0;
    for (let a = 0; a < spectra.length; a++) for (let b = a+1; b < spectra.length; b++) {
      for (const [fa,aa] of spectra[a]) for (const [fb,ab] of spectra[b]) {
        const distance = .24*Math.abs(fa-fb)/(.0207*Math.min(fa,fb)+18.96);
        const weight = aa*ab;
        energy += weight;
        weighted += weight*(Math.exp(-3.5*distance)-Math.exp(-5.75*distance))/peak;
      }
    }
    return energy ? Math.min(1,weighted/energy) : 0;
  }
  P.musicHarmony = Object.freeze({ ...P.musicHarmony, interval, roughness });
})(KIT.procedural);
