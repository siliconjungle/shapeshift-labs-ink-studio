/* Uniform programs expose named graph values with the shared processor language. */
(function (P) {
  const K=ProcessorKernel, {fields,i32,f32,socketTypes}=K, own=Object.hasOwn;
  const {validator}=P.graphTypes, {literal}=GraphControlReferences;
  const format='ink-studio/value-processor', version=1;
  const aliases={
    f32:['unitScalar','seconds'],
    i32:['pixelCount','frames'],
    vec2:['pixels','uv'],
    vec3:['worldPosition']
  };

  function resultPort(definition,name) {
    if(typeof definition==='string')definition={type:definition};
    if(!fields(definition,['type','port'])||!own(socketTypes,definition.type))
      throw new TypeError('Value Processor invalid output '+name);
    const {type,port=socketTypes[type]}=definition;
    if(port!==socketTypes[type]&&!aliases[type]?.includes(port))
      throw new TypeError('Value Processor output '+name+' cannot expose '+type+' as '+String(port));
    return {type,port,valid:validator(port)};
  }

  function compile(program) {
    if(!fields(program,['format','version','precision','parameters','outputs','body','result'])||
        program.format!==format||program.version!==version||program.precision!=='f32')
      throw new TypeError('Expected Ink Studio Value Processor version 1 with explicit f32 precision');
    const parameters=K.parameters(program.parameters??{},['program'],'Value Processor');
    const outputs=new Map(K.entries(program.outputs,16,[],'Value Processor outputs',true).map(([name,row])=>
      [name,resultPort(row,name)]));
    const kernel=K.compileUniform(program,parameters,outputs);
    const sockets=Object.freeze(K.parameterSockets(parameters));
    const ports=Object.freeze(Object.fromEntries([...outputs].map(([name,{port}])=>[name,port])));
    const report=Object.freeze({precision:'f32',work:kernel.work,syntaxNodes:kernel.syntaxNodes,
      readsTime:kernel.systemReads.has('time'),readsSeed:kernel.systemReads.has('seed')});

    function run(request={}) {
      if(!fields(request,['parameters','time','seed']))throw new TypeError('Invalid Value Processor run request');
      const {parameters:bindings={},time=0,seed=0}=request;
      if(!Number.isFinite(time)||!i32(seed))throw new TypeError('Value Processor needs finite time and an i32 seed');
      const values=kernel.run({params:K.resolveParameters(parameters,bindings,'Value Processor'),time:f32(time),seed});
      for(const [name,{valid,port}] of outputs){
        if(!valid(values[name]))throw new RangeError('Value Processor result '+name+' is outside its '+port+' contract');
        if(Array.isArray(values[name]))Object.freeze(values[name]);
      }
      return Object.freeze(values);
    }
    return Object.freeze({sockets,ports,report,run});
  }

  function specialize(node) {
    const plan=compile(literal(node,'program'));
    const {readsTime,readsSeed}=plan.report;
    return {inputs:{program:'record',...plan.sockets},outputs:plan.ports,time:readsTime,seed:readsSeed,system:readsTime||readsSeed,
      run({program,...parameters},{time,seed,functionExecution}){
        return plan.run({parameters,...(readsTime&&{time}),
          ...(readsSeed&&{seed:(functionExecution?.system.seed??seed)|0})});
      }};
  }

  P.valueProcessor=Object.freeze({format,version,compile,specialize});
})(KIT.procedural);
