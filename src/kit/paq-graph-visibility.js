/* Typed presentation rules for editable graph controls and ports. */
(function (P) {
  const own = Object.hasOwn;
  const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const id = value => typeof value === 'string' && /^[a-z][\w.-]{0,99}$/i.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value);
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
  const operators = {
    eq: ['same', 'boolean', (a, b) => a === b],
    ne: ['same', 'boolean', (a, b) => a !== b],
    lt: ['number', 'boolean', (a, b) => a < b],
    lte: ['number', 'boolean', (a, b) => a <= b],
    gt: ['number', 'boolean', (a, b) => a > b],
    gte: ['number', 'boolean', (a, b) => a >= b],
    add: ['number', 'number', (a, b) => a + b],
    subtract: ['number', 'number', (a, b) => a - b],
    multiply: ['number', 'number', (a, b) => a * b],
    divide: ['number', 'number', (a, b) => a / b],
    and: ['boolean', 'boolean', (a, b) => a && b],
    or: ['boolean', 'boolean', (a, b) => a || b],
    not: ['boolean', 'boolean', a => !a]
  };

  class RuleError extends Error {
    constructor(code, path, message) {
      super(message);
      this.code = code;
      this.path = path;
    }
  }

  function fail(code, path, message) {
    throw new RuleError(code, path, message);
  }

  function literal(value, path) {
    const type = typeof value;
    if (type !== 'boolean' && type !== 'string' && !Number.isFinite(value))
      fail('invalid-literal', path, 'Use a boolean, finite number or string literal');
    return { type, read: () => value };
  }

  function inspect({ inputs = {}, controls = {}, outputs = {} }, { values = {}, path = '/graph' } = {}) {
    if (![inputs, controls, outputs, values].every(record) || typeof path !== 'string')
      throw new TypeError('Visibility needs named controls, ports and input values');
    const { validator, compatible } = P.graphTypes;

    function reference({ source, name }, path) {
      if (!id(name)) fail('invalid-reference', path + '/name', 'A visibility reference needs a valid socket name');
      const input = source === 'control' && own(controls, name) ? controls[name]?.input :
        source === 'input' ? name : undefined;
      if (!id(input) || !own(inputs, input))
        fail('unknown-reference', path, 'Unknown ' + source + ' ' + name);
      const definition = inputs[input].definition;
      const declared = typeof definition === 'string' ? definition : definition?.type;
      const valid = validator(declared);
      const type = declared === 'boolean' || declared === 'string' ? declared :
        declared !== 'any' && valid && compatible(declared, 'number') ? 'number' : undefined;
      if (!type) fail('unsupported-type', path, 'Visibility reference ' + name + ' needs a boolean, numeric or string port');
      return { type, read() {
        const value = own(values, input) ? values[input] : definition?.default;
        if (value === undefined) fail('missing-value', path, 'No value is available for ' + source + ' ' + name);
        if (!valid(value)) fail('wrong-value-type', path, 'Value for ' + source + ' ' + name + ' must be ' + declared);
        return value;
      }};
    }

    function evaluate(expression, root) {
      let nodes = 0;
      function compile(value, path, depth) {
        if (++nodes > 128 || depth > 24) fail('complexity', path, 'Visibility expression exceeds its complexity budget');
        if (!record(value)) return literal(value, path);
        if (own(value, 'literal') && fields(value, ['literal'])) return literal(value.literal, path + '/literal');
        if (['input', 'control'].includes(value.source) && fields(value, ['source', 'name']))
          return reference(value, path);
        const { op, args } = value;
        if (!fields(value, ['op', 'args']) || typeof op !== 'string' || !own(operators, op))
          fail('invalid-expression', path, 'Use a supported operator, literal, or named input or control reference');
        const count = op === 'not' ? 1 : 2;
        if (!Array.isArray(args) || args.length !== count)
          fail('arity', path + '/args', op + ' needs ' + count + (count === 1 ? ' operand' : ' operands'));
        const [operandType, type, run] = operators[op];
        const children = Array.from(args, (child, i) => compile(child, path + '/args/' + i, depth + 1));
        const expected = operandType === 'same' ? children[0].type : operandType;
        for (const [i, child] of children.entries()) {
          if (child.type !== expected)
            fail('type-mismatch', path + '/args/' + i, op + ' expects ' + expected + ' but received ' + child.type);
        }
        return { type, read() {
          const a = children[0].read();
          if (op === 'and' && !a || op === 'or' && a) return a;
          const result = run(a, children[1]?.read());
          if (type === 'number' && !Number.isFinite(result))
            fail('nonfinite-result', path, op + ' produced a nonfinite number');
          return result;
        }};
      }
      const compiled = compile(expression, root, 0);
      if (compiled.type !== 'boolean') fail('nonboolean-result', root, 'A visibility rule must return a boolean');
      return compiled.read();
    }

    const diagnostics = [];
    function targets(entries, kind, prefix) {
      return Object.fromEntries(Object.entries(entries).map(([id, row]) => {
        const field = { ...(row.label !== undefined && { label: row.label }),
          ...(kind === 'control' && { input: row.input }) };
        if (!own(row, 'visibleWhen')) return [id, { ...field, visible: true, status: 'visible' }];
        const rulePath = prefix + '/' + id + '/visibleWhen';
        const expression = row.visibleWhen;
        try {
          const visible = evaluate(expression, rulePath);
          return [id, { ...field, visibleWhen: expression, visible, status: visible ? 'visible' : 'hidden' }];
        } catch (error) {
          if (!(error instanceof RuleError)) throw error;
          const diagnostic = { kind, id, rulePath, path: error.path, code: error.code, message: error.message };
          diagnostics.push(diagnostic);
          return [id, { ...field, visibleWhen: expression, visible: true, status: 'error', diagnostic }];
        }
      }));
    }

    return {
      controls: targets(controls, 'control', '/controls'),
      inputs: targets(inputs, 'input', path + '/inputs'),
      outputs: targets(outputs, 'output', path + '/outputs'),
      diagnostics
    };
  }

  P.graphVisibility = Object.freeze({ inspect });
})(KIT.procedural);
