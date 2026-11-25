/* Pure value operations for typed function scopes and their callers. */
(function (K) {
  const P = K.procedural;
  const scalarTypes = ['number', 'integer'];
  const vectorTypes = ['vec2', 'vec3', 'vec4'];
  const colorTypes = ['srgb', 'srgb-linear'];
  const types = Object.freeze([...scalarTypes, ...vectorTypes, ...colorTypes, 'unitScalar', 'boolean', 'string']);
  const validType = type => types.includes(type);
  const compatible = (from, to) => from === to ||
    to === 'number' && ['integer','unitScalar'].includes(from) ||
    to === 'unitScalar' && scalarTypes.includes(from);
  const signed = (n, type) => {
    if (!P.graphTypes.validator(type)(n))
      throw new RangeError('Function operation result is outside the ' + type + ' domain');
    return n;
  };
  const binary = type => ({ a: type, b: type });
  const unary = type => ({ a: type });
  const mix = (a, b, t) => a * (1 - t) + b * t;
  const divide = (a, b) => {
    if (b === 0) throw new RangeError('Function division by zero');
    return a / b;
  };
  function limit(value, min, max) {
    if (min > max) throw new RangeError('Function clamp minimum exceeds maximum');
    return Math.max(min, Math.min(max, value));
  }

  function typed(type, sockets, evaluate) {
    return { inputs: sockets, outputs: { value: type }, run(values) { return { value: signed(evaluate(values), type) }; } };
  }

  function selectOperation(node, family, variants, fallback) {
    const definition = { ...node.params, ...node.inputs }.operation;
    const name = definition === undefined ? fallback : typeof definition === 'string' ? definition : definition?.value;
    if (typeof name !== 'string' || !Object.hasOwn(variants, name))
      throw new RangeError(family + ' needs a literal operation from ' + Object.keys(variants).join(', '));
    const variant = variants[name];
    return { ...variant, inputs: { operation: { type: 'string', ...(fallback && { default: fallback }) }, ...variant.inputs } };
  }

  function needType(type, allowed, family) {
    if (!allowed.includes(type)) throw new TypeError(family + ' needs a declared type from ' + allowed.join(', '));
  }

  const scalarBinary = {
    add: (a, b) => a + b, subtract: (a, b) => a - b, multiply: (a, b) => a * b,
    divide, modulo: (a, b) => {
      if (b === 0) throw new RangeError('Function remainder by zero');
      return a % b;
    },
    min: Math.min, max: Math.max, power: Math.pow
  };
  const integerBinary = {
    ...scalarBinary,
    divide(a,b) {
      if (b === 0) throw new RangeError('Function division by zero');
      return Number(BigInt(a)/BigInt(b));
    },
    power(a,b) {
      if (b === 0 || a === 1) return 1;
      if (a === -1) return b % 2 === 0 ? 1 : -1;
      if (a === 0 && b > 0) return 0;
      if (b < 0 || b > 52) throw new RangeError('Function power is outside the integer domain');
      return Number(BigInt(a)**BigInt(b));
    }
  };
  const scalarUnary = { negate: x => -x, abs: Math.abs };
  const realUnary = {
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log
  };

  const math = {
    description: 'Evaluate a named numeric function or arithmetic operation in a declared scalar type.',
    specialize(node) {
      const type = node.type ?? 'number';
      needType(type, scalarTypes, 'fn.math');
      const variants = {};
      for (const [name, evaluate] of Object.entries(type === 'integer' ? integerBinary : scalarBinary))
        variants[name] = typed(type, binary(type), ({a,b}) => evaluate(a,b));
      for (const [name, evaluate] of Object.entries(type === 'number' ? { ...scalarUnary, ...realUnary } : scalarUnary))
        variants[name] = typed(type, unary(type), ({a}) => evaluate(a));
      variants.clamp = typed(type, { a: type, min: type, max: type }, ({a,min,max}) => limit(a,min,max));
      if (type === 'number') {
        variants.lerp = typed(type, { ...binary(type), t: 'unitScalar' }, ({a,b,t}) => mix(a,b,t));
        variants.atan2 = typed(type, { y: type, x: type }, ({y,x}) => Math.atan2(y,x));
        variants.smoothstep = typed(type, { a: type, min: type, max: type }, ({a,min,max}) => {
          if (min >= max) throw new RangeError('Function smoothstep needs distinct, increasing bounds');
          if (a <= min) return 0;
          if (a >= max) return 1;
          const span = max-min;
          const t = Number.isFinite(span) ? (a-min)/span : (a*.5-min*.5)/(max*.5-min*.5);
          return t * t * (3 - 2 * t);
        });
      }
      return selectOperation(node, 'fn.math', variants, 'add');
    }
  };

  const integer = {
    description: 'Convert a finite number to a signed safe integer with an explicit rounding policy.',
    inputs: { a: 'number', rounding: { type: 'string', default: 'exact' } },
    outputs: { value: 'integer' },
    run({a,rounding}) {
      const rounds = { exact: n => n, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc };
      if (!Object.hasOwn(rounds,rounding)) throw new RangeError('Unknown function integer rounding policy');
      return { value: signed(rounds[rounding](a),'integer') };
    }
  };

  const equal = (a,b) => Array.isArray(a) ? a.length === b.length && a.every((v,i) => v === b[i]) : a === b;
  const compare = {
    description: 'Compare two values of a declared type and return a Boolean.',
    specialize(node) {
      needType(node.type,types,'fn.compare');
      const tests = { eq: equal, ne: (a,b) => !equal(a,b) };
      if (scalarTypes.includes(node.type) || node.type === 'string')
        Object.assign(tests,{ lt:(a,b)=>a<b, lte:(a,b)=>a<=b, gt:(a,b)=>a>b, gte:(a,b)=>a>=b });
      const variants = Object.fromEntries(Object.entries(tests).map(([name, test]) =>
        [name,typed('boolean',binary(node.type),({a,b})=>test(a,b))]));
      return selectOperation(node,'fn.compare',variants,'eq');
    }
  };

  const logic = {
    description: 'Combine Boolean values with and, or, xor, or not.',
    specialize(node) {
      const variants = {
        and: typed('boolean',binary('boolean'),({a,b})=>a&&b),
        or: typed('boolean',binary('boolean'),({a,b})=>a||b),
        xor: typed('boolean',binary('boolean'),({a,b})=>a!==b),
        not: typed('boolean',unary('boolean'),({a})=>!a)
      };
      return selectOperation(node,'fn.logic',variants,'and');
    }
  };

  const select = {
    description: 'Choose one of two computed values that have the same declared type.',
    specialize({type}) {
      needType(type,types,'fn.select');
      return typed(type,{condition:'boolean',whenTrue:type,whenFalse:type},
        ({condition,whenTrue,whenFalse})=>condition ? whenTrue : whenFalse);
    }
  };

  function component(value,index) {
    if (index < 0 || index >= value.length) throw new RangeError('Function component index is out of range');
    return value[index];
  }

  const vector = {
    description: 'Construct or operate on a declared two-, three-, or four-component vector.',
    specialize(node) {
      needType(node.type,vectorTypes,'fn.vector');
      const type = node.type;
      const labels = ['x','y','z','w'].slice(0,Number(type.at(-1)));
      const variants = {
        compose: typed(type,Object.fromEntries(labels.map(label=>[label,'number'])),values=>labels.map(label=>values[label])),
        scale: typed(type,{a:type,factor:'number'},({a,factor})=>a.map(v=>v*factor)),
        dot: typed('number',binary(type),({a,b})=>a.reduce((sum,v,i)=>sum+v*b[i],0)),
        length: typed('number',unary(type),({a})=>Math.hypot(...a)),
        normalize: typed(type,unary(type),({a})=>{
          const max = Math.max(...a.map(Math.abs));
          if (!max) throw new RangeError('Function cannot normalize a zero vector');
          const scaled = a.map(v=>v/max), magnitude = Math.hypot(...scaled);
          return scaled.map(v=>v/magnitude);
        }),
        lerp: typed(type,{...binary(type),t:'unitScalar'},({a,b,t})=>a.map((v,i)=>mix(v,b[i],t))),
        component: typed('number',{a:type,index:'integer'},({a,index})=>component(a,index))
      };
      for (const name of ['add','subtract','multiply','divide'])
        variants[name] = typed(type,binary(type),({a,b})=>a.map((v,i)=>scalarBinary[name](v,b[i])));
      if (type === 'vec3') variants.cross = typed(type,binary(type),({a,b})=>
        [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]);
      return selectOperation(node,'fn.vector',variants,'compose');
    }
  };

  function convert(color, from, to) {
    if (from === to) return color;
    return to === 'srgb' ? P.conversions.toDisplay(color) : P.conversions.toLinear(color);
  }

  const color = {
    description: 'Build RGB(A), read components or luminance, and mix colors in linear light.',
    specialize(node) {
      needType(node.type,colorTypes,'fn.color');
      const type = node.type, other = type === 'srgb' ? 'srgb-linear' : 'srgb';
      return selectOperation(node,'fn.color',{
        compose: typed(type,{r:'number',g:'number',b:'number',alpha:{type:'unitScalar',default:1}},
          ({r,g,b,alpha})=>[r,g,b,alpha]),
        convert: typed(type,{a:other},({a})=>convert(a,other,type)),
        component: typed('number',{a:type,index:'integer'},({a,index})=>component(a,index)),
        luminance: typed('number',unary(type),({a})=>{
          const [r,g,b] = convert(a,type,'srgb-linear');
          return .2126*r+.7152*g+.0722*b;
        }),
        mix: typed(type,{...binary(type),t:'unitScalar'},({a,b,t})=>{
          if (t === 0) return a;
          if (t === 1) return b;
          const ar = convert(a,type,'srgb-linear'), br = convert(b,type,'srgb-linear');
          const left = (a[3] ?? 1)*(1-t), right = (b[3] ?? 1)*t, alpha = left+right;
          const rgb = [0,1,2].map(i=>alpha ? mix(ar[i],br[i],right/alpha) : 0);
          return convert(a.length === 3 && b.length === 3 ? rgb : [...rgb,alpha],'srgb-linear',type);
        })
      },'mix');
    }
  };

  const text = {
    description: 'Join strings, count UTF-16 code units or test for a substring.',
    specialize(node) {
      return selectOperation(node,'fn.text',{
        concat: typed('string',binary('string'),({a,b})=>a+b),
        length: typed('integer',unary('string'),({a})=>a.length),
        contains: typed('boolean',binary('string'),({a,b})=>a.includes(b))
      },'concat');
    }
  };

  const operations = Object.freeze({
    'fn.math': math, 'fn.toInteger': integer, 'fn.compare': compare, 'fn.logic': logic,
    'fn.select': select, 'fn.vector': vector, 'fn.color': color, 'fn.text': text
  });
  const typedOperations = Object.freeze(['fn.math','fn.compare','fn.select','fn.vector','fn.color']);
  P.graphFunctions = Object.freeze({ types, validType, compatible, operations, typedOperations });
})(KIT);
