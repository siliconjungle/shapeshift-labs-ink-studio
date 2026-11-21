/* Optional material history settings shared by weather binding, simulation and finishes. */
const MaterialHistory = (() => {
  const channels = Object.freeze(['wetCycles','windExposure','abrasion','pigment']);
  const maxTotal = 1e14, maxRate = 1000;
  const defaults = Object.freeze({
    dryThreshold:.18, wetThreshold:.55, pigmentCapacity:1, wash:1.2, windLoss:.08, abrasionLoss:.65
  });
  const between = (value,low,high) => Number.isFinite(value) && value>=low && value<=high;
  function settings(value) {
    if (value === false || value === undefined) return null;
    if (value === true) return defaults;
    if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
        Object.keys(value).some(key=>!Object.hasOwn(defaults,key)))
      throw new TypeError('Material history needs wet/dry thresholds, pigment capacity or loss settings');
    const result = { ...defaults,...value };
    const { dryThreshold,wetThreshold,pigmentCapacity,wash,windLoss,abrasionLoss } = result;
    if (!between(dryThreshold,0,1) || !between(wetThreshold,0,1) || dryThreshold>=wetThreshold ||
        !between(pigmentCapacity,0,1e4) || ![wash,windLoss,abrasionLoss].every(n=>between(n,0,maxRate)))
      throw new RangeError('Material history needs ordered wet/dry thresholds and bounded pigment capacity and losses');
    return Object.freeze(result);
  }
  function valid(channel,value,pigmentCapacity) {
    if (channel === 'wetPhase') return value === 0 || value === 1;
    if (channel === 'wetCycles' && !Number.isSafeInteger(value)) return false;
    return between(value,0,channel === 'pigment' ? pigmentCapacity : maxTotal);
  }
  return Object.freeze({ channels,maxTotal,maxRate,settings,valid });
})();
if (typeof module !== 'undefined') module.exports = MaterialHistory;
