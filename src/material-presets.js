/* Named material parameter sets, with per-instance applied baselines. */
const MaterialPresets = (() => {
  const format = 'ink-studio/material-presets';
  const own = Object.hasOwn;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value);
  const label = value => typeof value === 'string' && value.trim() && value.length <= 120 && !value.includes('\0');
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const values = value => record(value) && Object.keys(value).every(id);
  const supported = { save: ['id', 'label', 'instance', 'controls', 'values'],
    rename: ['id', 'label'], copy: ['id', 'to', 'label'], apply: ['id', 'instance'], import: ['bundle', 'replace'] };
  const sorted = table => Object.entries(table).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

  function validatePresets(presets = {}) {
    if (!record(presets)) throw new TypeError('Material presets need a named table');
    for (const [key, row] of Object.entries(presets)) {
      if (!id(key) || !fields(row, ['label', 'values']) || !label(row.label) || !values(row.values))
        throw new TypeError('Invalid material preset ' + key);
    }
  }

  function validateApplied(value) {
    if (!fields(value, ['id', 'values']) || !id(value.id) || !values(value.values))
      throw new TypeError('Applied material preset needs an ID and saved values');
  }

  function validatePackage(bundle) {
    if (!fields(bundle, ['format', 'version', 'material', 'presets']) || bundle.format !== format ||
        bundle.version !== 1 || !id(bundle.material) || !own(bundle, 'presets'))
      throw new TypeError('Expected a version 1 material preset package');
    validatePresets(bundle.presets);
  }

  function get(table, key, noun) {
    if (!id(key) || !own(table, key)) throw new RangeError('Unknown material ' + noun + ' ' + String(key));
    return table[key];
  }

  function selection(keys, table, noun) {
    if (keys === undefined) return Object.keys(table);
    if (!Array.isArray(keys) || !Array.from(keys).every(key => id(key) && own(table, key)) || new Set(keys).size !== keys.length)
      throw new RangeError('Choose distinct known material ' + noun + ' IDs');
    return keys;
  }

  function toolkit(parameterToolkit, clone, equal) {
    function compare(parameters, applied) {
      const rows = parameters.map(row => {
        const fromPreset = applied && own(applied.values, row.id);
        const baseline = fromPreset ? applied.values[row.id] : row.default;
        const changed = !equal(row.value, baseline), changedFromDefault = !equal(row.value, row.default);
        return { ...row, comparison: { origin: fromPreset ? 'preset' : 'default',
          ...(baseline !== undefined && { baseline }), changed, changedFromDefault } };
      });
      const changes = rows.filter(row => row.comparison.changed).map(({ id, label, value, comparison }) => ({
        id, label, ...comparison, ...(value !== undefined && { value })
      }));
      return { parameters: rows, changes };
    }

    function prepare(scope, material) {
      const program = parameterToolkit.prepare(scope);
      const validate = input => program.apply({}, input);

      function edit({ presets = {}, instances = {} }, request) {
        const kind = request?.kind;
        if (typeof kind !== 'string' || !own(supported, kind) || !fields(request, ['kind', ...supported[kind]]))
          throw new TypeError('Invalid material preset edit');
        validatePresets(presets);
        const next = { presets: { ...presets }, instances: { ...instances } };
        const { id: key, instance, label: title } = request;
        if (title !== undefined && !label(title)) throw new TypeError('Choose a material preset label');
        if (kind === 'import') {
          const { bundle, replace = false } = request;
          validatePackage(bundle);
          if (typeof replace !== 'boolean') throw new TypeError('Material preset import replace must be a boolean');
          for (const [name, preset] of Object.entries(bundle.presets)) {
            if (own(presets, name) && !replace) throw new RangeError('Material preset already exists: ' + name);
            validate(preset.values);
            next.presets[name] = clone(preset);
          }
        } else if (kind === 'save') {
          if (!id(key)) throw new TypeError('Choose a stable material preset ID');
          if (request.values !== undefined && (request.controls !== undefined || instance !== undefined))
            throw new TypeError('Save explicit values or capture an instance and optional controls');
          let snapshot = request.values;
          if (snapshot === undefined) {
            const overrides = instance === undefined ? {} : get(instances, instance, 'instance').overrides ?? {};
            const available = Object.fromEntries(program.inspect({ overrides }).parameters
              .filter(row => own(row, 'value')).map(({ id, value }) => [id, value]));
            snapshot = Object.fromEntries(selection(request.controls, available, 'parameter').map(name => [name, available[name]]));
          }
          validate(snapshot);
          next.presets[key] = clone({ label: title ?? (own(presets, key) ? presets[key].label : key), values: snapshot });
        } else {
          const preset = get(presets, key, 'preset');
          if (kind === 'rename') {
            if (title === undefined) throw new TypeError('Choose a new material preset label');
            next.presets[key] = { ...preset, label: title };
          } else if (kind === 'copy') {
            const target = request.to;
            if (!id(target) || own(presets, target)) throw new RangeError('Choose a new material preset ID');
            next.presets[target] = clone({ ...preset, label: title ?? (preset.label.length <= 115 ? preset.label + ' copy' : target) });
            validatePresets({ [target]: next.presets[target] });
          } else {
            if (!id(instance)) throw new TypeError('Choose a stable material instance ID');
            const entry = own(instances, instance) ? instances[instance] : {};
            const saved = clone(preset.values);
            const overrides = program.apply(entry.overrides ?? {}, clone(saved));
            next.instances[instance] = { ...entry, overrides, preset: { id: key, values: saved } };
          }
        }
        return next;
      }

      function inspect({ presets = {}, instances = {} }, { instance } = {}) {
        const catalog = sorted(presets).map(([id, preset]) => {
          try {
            validate(preset.values);
            return { id, ...clone(preset), compatible: true };
          } catch (error) {
            return { id, ...clone(preset), compatible: false, error: error.message };
          }
        });
        const keys = instance === undefined ? sorted(instances).map(([key]) => key) : [instance];
        const rows = keys.map(key => {
          const entry = get(instances, key, 'instance'), applied = entry.preset;
          const currentPreset = applied && own(presets, applied.id) ? presets[applied.id] : undefined;
          const view = program.inspect({ overrides: entry.overrides ?? {} });
          return { id: key, label: entry.label ?? key,
            ...(applied && { preset: { id: applied.id, label: currentPreset?.label ?? applied.id,
              updated: Boolean(currentPreset && !equal(currentPreset.values, applied.values)) } }),
            ...compare(view.parameters, applied), visibility: view.visibility };
        });
        return { material, presets: catalog, instances: rows };
      }

      function exportPresets({ presets = {} }, ids) {
        return { format, version: 1, material, presets: clone(Object.fromEntries(
          [...selection(ids, presets, 'preset')].sort().map(key => [key, presets[key]]))) };
      }

      return { edit, inspect, exportPresets };
    }

    return Object.freeze({ prepare, compare });
  }

  return Object.freeze({ format, validatePresets, validateApplied, toolkit });
})();
if (typeof module !== 'undefined') module.exports = MaterialPresets;
