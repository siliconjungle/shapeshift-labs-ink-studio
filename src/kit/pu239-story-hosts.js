/* Small JSON capability contract for host-owned state inside an Ink world. */
(function(K) {
  const W = K.world, Q = W.query, {check,copy,id,own,record,vector} = W.data;
  const {freeze,isImmutable} = K.procedural.data;
  const format = 'ink-studio/story-host-receipt';
  const keys = (row,allowed) => record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const data = value => isImmutable(value)?value:freeze(copy(value));
  const tickOK = tick => Number.isSafeInteger(tick)&&tick>0&&tick<=W.runtime.maxTick;
  const shapes = {
    number:Number.isFinite, vector, boolean:value=>typeof value==='boolean',
    categorical:value=>typeof value==='string', record, records:value=>Array.isArray(value)&&value.every(record)
  };
  function validReceipt(receipt,attempt,tick,status) {
    return keys(receipt,['format','version','system','operation','attempt','tick','status','id','detail'])&&
      receipt.format===format&&receipt.version===1&&id(receipt.system)&&id(receipt.operation)&&id(receipt.id)&&
      W.targetedInteractions.validToken(receipt.attempt)&&receipt.attempt===attempt&&tickOK(tick)&&receipt.tick===tick&&
      receipt.status===status&&['applied','blocked'].includes(status)&&
      (receipt.detail===undefined||record(receipt.detail)&&JSON.stringify(receipt.detail).length<=16384);
  }

  function adapter(capabilities) {
    check(keys(capabilities,['version','read','step','perform'])&&capabilities.version===1&&
      ['read','step','perform'].every(key=>capabilities[key]===undefined||typeof capabilities[key]==='function')&&
      ['read','step','perform'].some(key=>typeof capabilities[key]==='function'),'Expected version 1 story host capabilities');
    const {read,step,perform} = capabilities;
    return function provider(config,{id:system}) {
      check(keys(config,['initial','fields','operations','accounts','events']), 'Invalid story host config for '+system);
      const {initial={},fields:specs={},operations=[],accounts:accountSpecs={},events:allowedEvents=[]} = config;
      const names = list=>Array.isArray(list)&&list.length<=128&&list.every(id)&&new Set(list).size===list.length;
      check(record(initial)&&record(specs)&&Object.keys(specs).length<=128&&(!Object.keys(specs).length||read)&&
        names(operations)&&(!operations.length||perform)&&names(allowedEvents)&&
        record(accountSpecs)&&Object.keys(accountSpecs).length<=128,'Invalid story host declarations for '+system);

      const accounts = Object.fromEntries(Object.entries(accountSpecs).map(([name,spec])=>{
        check(id(name)&&keys(spec,['resource','units','type','min','max','at'])&&id(spec.resource)&&
          typeof spec.units==='string'&&spec.units.trim()&&['number','integer','vec2','vec3'].includes(spec.type),
        'Invalid story host account '+system+'/'+name);
        const {min,max,...descriptor} = spec;
        return [name,{...descriptor,
          read:state=>({balance:own(state.balances,name)?state.balances[name]:undefined,min,max}),
          write:(state,balance)=>({...state,balances:{...state.balances,[name]:balance}})
        }];
      }));
      function validateState(state) {
        check(record(state),'Host state must be a JSON record for '+system);
        for (const [name,account] of Object.entries(accounts))
          W.transfers.balanceOf({name:system+'/'+name,type:account.type},account.read(state));
      }
      const start = data(initial);
      validateState(start);

      const fields = Object.fromEntries(Object.entries(specs).map(([name,spec])=>{
        check(id(name)&&keys(spec,['type','units','selector'])&&own(shapes,spec.type)&&
          (spec.units===undefined||typeof spec.units==='string'&&spec.units.trim())&&
          (spec.selector===undefined||typeof spec.selector==='boolean'),'Invalid story host field '+system+'/'+name);
        return [name,{...spec,qualified:true,read({state,args,target,tick,time}){
          if (state===undefined) return Q.missing('host state unavailable');
          const result = data(read(state,data({field:name,args,target:target??null,tick,time})));
          if (result?.status==='ok') {
            check(keys(result,['status','value'])&&shapes[spec.type](result.value),'Wrong value type for host field '+system+'/'+name);
            return result;
          }
          check(keys(result,['status','reason'])&&['missing','unavailable','outside'].includes(result.status)&&
            typeof result.reason==='string'&&result.reason.trim()&&result.reason.length<=256,
            'Invalid result for host field '+system+'/'+name);
          return result;
        }}];
      }));

      function publish(events,ctx) {
        if (events===undefined) return;
        check(Array.isArray(events)&&events.length<=128,'Invalid host event batch for '+system);
        for (const row of events) {
          check(keys(row,['kind','detail'])&&allowedEvents.includes(row.kind)&&
            (row.detail===undefined||record(row.detail)),'Undeclared or invalid host event for '+system);
          ctx.emit(row.kind,row.detail);
        }
      }
      const clock = ctx => freeze({system,tick:ctx.tick,time:ctx.time,dt:ctx.dt});
      const storyHostOperations = new Map(operations.map(operation=>[operation,(state,args,ctx,request)=>{
        const result = data(perform(state,data({operation,args,...request}),clock(ctx)));
        const {status,reason,receipt:proof} = result??{};
        const blocked = status==='blocked';
        check(keys(result,blocked?['status','reason','receipt']:['status','state','events','receipt'])&&
          (blocked?id(reason):status==='applied')&&keys(proof,['id','detail']),
          'Invalid story host operation result for '+system+'/'+operation);
        const receipt = {...proof,format,version:1,system,operation,attempt:request.attempt,tick:ctx.tick,status};
        check(validReceipt(receipt,request.attempt,ctx.tick,status),'Invalid story host receipt for '+system+'/'+operation);
        if (blocked) return {reason,receipt};
        validateState(result.state);
        publish(result.events,ctx);
        return {state:result.state,receipt};
      }]));
      return {initial:()=>start,validateState,shareCheckpoint:true,fields,accounts,storyHostOperations,
        contract:{emits:allowedEvents},
        ...(step&&{step(state,ctx){
          const result = data(step(state,clock(ctx)));
          check(keys(result,['state','events']),'Invalid story host step for '+system);
          validateState(result.state);
          publish(result.events,ctx);
          return result.state;
        }})};
    };
  }

  W.storyHosts = Object.freeze({adapter,format,validReceipt});
})(KIT);
