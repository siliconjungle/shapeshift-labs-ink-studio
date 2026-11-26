/* One typed texel program lowered to CPU evaluators and WGSL. */
const PixelProcessorKernel=(function (P) {
  const record=P.graphTypes.validator('record'), own=Object.hasOwn;
  const names=/^[a-z][a-z0-9_.-]{0,63}$/i;
  const id=value=>typeof value==='string'&&names.test(value)&&!['constructor','prototype','__proto__'].includes(value);
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const types=Object.freeze({f32:1,i32:1,bool:1,vec2:2,vec3:3,vec4:4});
  const vectorType=channels=>channels===1?'f32':'vec'+channels;
  const gpuType=type=>types[type]>1?type+'f':type;
  const i32=value=>Number.isInteger(value)&&value>=-2147483648&&value<=2147483647;
  const f32=value=>{
    const rounded=Math.fround(value);
    if(!Number.isFinite(rounded))throw new RangeError('Pixel Processor arithmetic needs finite f32 values');
    return rounded;
  };
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const toI32=value=>Math.trunc(clamp(value,-2147483648,2147483520))|0;
  const bits=new Uint32Array(1), floatBits=new Float32Array(bits.buffer);
  const f32Code=value=>{floatBits[0]=value;return 'bitcast<f32>(0x'+bits[0].toString(16)+'u)';};
  const i32Code=value=>'bitcast<i32>('+(value>>>0)+'u)';
  const floatOps={
    add:['+', (a,b)=>a+b], sub:['-', (a,b)=>a-b], mul:['*', (a,b)=>a*b],
    min:['min',Math.min], max:['max',Math.max]
  };
  const integerOps={
    ...floatOps, mul:['*',Math.imul],
    div:['pp_idiv',(a,b)=>b===0?0:Math.trunc(a/b)], mod:['pp_imod',(a,b)=>b===0?0:a%b]
  };
  const compare={
    eq:['==',(a,b)=>a===b], ne:['!=',(a,b)=>a!==b], lt:['<',(a,b)=>a<b],
    le:['<=',(a,b)=>a<=b], gt:['>',(a,b)=>a>b], ge:['>=',(a,b)=>a>=b]
  };
  const floatUnary={
    abs:['abs',Math.abs], neg:['pp_neg',a=>-a], floor:['floor',Math.floor], ceil:['ceil',Math.ceil],
    fract:['fract',a=>a-Math.floor(a)], sqrt:['pp_sqrt',a=>Math.sqrt(Math.max(0,a))],
    sin:['sin',Math.sin], cos:['cos',Math.cos]
  };
  const binaryCode=(symbol,a,b)=>/^[+*&|<>=!-]/.test(symbol)?'('+a+' '+symbol+' '+b+')':symbol+'('+a+', '+b+')';
  const blend=(a,b,t)=>f32(f32(a*f32(1-t))+f32(b*t));
  const system={
    x:['i32','pp_x',c=>c.x], y:['i32','pp_y',c=>c.y],
    width:['i32','pp_w',c=>c.width], height:['i32','pp_h',c=>c.height],
    u:['f32','((f32(pp_x) + 0.5f) / f32(pp_w))',c=>f32((c.x+.5)/c.width)],
    v:['f32','((f32(pp_y) + 0.5f) / f32(pp_h))',c=>f32((c.y+.5)/c.height)],
    seed:['i32','bitcast<i32>(pp_meta[3u])',c=>c.seed],
    time:['f32','bitcast<f32>(pp_meta[2u])',c=>c.time]
  };
  const maxWork=8192, maxNodes=1024, maxDepth=32, maxLoop=64;
  const expr=(type,code,run,cost=1)=>({type,code,run,cost});
  const use=(args,cost=1)=>args.reduce((sum,arg)=>sum+arg.cost,cost);
  const typed=(args,...expected)=>args.length===expected.length&&args.every((a,i)=>a.type===expected[i]);
  const splat=(value,channels)=>channels===1?value:Array(channels).fill(value);
  const lane=(value,n)=>Array.isArray(value)?value[n]:value;
  const indent=block=>block.split('\n').filter(Boolean).map(line=>'  '+line).join('\n');

  function sampleReader(binding,width,height,offset,input) {
    const {layout,tiling,sampling}=binding.descriptor, channels=layout.length;
    const ax=TextureAddress.axis(tiling.u), ay=TextureAddress.axis(tiling.v);
    function load(x,y) {
      const a=ax(x,width), b=ay(y,height);
      if(a<0||b<0)return splat(0,channels);
      const at=offset+(b*width+a)*channels;
      return channels===1?input[at]:Array.from(input.subarray(at,at+channels));
    }
    function sample([u,v]) {
      const x=f32(clamp(u,-65536,65536)*width), y=f32(clamp(v,-65536,65536)*height);
      if(sampling==='nearest')return load(Math.floor(x),Math.floor(y));
      const sx=f32(x-.5), sy=f32(y-.5), i=Math.floor(sx), j=Math.floor(sy);
      const tx=f32(sx-i), ty=f32(sy-j);
      const a=load(i,j), b=load(i+1,j), c=load(i,j+1), d=load(i+1,j+1);
      const at=k=>blend(blend(lane(a,k),lane(b,k),tx),blend(lane(c,k),lane(d,k),tx),ty);
      return channels===1?at(0):Array.from({length:channels},(_,k)=>at(k));
    }
    return {load,sample};
  }

  const addressing={
    clamp:(x,n)=>'clamp('+x+', 0i, '+n+' - 1i)',
    transparent:(x,n)=>'select('+x+', -1i, '+x+' < 0i || '+x+' >= '+n+')',
    wrap:(x,n)=>'pp_wrap('+x+', '+n+')',
    mirror:(x,n)=>'pp_mirror('+x+', '+n+')'
  };
  function samplerCode(binding) {
    const {meta,index,descriptor:{layout,tiling,sampling}}=binding;
    const channels=layout.length, type=gpuType(vectorType(channels));
    const construction=channels===1?'pp_inputs[at]':type+'('+Array.from({length:channels},
      (_,i)=>'pp_inputs[at + '+i+'u]').join(', ')+')';
    const load='pp_load'+index;
    const sample=sampling==='nearest'?`return ${load}(i32(floor(p.x)), i32(floor(p.y)));`:`
      let q = p - vec2f(0.5f);
      let base = floor(q);
      let t = q - base;
      let a = vec2i(base);
      let upper = mix(${load}(a.x, a.y), ${load}(a.x + 1i, a.y), t.x);
      let lower = mix(${load}(a.x, a.y + 1i), ${load}(a.x + 1i, a.y + 1i), t.x);
      return mix(upper, lower, t.y);`;
    return `
fn ${load}(x: i32, y: i32) -> ${type} {
  let w = i32(pp_meta[${meta+1}u]);
  let h = i32(pp_meta[${meta+2}u]);
  let u = ${addressing[tiling.u]('x','w')};
  let v = ${addressing[tiling.v]('y','h')};
  if (u < 0i || v < 0i) { return ${type}(0.0f); }
  let at = pp_meta[${meta}u] + u32(v * w + u) * ${channels}u;
  return ${construction};
}
fn pp_sample${index}(uv: vec2f) -> ${type} {
  let size = vec2f(f32(pp_meta[${meta+1}u]), f32(pp_meta[${meta+2}u]));
  let p = clamp(uv, vec2f(-65536.0f), vec2f(65536.0f)) * size;
  ${sample}
}`;
  }
  const helpers=`
@group(0) @binding(0) var<storage, read> pp_inputs: array<f32>;
@group(0) @binding(1) var<storage, read> pp_meta: array<u32>;
@group(0) @binding(2) var<storage, read_write> pp_outputs: array<f32>;

fn pp_wrap(x: i32, n: i32) -> i32 {
  let r = x % n;
  return select(r, r + n, r < 0i);
}
fn pp_mirror(x: i32, n: i32) -> i32 {
  let value = pp_wrap(x, n * 2i);
  return select(value, n * 2i - 1i - value, value >= n);
}
fn pp_div(a: f32, b: f32) -> f32 {
  if (b == 0.0f) { return 0.0f; }
  return a / b;
}
fn pp_idiv(a: i32, b: i32) -> i32 {
  if (b == 0i) { return 0i; }
  if (a == bitcast<i32>(2147483648u) && b == -1i) { return a; }
  return a / b;
}
fn pp_imod(a: i32, b: i32) -> i32 {
  if (b == 0i || b == -1i) { return 0i; }
  return a % b;
}
fn pp_neg(a: f32) -> f32 { return -a; }
fn pp_sqrt(a: f32) -> f32 { return sqrt(max(0.0f, a)); }
fn pp_int(a: f32) -> i32 { return i32(clamp(a,-2147483648.0f,2147483520.0f)); }
`;

  function compileKernel(program,resources,parameters,outputs,stride) {
    let serial=0, nodes=0, scratch=0;
    const systemReads=new Set();
    function visit(path,depth) {
      if(++nodes>maxNodes||depth>maxDepth)throw new RangeError('Pixel Processor program exceeds its syntax budget at '+path);
    }
    function expression(value,scope,path,depth) {
      visit(path,depth);
      const invalid=message=>{throw new TypeError('Pixel Processor '+path+' '+message);};
      if(typeof value==='number'){
        const rounded=f32(value);
        return expr('f32',f32Code(rounded),()=>rounded);
      }
      if(typeof value==='boolean')return expr('bool',String(value),()=>value);
      if(!Array.isArray(value)||!value.length||value.length>5||typeof value[0]!=='string')
        return invalid('needs a typed expression');
      const [op,...operands]=value;
      if(own(system,op)&&operands.length===0){
        systemReads.add(op);
        return expr(...system[op]);
      }
      if(op==='i32'&&operands.length===1&&i32(operands[0]))return expr('i32',i32Code(operands[0]),()=>operands[0]);
      if((op==='get'||op==='param')&&operands.length===1){
        const key=operands[0], row=op==='get'?scope.get(key):parameters.get(key);
        if(!row)return invalid('references an unknown '+op+' name '+String(key));
        return expr(row.type,row.code,op==='get'?c=>c.locals[row.slot]:c=>c.params[row.index]);
      }
      if(op==='load'||op==='sample'){
        const [key,...coords]=operands, resource=resources.get(key);
        const args=coords.map((a,i)=>expression(a,scope,path+'['+(i+2)+']',depth+1));
        if(!resource||!(op==='load'?typed(args,'i32','i32'):typed(args,'vec2')))
          return invalid(op+' needs a declared resource and '+(op==='load'?'two i32 coordinates':'one vec2 UV'));
        const {index,descriptor}=resource;
        return expr(vectorType(descriptor.layout.length),'pp_'+op+index+'('+args.map(a=>a.code).join(', ')+')',
          op==='load'?c=>c.readers[index].load(args[0].run(c),args[1].run(c)):c=>c.readers[index].sample(args[0].run(c)),
          use(args,op==='sample'&&descriptor.sampling==='linear'?12:3));
      }
      if(op==='component'){
        const [source,i]=operands, a=expression(source,scope,path+'[1]',depth+1);
        if(operands.length!==2||!i32(i)||types[a.type]<2||i<0||i>=types[a.type])
          return invalid('component needs a vector and an in-range literal lane');
        return expr('f32','('+a.code+')['+i+'u]',c=>a.run(c)[i],a.cost+1);
      }
      const args=operands.map((a,i)=>expression(a,scope,path+'['+(i+1)+']',depth+1));
      const [a,b,d]=args, codes=args.map(arg=>arg.code);
      const call=(type,name,fn)=>expr(type,name+'('+codes.join(', ')+')',c=>fn(...args.map(arg=>arg.run(c))),use(args));
      if(own(types,op)&&types[op]>1&&typed(args,...Array(types[op]).fill('f32')))
        return call(op,gpuType(op),(...v)=>v);
      if(op==='toF32'&&typed(args,'i32'))return call('f32','f32',f32);
      if(op==='toI32'&&typed(args,'f32'))return call('i32','pp_int',toI32);
      if(op==='not'&&typed(args,'bool'))return expr('bool','(!'+a.code+')',c=>!a.run(c),use(args));
      if((op==='and'||op==='or')&&typed(args,'bool','bool')){
        const and=op==='and';
        return expr('bool',binaryCode(and?'&&':'||',...codes),and?c=>a.run(c)&&b.run(c):c=>a.run(c)||b.run(c),use(args));
      }
      if(op==='select'&&args.length===3&&a.type==='bool'&&b.type===d.type){
        return expr(b.type,'select('+d.code+', '+b.code+', '+a.code+')',c=>{
          const yes=b.run(c), no=d.run(c);
          return a.run(c)?yes:no;
        },use(args));
      }
      if(own(compare,op)&&args.length===2&&a.type===b.type&&
          (['f32','i32'].includes(a.type)||a.type==='bool'&&['eq','ne'].includes(op))){
        const [symbol,fn]=compare[op];
        return expr('bool',binaryCode(symbol,...codes),c=>fn(a.run(c),b.run(c)),use(args));
      }
      if(own(floatUnary,op)&&args.length===1&&(a.type==='f32'||types[a.type]>1)&&
          (a.type==='f32'||!['neg','sqrt'].includes(op))){
        const [symbol,fn]=floatUnary[op];
        return call(a.type,symbol,value=>Array.isArray(value)?value.map(n=>f32(fn(n))):f32(fn(value)));
      }
      if(typed(args,'f32','f32')&&op==='div')
        return call('f32','pp_div',(a,b)=>b===0?0:f32(a/b));
      if(typed(args,'f32','f32','f32')&&op==='clamp')
        return call('f32','pp_clip',clamp);
      if(args.length===3&&a.type===b.type&&(a.type==='f32'||types[a.type]>1)&&d.type==='f32'&&op==='mix')
        return call(a.type,'mix',(a,b,t)=>Array.isArray(a)?a.map((v,k)=>blend(v,b[k],t)):blend(a,b,t));
      if(args.length===2&&a.type===b.type&&types[a.type]>1&&op==='dot'){
        return call('f32','dot',(a,b)=>a.reduce((sum,v,k)=>f32(sum+f32(v*b[k])),0));
      }
      if(args.length===2&&a.type===b.type&&a.type==='i32'&&own(integerOps,op)){
        const [symbol,fn]=integerOps[op];
        return expr('i32',binaryCode(symbol,...codes),c=>fn(a.run(c),b.run(c))|0,use(args));
      }
      if(args.length===2&&a.type===b.type&&(a.type==='f32'||types[a.type]>1)&&own(floatOps,op)){
        const [symbol,fn]=floatOps[op];
        return expr(a.type,binaryCode(symbol,...codes),c=>{
          const left=a.run(c), right=b.run(c);
          return Array.isArray(left)?left.map((n,i)=>f32(fn(n,right[i]))):f32(fn(left,right));
        },use(args));
      }
      return invalid('has invalid operands for '+op);
    }

    function block(statements,parent,path,depth) {
      if(!Array.isArray(statements)||statements.length>128||depth>maxDepth)
        throw new RangeError('Pixel Processor '+path+' needs a bounded statement list');
      const locals=new Map(parent), declared=new Set(), code=[], runs=[];
      let cost=0;
      function addLocal(name,type,mutable) {
        if(!id(name)||declared.has(name))throw new TypeError('Pixel Processor duplicate or invalid variable '+String(name));
        const slot=serial++, row={type,slot,code:'pp_l'+slot,mutable};
        declared.add(name); locals.set(name,row);
        return row;
      }
      for(let k=0;k<statements.length;k++){
        const stmt=statements[k], at=path+'['+k+']';
        visit(at,depth);
        const read=(value,key)=>expression(value,locals,at+'.'+key,depth+1);
        if(fields(stmt,['let','type','value'])&&own(stmt,'let')){
          const value=read(stmt.value,'value');
          if(stmt.type!==undefined&&stmt.type!==value.type)throw new TypeError('Pixel Processor '+at+' initializer type mismatch');
          const row=addLocal(stmt.let,value.type,true);
          runs.push(c=>{c.locals[row.slot]=value.run(c);});
          code.push('var '+row.code+': '+gpuType(row.type)+' = '+value.code+';');
          cost+=value.cost+1;
        }else if(fields(stmt,['set','value'])&&own(stmt,'set')){
          const row=locals.get(stmt.set), value=read(stmt.value,'value');
          if(!row?.mutable||row.type!==value.type)
            throw new TypeError('Pixel Processor '+at+' assignment needs a mutable local of type '+value.type);
          runs.push(c=>{c.locals[row.slot]=value.run(c);});
          code.push(row.code+' = '+value.code+';');
          cost+=value.cost+1;
        }else if(fields(stmt,['if','then','else'])&&own(stmt,'if')){
          const test=read(stmt.if,'if');
          if(test.type!=='bool')throw new TypeError('Pixel Processor '+at+' condition needs bool');
          const yes=block(stmt.then,locals,at+'.then',depth+1), no=block(stmt.else??[],locals,at+'.else',depth+1);
          runs.push(c=>(test.run(c)?yes:no).run(c));
          code.push('if ('+test.code+') {\n'+indent(yes.code)+'\n} else {\n'+indent(no.code)+'\n}');
          cost+=1+test.cost+Math.max(yes.cost,no.cost);
        }else if(fields(stmt,['for','count','limit','body'])&&own(stmt,'for')){
          const count=read(stmt.count,'count'), {limit}=stmt;
          if(!id(stmt.for)||count.type!=='i32'||!Number.isSafeInteger(limit)||limit<1||limit>maxLoop)
            throw new TypeError('Pixel Processor '+at+' needs an i32 count and a literal loop limit from 1 to '+maxLoop);
          const slot=serial++, index='pp_l'+slot, stop='pp_stop'+scratch++, max=i32Code(limit);
          const body=block(stmt.body,new Map([...locals,[stmt.for,{type:'i32',slot,code:index}]]),at+'.body',depth+1);
          runs.push(c=>{
            const length=clamp(count.run(c),0,limit);
            for(let i=0;i<length;i++){c.locals[slot]=i;body.run(c);}
          });
          code.push('let '+stop+' = clamp('+count.code+', 0i, '+max+');\nfor (var '+index+' = 0i; '+index+' < '+stop+
            '; '+index+' = '+index+' + 1i) {\n'+indent(body.code)+'\n}');
          cost+=count.cost+1+limit*(body.cost+1);
        }else throw new TypeError('Pixel Processor '+at+' needs let, set, if, or for');
        if(cost>maxWork)throw new RangeError('Pixel Processor exceeds its per-texel work budget at '+at);
      }
      return {locals,code:code.join('\n'),cost,run(c){for(const run of runs)run(c);}};
    }

    const body=block(program.body,new Map(),'body',0), writers=[];
    let work=body.cost;
    for(const [name,row] of outputs){
      const value=expression(program.result[name],body.locals,'result.'+name,0);
      if(value.type!==vectorType(row.descriptor.layout.length))throw new TypeError('Pixel Processor result '+name+
        ' needs '+vectorType(row.descriptor.layout.length)+', received '+value.type);
      writers.push({...row,value});
      work+=value.cost+row.descriptor.layout.length;
    }
    if(work>maxWork)throw new RangeError('Pixel Processor exceeds its per-texel work budget');

    const stores=writers.flatMap(({offset,value,descriptor:{layout}},i)=>{
      const name='pp_r'+i, chans=layout.length;
      return ['let '+name+' = '+value.code+';',...Array.from({length:chans},(_,c)=>
        'pp_outputs[pp_at + '+(offset+c)+'u] = '+name+(chans===1?'':'['+c+'u]')+';')];
    });
    const wgsl=helpers+'\nfn pp_clip(a: f32, low: f32, high: f32) -> f32 { return max(low, min(high, a)); }\n'+
      [...resources.values()].map(samplerCode).join('\n')+`
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let pp_w = i32(pp_meta[0u]);
  let pp_h = i32(pp_meta[1u]);
  let pp_x = i32(invocation.x);
  let pp_y = i32(invocation.y);
  if (pp_x >= pp_w || pp_y >= pp_h) { return; }
  let pp_at = (invocation.y * u32(pp_w) + invocation.x) * ${stride}u;
`+indent([body.code,...stores].join('\n'))+'\n}\n';

    function run(packet) {
      const {width,height,inputs,params,time,seed,meta}=packet, pixels=new Float32Array(width*height*stride);
      const readers=[...resources.values()].map(binding=>{
        const at=binding.meta;
        return sampleReader(binding,meta[at+1],meta[at+2],meta[at],inputs);
      });
      const c={width,height,time,seed,readers,params,locals:new Array(serial),x:0,y:0};
      try{
        for(let y=0,at=0;y<height;y++)for(let x=0;x<width;x++,at+=stride){
          c.x=x;c.y=y;
          body.run(c);
          for(const {offset,value,descriptor:{layout}} of writers){
            const result=value.run(c);
            for(let k=0;k<layout.length;k++)pixels[at+offset+k]=lane(result,k);
          }
        }
        return pixels;
      }catch(error){
        throw new RangeError('Pixel Processor texel '+c.x+', '+c.y+' · '+error.message,{cause:error});
      }
    }
    return {wgsl,work,run,syntaxNodes:nodes,systemReads};
  }

  return Object.freeze({compile:compileKernel,id,fields,types,i32,f32,gpuType,clamp});
})(KIT.procedural);
