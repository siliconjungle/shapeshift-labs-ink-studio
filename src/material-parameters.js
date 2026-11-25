/* Editable material parameter definitions and the values consumed by an inspector. */
const MaterialParameters = (() => {
  const own = Object.hasOwn;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const text = (value, length) => typeof value === 'string' && value.trim() && value.length <= length && !value.includes('\0');
  const keys = ['group', 'widget', 'default', 'units', 'min', 'max', 'step', 'options', 'order'];
  const widgets = ['number', 'slider', 'toggle', 'select', 'text', 'json'];
  const scalar = value => typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value);
  const schema = definition => typeof definition === 'string' ? { type: definition } : definition;
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function validate(control, id) {
    const { group, widget, units, min, max, step, options, order } = control;
    if (group !== undefined && !text(group, 100) || units !== undefined && !text(units, 64) ||
        widget !== undefined && !widgets.includes(widget) || order !== undefined && (!Number.isSafeInteger(order) || order < 0))
      throw new TypeError('Invalid group, units, widget or order on parameter ' + id);
    if ([min, max, step].some(v => v !== undefined && !Number.isFinite(v)) ||
        min !== undefined && max !== undefined && min > max || step !== undefined && step <= 0)
      throw new RangeError('Parameter ' + id + ' needs ordered numeric bounds and a positive step');
    if (widget === 'slider' && !(Number.isFinite(min) && Number.isFinite(max) && min < max))
      throw new RangeError('Slider parameter ' + id + ' needs distinct min and max');
    if (options !== undefined) {
      if (!Array.isArray(options) || options.length < 1 || options.length > 128 || !Array.from(options).every(option =>
        record(option) && Object.keys(option).every(key => key === 'label' || key === 'value') &&
        text(option.label, 120) && scalar(option.value)) ||
        new Set(options.map(option => option.value)).size !== options.length)
        throw new TypeError('Parameter ' + id + ' needs enum labels and distinct scalar values');
    }
    if (widget === 'select' && options === undefined || options !== undefined && widget !== undefined && widget !== 'select')
      throw new TypeError('Parameter ' + id + ' uses enum options with a select widget');
  }

  function checkValue({ min, max, options }, id, value) {
    if ((min !== undefined || max !== undefined) &&
        (!Number.isFinite(value) || min !== undefined && value < min || max !== undefined && value > max))
      throw new RangeError('Parameter ' + id + ' is outside its authored bounds');
    if (options && !options.some(option => option.value === value))
      throw new RangeError('Parameter ' + id + ' needs one of its enum values');
  }

  function inputDefault(definition, value) {
    return { ...schema(definition), default: value };
  }

  function effectiveInputs(inputs, controls) {
    const result = { ...inputs };
    for (const control of Object.values(controls)) {
      if (!own(control, 'default')) continue;
      const input = inputs[control.input];
      result[control.input] = { ...input, definition: inputDefault(input.definition, control.default) };
    }
    return result;
  }

  function reset(overrides, ids = Object.keys(overrides)) {
    const remove = new Set(ids);
    return Object.fromEntries(Object.entries(overrides).filter(([id]) => !remove.has(id)));
  }

  function toolkit(types, visibility) {
    function prepare({ inputs = {}, controls = {}, outputs = {} }) {
      const definitions = effectiveInputs(inputs, controls);
      const rows = Object.entries(controls).map(([id, control]) => {
        validate(control, id);
        const { input, label = id, group = 'General', options, min, max, step, order = 0 } = control;
        const declared = schema(definitions[input]?.definition);
        const { type, quantity } = declared ?? {};
        const valid = types.validator(type);
        if (!valid) throw new TypeError('Unknown graph input type for parameter ' + id);
        const isNumber = type !== 'any' && types.compatible(type, 'number');
        const widget = control.widget ?? (options ? 'select' : isNumber ? 'number' :
          type === 'boolean' ? 'toggle' : type === 'string' ? 'text' : 'json');
        if (widget === 'toggle' && type !== 'boolean' || widget === 'text' && type !== 'string' ||
            (['slider', 'number'].includes(widget) || [min, max, step].some(value => value !== undefined)) && !isNumber ||
            options && (!(isNumber || type === 'string' || type === 'boolean') || !options.every(option => valid(option.value))))
          throw new TypeError('Widget or enum values for parameter ' + id + ' do not match its ' + type + ' input');
        const units = control.units ?? quantity?.unit;
        const row = { id, input, label, group, type, widget, order,
          ...(units !== undefined && { units }), ...(min !== undefined && { min }), ...(max !== undefined && { max }),
          ...(step !== undefined && { step }), ...(options && { options }),
          ...(own(declared, 'default') && { default: declared.default }) };
        function check(value) {
          if (!valid(value)) throw new TypeError('Parameter ' + id + ' needs a ' + type + ' value');
          checkValue(control, id, value);
        }
        if (options) for (const option of options) check(option.value);
        if (own(row, 'default')) check(row.default);
        return { row, check, controlDefault: own(control, 'default') };
      }).sort((a, b) => a.row.order - b.row.order || compare(a.row.id, b.row.id));
      const byId = new Map(rows.map(entry => [entry.row.id, entry]));
      function apply(overrides, changes) {
        if (!record(overrides) || !record(changes)) throw new TypeError('Parameter values need named records');
        for (const [id, value] of Object.entries(changes)) {
          const item = byId.get(id);
          if (!item) throw new RangeError('Unknown material parameter ' + id);
          item.check(value);
        }
        return { ...overrides, ...changes };
      }

      function inspect({ inputs = {}, overrides = {} } = {}) {
        if (!record(inputs) || !record(overrides)) throw new TypeError('Parameter values need named records');
        const instanceInputs = Object.fromEntries(rows.filter(({ row }) => own(overrides, row.id))
          .map(({ row }) => [row.input, overrides[row.id]]));
        const values = { ...instanceInputs, ...inputs };
        const view = visibility.inspect({ inputs: definitions, controls, outputs }, { values });
        const parameters = rows.map(({ row, check, controlDefault }) => {
          const origin = own(inputs, row.input) ? 'input' : own(overrides, row.id) ? 'override' :
            controlDefault ? 'parameter' : own(row, 'default') ? 'socket' : 'required';
          const value = own(values, row.input) ? values[row.input] : row.default;
          const state = { ...row, origin, ...view.controls[row.id], ...(value !== undefined && { value }) };
          if (origin === 'input' || origin === 'override') {
            try { check(value); }
            catch (error) { state.valueError = { code: 'invalid-parameter-value', message: error.message }; }
          }
          return state;
        });
        return { parameters, visibility: view };
      }
      return { inspect, apply };
    }
    return Object.freeze({ prepare, reset });
  }

  return Object.freeze({ keys, validate, checkValue, inputDefault, effectiveInputs, reset, toolkit });
})();
if (typeof module !== 'undefined') module.exports = MaterialParameters;
