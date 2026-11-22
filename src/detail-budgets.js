/* Use the same scene labels before baking and when resolving visible pixels. */
const DetailBudgets = (() => {
  const targets = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const ENABLE_CLEANUP = 1, DISABLE_CLEANUP = 2, PROTECT_SILHOUETTE = 4, OWNED = 8;
  const GAP_SHIFT = 4;

  function prepare(definition) {
    if (definition == null || definition === false) return null;
    if (!Array.isArray(definition) || definition.length > 64)
      throw new TypeError('Detail budgets need an array of up to 64 rules');
    const rules = Array.from(definition, rule => {
      if (!rule || Object.getPrototypeOf(rule) !== Object.prototype ||
          Object.keys(rule).some(key => !['select', 'spacing', 'fine', 'cleanup', 'protectSilhouette', 'protectGaps'].includes(key)))
        throw new TypeError('Invalid detail budget rule');
      const { spacing, fine, cleanup, protectSilhouette, protectGaps } = rule;
      const select = targets.prepare(rule.select);
      if (Object.keys(select).some(key => !['object', 'entity', 'tag'].includes(key)))
        throw new TypeError('Detail budgets select by object, entity or tag');
      if (spacing !== undefined && (!Number.isFinite(spacing) || spacing < 0.25 || spacing > 4))
        throw new RangeError('Detail budget spacing must be between 0.25 and 4');
      for (const [key, value] of Object.entries({ fine, cleanup, protectSilhouette, protectGaps }))
        if (value !== undefined && typeof value !== 'boolean')
          throw new TypeError('Detail budget ' + key + ' must be a boolean');
      return Object.freeze({ ...rule, select });
    });
    if (!rules.length) return null;
    const gapGroups = new Map();
    rules.forEach((rule, i) => { if (rule.protectGaps) gapGroups.set(rule, i + 1); });

    function match(target) {
      return rules.find(rule => targets.matches(rule.select, target));
    }
    function bind(world) {
      const index = targets.index(world), cache = new WeakMap();
      return i => {
        if (i < 0 || i >= world.count) return undefined;
        const target = index.row(i);
        if (!cache.has(target)) cache.set(target, match(target));
        return cache.get(target);
      };
    }
    return Object.freeze({
      rules: Object.freeze(rules), match, bind,
      fineOn: rules.some(rule => rule.fine === true),
      fineOff: rules.some(rule => rule.fine === false),
      affectsCleanup: gapGroups.size > 0 || rules.some(rule => flags(rule) !== 0),
      protectsGaps: gapGroups.size > 0,
      flags: rule => flags(rule) | ((gapGroups.get(rule) ?? 0) << GAP_SHIFT),
      enablesCleanup: rules.some(rule => rule.cleanup === true)
    });
  }

  function flags(rule) {
    return (rule?.cleanup === true ? ENABLE_CLEANUP : rule?.cleanup === false ? DISABLE_CLEANUP : 0) |
      (rule?.protectSilhouette ? PROTECT_SILHOUETTE : 0);
  }
  function cleans(value, fallback) {
    if (value & DISABLE_CLEANUP) return false;
    return !!(value & ENABLE_CLEANUP) || fallback;
  }
  function protects(value) {
    return !!(value & (DISABLE_CLEANUP | PROTECT_SILHOUETTE));
  }
  function protectsGap(depth, a, depthA, b, depthB) {
    const group = a >> GAP_SHIFT;
    return group !== 0 && group === (b >> GAP_SHIFT) && depth - Math.max(depthA, depthB) > 0.004;
  }
  function changesCleanup(value) {
    return !!(value & (ENABLE_CLEANUP | DISABLE_CLEANUP | PROTECT_SILHOUETTE));
  }
  return Object.freeze({ prepare, flags, cleans, protects, protectsGap, changesCleanup, OWNED });
})();
if (typeof module !== 'undefined') module.exports = DetailBudgets;
