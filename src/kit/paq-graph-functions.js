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

  function literal(node, key, fallback) {
    const definition = Object.hasOwn(node.inputs ?? {}, key) ? node.inputs[key] : node.params?.[key];
    if (definition === undefined) return fallback;
    if (definition && typeof definition === 'object' && !Array.isArray(definition))
      return Object.hasOwn(definition, 'value') ? definition.value : undefined;
    return definition;
  }

  function selectOperation(node, family, variants, fallback) {
    const name = literal(node, 'operation', fallback);
    if (typeof name !== 'string' || !Object.hasOwn(variants, name))
      throw new RangeError(family + ' needs a literal operation from ' + Object.keys(variants).join(', '));
    const variant = typeof variants[name] === 'function' ? variants[name]() : variants[name];
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

  const roundingPort = { type: 'string', default: 'exact' };
  const rounds = { exact: n => n, floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc };
  function toInteger(value, rounding) {
    if (!Object.hasOwn(rounds, rounding)) throw new RangeError('Unknown function integer rounding policy');
    return rounds[rounding](value);
  }

  const integer = {
    description: 'Convert a finite number to a signed safe integer with an explicit rounding policy.',
    ...typed('integer', { a: 'number', rounding: roundingPort }, ({a,rounding})=>toInteger(a,rounding))
  };

  const castTypes = [...scalarTypes, 'boolean', 'unitScalar'];
  const cast = {
    description: 'Explicitly cast between finite numbers, signed safe integers, normalized scalars, and Booleans.',
    specialize(node) {
      const from = literal(node, 'from'), to = node.type;
      needType(from, castTypes, 'fn.cast source');
      needType(to, castTypes, 'fn.cast result');
      const round = to === 'integer' && ['number','unitScalar'].includes(from);
      return typed(to, { a: from, from: 'string', ...(round && { rounding: roundingPort }) }, ({a,rounding})=>{
        if (to === 'boolean') return Boolean(a);
        return round ? toInteger(a,rounding) : Number(a);
      });
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

  const width = type => type === 'number' ? 1 : Number(type.at(-1));
  const components = ['x','y','z','w'];
  const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);

  function normalize(a) {
    const max = Math.max(...a.map(Math.abs));
    if (!max) throw new RangeError('Function cannot normalize a zero vector');
    const scaled = a.map(v=>v/max), magnitude = Math.hypot(...scaled);
    return scaled.map(v=>v/magnitude);
  }

  function along(a,b,reflect) {
    const axis = normalize(b);
    const apply = (value,amount)=>value.map((v,i)=>{
      const projected = axis[i]*amount;
      return reflect ? (v-projected)-projected : projected;
    });
    const direct = apply(a,dot(a,axis));
    if (direct.every(Number.isFinite)) return direct;
    // Scale only when intermediate products overflow, to retain small components on the direct path.
    const scale = Math.max(...a.map(Math.abs)), scaled = a.map(v=>v/scale);
    return apply(scaled,dot(scaled,axis)).map(v=>v*scale);
  }

  function vectorLayout(node,type,append) {
    const leading = type === 'vec2' ? 'number' : 'vec'+(width(type)-1);
    const pair = literal(node,'operands',append ? [leading,'number'] : [type,type]);
    const allowed = append ? ['number',...vectorTypes] : ['number',type];
    if (!Array.isArray(pair) || pair.length !== 2 || !Array.from(pair).every(lane=>allowed.includes(lane)))
      throw new TypeError('Function vector operands need two literal socket types');
    if (append ? width(pair[0])+width(pair[1]) !== width(type) : !pair.includes(type))
      throw new TypeError('Function vector operands do not produce the declared '+type);
    const authored = Object.hasOwn(node.inputs ?? {},'operands') || Object.hasOwn(node.params ?? {},'operands');
    return { a:pair[0], b:pair[1], ...(authored && {operands:'array<string>'}) };
  }

  function swizzle(node,type) {
    const pattern = literal(node,'pattern');
    const alphabet = ['xyzw','rgba','stpq'].find(keys=>typeof pattern === 'string' &&
      pattern.length >= 1 && pattern.length <= 4 && [...pattern].every(lane=>keys.includes(lane)));
    if (!alphabet) throw new TypeError('Function swizzle needs one to four literal components from xyzw, rgba, or stpq');
    const indices = [...pattern].map(lane=>alphabet.indexOf(lane));
    if (indices.some(index=>index>=width(type))) throw new RangeError('Function swizzle reads a component outside '+type);
    return typed(indices.length === 1 ? 'number' : 'vec'+indices.length, {a:type,pattern:'string'},
      ({a})=>indices.length === 1 ? a[indices[0]] : indices.map(index=>a[index]));
  }

  const vector = {
    description: 'Construct, swizzle, and operate on a declared two-, three-, or four-component vector.',
    specialize(node) {
      needType(node.type,vectorTypes,'fn.vector');
      const type = node.type, labels = components.slice(0,width(type));
      const variants = {
        compose: typed(type,Object.fromEntries(labels.map(label=>[label,'number'])),values=>labels.map(label=>values[label])),
        splat: typed(type,unary('number'),({a})=>labels.map(()=>a)),
        append: ()=>typed(type,vectorLayout(node,type,true),({a,b})=>[].concat(a,b)),
        swizzle: ()=>swizzle(node,type),
        component: typed('number',{a:type,index:'integer'},({a,index})=>component(a,index)),
        scale: typed(type,{a:type,factor:'number'},({a,factor})=>a.map(v=>v*factor)),
        dot: typed('number',binary(type),({a,b})=>dot(a,b)),
        length: typed('number',unary(type),({a})=>Math.hypot(...a)),
        distance: typed('number',binary(type),({a,b})=>Math.hypot(...a.map((v,i)=>v-b[i]))),
        normalize: typed(type,unary(type),({a})=>normalize(a)),
        project: typed(type,binary(type),({a,b})=>along(a,b,false)),
        reflect: typed(type,binary(type),({a,b})=>along(a,b,true)),
        clamp: typed(type,{a:type,min:'number',max:'number'},({a,min,max})=>a.map(v=>limit(v,min,max))),
        lerp: typed(type,{...binary(type),t:'unitScalar'},({a,b,t})=>a.map((v,i)=>mix(v,b[i],t)))
      };
      for (const [name, evaluate] of Object.entries(scalarUnary))
        variants[name] = typed(type,unary(type),({a})=>a.map(evaluate));
      for (const name of ['add','subtract','multiply','divide','min','max','modulo','power'])
        variants[name] = ()=>typed(type,vectorLayout(node,type,false),({a,b})=>
          labels.map((_,i)=>scalarBinary[name](Array.isArray(a)?a[i]:a,Array.isArray(b)?b[i]:b)));
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
    'fn.math': math, 'fn.toInteger': integer, 'fn.cast': cast, 'fn.compare': compare, 'fn.logic': logic,
    'fn.select': select, 'fn.vector': vector, 'fn.color': color, 'fn.text': text
  });
  const typedOperations = Object.freeze(['fn.math','fn.cast','fn.compare','fn.select','fn.vector','fn.color']);
  P.graphFunctions = Object.freeze({ types, validType, compatible, operations, typedOperations });
})(KIT);
